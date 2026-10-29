-- 136 — Faxina diária para o armazenamento parar de crescer.
-- Apagar conversas libera linhas, mas registros internos de agendamento
-- (cron.job_run_details, a cada 15s), respostas HTTP do pg_net, fila de
-- mídias já removidas e backups de conversa antigos continuavam acumulando.
-- Nada aqui toca em contatos, fluxos, templates ou conversas ativas.

CREATE OR REPLACE FUNCTION public.crm_daily_storage_housekeeping()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb := '{}'::jsonb; n bigint;
BEGIN
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    EXECUTE 'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''2 days'' OR (end_time IS NULL AND start_time < now() - interval ''2 days'')';
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('cron_runs', n);
  END IF;
  IF to_regclass('net._http_response') IS NOT NULL THEN
    EXECUTE 'DELETE FROM net._http_response WHERE created < now() - interval ''1 day''';
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('http_responses', n);
  END IF;
  DELETE FROM public.crm_media_gc_queue WHERE status = 'purged' AND coalesce(purged_at, queued_at) < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('gc_purged_rows', n);
  -- Arquivos cujas conversas já sumiram voltam para a fila imediatamente.
  UPDATE public.crm_media_gc_queue SET purge_after = now()
   WHERE status IN ('pending','failed') AND purge_after > now()
     AND reason IN ('conversa-mensagem-apagada','conversa-limpa','conversa-excluida');
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('gc_expedited', n);
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_daily_storage_housekeeping() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_daily_storage_housekeeping() TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm-daily-storage-housekeeping';
    PERFORM cron.schedule('crm-daily-storage-housekeeping', '20 4 * * *', 'SELECT public.crm_daily_storage_housekeeping()');
  END IF;
END $$;
