-- =============================================================================
-- 114 — Expiração das mídias recebidas pelo WhatsApp (crm-media/incoming/*)
--
-- Por quê: o webhook baixa toda mídia recebida/eco para crm-media/incoming/ sem
-- prefixo do cadastro. Esses arquivos (≈44 GB) ficavam fora do catálogo, do
-- painel e de qualquer limpeza. Regra decidida: apagar após 15 dias.
--
-- Segurança: só objetos de crm-media cujo nome começa com 'incoming/'.
-- Nunca apaga mídia citada em fluxos, templates, passos de fluxo ou mensagens
-- agendadas. Contatos, números, configurações e tutoriais não são tocados.
-- A exclusão física é feita pela Storage API (edge function), nunca no disco.
-- =============================================================================

CREATE INDEX IF NOT EXISTS storage_objects_crm_incoming_created_idx
  ON storage.objects (created_at)
  WHERE bucket_id = 'crm-media' AND name LIKE 'incoming/%';

-- Texto com todas as referências "protegidas" (fluxos, templates, agendadas).
CREATE OR REPLACE FUNCTION public.crm_incoming_protected_refs()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  part text;
  result text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_flows','crm_flow_steps','crm_templates','crm_scheduled_messages','zapi_flows','zapi_flow_steps','crm_broadcasts']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT coalesce(string_agg(x::text, '' ''), '''') FROM public.%I x WHERE x::text LIKE ''%%incoming/%%''', t)
        INTO part;
      result := result || ' ' || part;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Lote de objetos vencidos e não protegidos.
CREATE OR REPLACE FUNCTION public.crm_incoming_media_expired_batch(p_days integer DEFAULT 15, p_limit integer DEFAULT 300)
RETURNS TABLE(name text, size_bytes bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  refs text := public.crm_incoming_protected_refs();
BEGIN
  RETURN QUERY
  SELECT o.name::text, coalesce((o.metadata->>'size')::bigint, 0)
  FROM storage.objects o
  WHERE o.bucket_id = 'crm-media'
    AND o.name LIKE 'incoming/%'
    AND o.created_at < now() - make_interval(days => greatest(p_days, 15))
    AND position(o.name IN refs) = 0
  ORDER BY o.created_at
  LIMIT least(greatest(p_limit, 1), 1000);
END;
$$;

-- Após a remoção física, marca as mensagens que apontavam para o arquivo.
CREATE OR REPLACE FUNCTION public.crm_incoming_media_mark_expired(p_names text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  IF p_names IS NULL OR cardinality(p_names) = 0 THEN RETURN 0; END IF;
  UPDATE public.crm_messages m
     SET media_url = NULL,
         content = CASE
           WHEN coalesce(m.content, '') = '' OR m.content LIKE '[%' THEN '[Mídia expirada após 15 dias — veja no celular]'
           ELSE m.content || E'\n[Mídia expirada após 15 dias]'
         END
   WHERE m.media_url LIKE '%/crm-media/incoming/%'
     AND substring(m.media_url FROM '/crm-media/(incoming/[^?#]+)') = ANY (p_names);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Resumo para o AdminCentral.
CREATE OR REPLACE FUNCTION public.crm_admin_incoming_media_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT jsonb_build_object(
    'total_files', count(*),
    'total_bytes', coalesce(sum((metadata->>'size')::bigint), 0),
    'expired_files', count(*) FILTER (WHERE created_at < now() - interval '15 days'),
    'expired_bytes', coalesce(sum((metadata->>'size')::bigint) FILTER (WHERE created_at < now() - interval '15 days'), 0),
    'retention_days', 15
  )
  FROM storage.objects
  WHERE bucket_id = 'crm-media' AND name LIKE 'incoming/%';
$$;

REVOKE ALL ON FUNCTION public.crm_incoming_protected_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_incoming_media_expired_batch(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_incoming_media_mark_expired(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_admin_incoming_media_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_incoming_protected_refs() TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_incoming_media_expired_batch(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_incoming_media_mark_expired(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_admin_incoming_media_summary() TO service_role;

NOTIFY pgrst, 'reload schema';
