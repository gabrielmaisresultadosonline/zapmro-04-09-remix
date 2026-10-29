-- 137: "Limpar mídias antigas" passava a remover ZERO arquivos porque:
--  1) cada mídia recebida ainda citada por qualquer mensagem era protegida —
--     e conversas ativas sempre citam suas mídias, então quase nada expirava;
--  2) a checagem fazia uma varredura em todas as mensagens por arquivo e era
--     cancelada pelo guarda de 30 s; 3) só 20 arquivos por minuto (cooldown).
-- Agora mídias recebidas com mais de 15 dias expiram mesmo em conversas ativas
-- (a mensagem vira "Mídia expirada — veja no celular", o texto permanece).
-- Continuam protegidas: fluxos, templates, documentos do Agente I.A. e
-- agendamentos/disparos ainda pendentes.

CREATE OR REPLACE FUNCTION public.crm_media_is_protected_asset(p_path text, p_public_url text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; used boolean;
BEGIN
  IF coalesce(p_path,'') = '' THEN RETURN true; END IF;
  FOREACH t IN ARRAY ARRAY['crm_flows','crm_flow_steps','crm_templates','crm_ai_documents','zapi_flows','zapi_flow_steps'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I x WHERE position($1 in x::text) > 0)', t)
      INTO used USING p_path;
      IF used THEN RETURN true; END IF;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['crm_scheduled_messages','crm_broadcasts'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I x WHERE x.status IN (''pending'',''processing'',''running'',''paused'',''queued'') AND position($1 in x::text) > 0)', t)
      INTO used USING p_path;
      IF used THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_media_is_protected_asset(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_media_is_protected_asset(text,text) TO service_role;

DROP FUNCTION IF EXISTS public.crm_incoming_media_expired_batch(integer,integer,boolean);
CREATE OR REPLACE FUNCTION public.crm_incoming_media_expired_batch(p_days integer DEFAULT 15, p_limit integer DEFAULT 200, p_force boolean DEFAULT false)
RETURNS TABLE(name text, size_bytes bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage AS $$
DECLARE
  c public.crm_incoming_expiration_cursor%ROWTYPE;
  o record; examined integer := 0; last_created timestamptz; last_name text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(135015) THEN RETURN; END IF;
  SELECT * INTO c FROM public.crm_incoming_expiration_cursor WHERE id = true FOR UPDATE;
  IF NOT p_force AND c.next_run_at > clock_timestamp() THEN RETURN; END IF;
  FOR o IN
    SELECT s.name, s.created_at, s.metadata FROM storage.objects s
    WHERE s.bucket_id = 'crm-media' AND s.name LIKE 'incoming/%'
      AND s.created_at < now() - make_interval(days => greatest(coalesce(p_days,15),15))
      AND (c.after_created_at IS NULL OR (s.created_at, s.name) > (c.after_created_at, c.after_name))
    ORDER BY s.created_at, s.name
    LIMIT least(greatest(coalesce(p_limit,200),1),500)
  LOOP
    examined := examined + 1; last_created := o.created_at; last_name := o.name;
    IF NOT public.crm_media_is_protected_asset(o.name, '/storage/v1/object/public/crm-media/'||o.name) THEN
      name := o.name; size_bytes := coalesce((o.metadata->>'size')::bigint, 0);
      RETURN NEXT;
    END IF;
  END LOOP;
  UPDATE public.crm_incoming_expiration_cursor
     SET after_created_at = CASE WHEN examined = 0 THEN NULL ELSE last_created END,
         after_name       = CASE WHEN examined = 0 THEN NULL ELSE last_name END,
         next_run_at      = clock_timestamp() + interval '20 seconds'
   WHERE id = true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_incoming_media_expired_batch(integer,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_incoming_media_expired_batch(integer,integer,boolean) TO service_role;
-- Recomeça a varredura do início: antes muitos arquivos foram "pulados" como protegidos.
UPDATE public.crm_incoming_expiration_cursor SET after_created_at = NULL, after_name = NULL, next_run_at = '-infinity' WHERE id = true;

-- Índice para marcar mensagens como expiradas sem varrer a tabela inteira.
CREATE INDEX IF NOT EXISTS crm_messages_incoming_media_path_idx
  ON public.crm_messages ((substring(media_url FROM '/crm-media/(incoming/[^?#]+)')))
  WHERE media_url LIKE '%/crm-media/incoming/%';

NOTIFY pgrst, 'reload schema';
