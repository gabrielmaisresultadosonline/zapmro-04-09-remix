-- 138: mídias recebidas que nenhuma conversa usa mais.
-- Quando o histórico é apagado (7 dias sem atividade ou "limpar conversa") a
-- mensagem some, mas o arquivo em crm-media/incoming/ continuava guardado até
-- completar 15 dias — e cópias repetidas de webhooks reenviados nunca tiveram
-- mensagem. Resultado: dezenas de GB sem dono enquanto os cadastros somam pouco.
-- Agora um arquivo recebido com mais de 24 h, sem nenhuma mensagem citando-o e
-- fora de fluxos/templates/documentos do Agente/agendamentos pendentes é
-- removido (pela Storage API, que apaga arquivo e registro juntos).
-- Só considera arquivos diretamente em incoming/ (incoming/ads/ fica de fora).

CREATE OR REPLACE FUNCTION public.crm_incoming_media_unreferenced_batch(p_min_age_hours integer DEFAULT 24, p_limit integer DEFAULT 200)
RETURNS TABLE(name text, size_bytes bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage AS $$
DECLARE o record; found integer := 0; examined integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(138015) THEN RETURN; END IF;
  FOR o IN
    SELECT s.name, s.metadata FROM storage.objects s
    WHERE s.bucket_id = 'crm-media'
      AND s.name LIKE 'incoming/%' AND s.name NOT LIKE 'incoming/%/%'
      AND s.created_at < now() - make_interval(hours => greatest(coalesce(p_min_age_hours,24),24))
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_messages m
        WHERE m.media_url LIKE '%/crm-media/incoming/%'
          AND substring(m.media_url FROM '/crm-media/(incoming/[^?#]+)') = s.name)
    ORDER BY s.created_at
  LOOP
    examined := examined + 1;
    EXIT WHEN examined > 2000;
    IF NOT public.crm_media_is_protected_asset(o.name, '/storage/v1/object/public/crm-media/'||o.name) THEN
      name := o.name; size_bytes := coalesce((o.metadata->>'size')::bigint, 0);
      RETURN NEXT;
      found := found + 1;
      EXIT WHEN found >= least(greatest(coalesce(p_limit,200),1),500);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_incoming_media_unreferenced_batch(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_incoming_media_unreferenced_batch(integer,integer) TO service_role;

-- Resumo do AdminCentral passa a mostrar quanto está sem conversa.
CREATE OR REPLACE FUNCTION public.crm_admin_incoming_media_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
  WITH inc AS (
    SELECT s.name, s.created_at, coalesce((s.metadata->>'size')::bigint, 0) AS sz
    FROM storage.objects s
    WHERE s.bucket_id = 'crm-media' AND s.name LIKE 'incoming/%'
  ), orphan AS (
    SELECT i.sz FROM inc i
    WHERE i.name NOT LIKE 'incoming/%/%'
      AND i.created_at < now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_messages m
        WHERE m.media_url LIKE '%/crm-media/incoming/%'
          AND substring(m.media_url FROM '/crm-media/(incoming/[^?#]+)') = i.name)
  )
  SELECT jsonb_build_object(
    'total_files', (SELECT count(*) FROM inc),
    'total_bytes', (SELECT coalesce(sum(sz),0) FROM inc),
    'expired_files', (SELECT count(*) FROM inc WHERE created_at < now() - interval '15 days'),
    'expired_bytes', (SELECT coalesce(sum(sz),0) FROM inc WHERE created_at < now() - interval '15 days'),
    'unreferenced_files', (SELECT count(*) FROM orphan),
    'unreferenced_bytes', (SELECT coalesce(sum(sz),0) FROM orphan),
    'retention_days', 15
  );
$$;
REVOKE ALL ON FUNCTION public.crm_admin_incoming_media_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_incoming_media_summary() TO service_role;

-- O "Limpar resíduos do VPS" antigo usava uma conferência de órfãos que não
-- entendia as pastas do storage. Pedidos pendentes são cancelados por segurança;
-- um novo clique usa a conferência corrigida.
DO $$
BEGIN
  IF to_regclass('public.crm_vps_maintenance_requests') IS NOT NULL THEN
    UPDATE public.crm_vps_maintenance_requests
       SET status = 'failed', completed_at = now(), updated_at = now(),
           last_error = 'Pedido antigo cancelado na atualização; clique de novo para usar a limpeza corrigida.'
     WHERE status IN ('pending','running');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
