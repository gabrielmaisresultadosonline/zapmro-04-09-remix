-- ============================================================
-- 131 - Reconciliação contínua de entregas do disparo em massa
-- ------------------------------------------------------------
-- Nenhum item pode ficar marcado como "enviado" se a mensagem não
-- chegou de verdade. Esta migração cria uma função que roda sozinha
-- a cada 15 minutos (pg_cron) e também é chamada pelo disparador:
--
-- 1) Item 'sent' cuja mensagem está 'failed' (a Meta avisou depois)
--    vira falha, com o código/motivo que a Meta informou.
-- 2) Item 'sent' há mais de 24h SEM nenhuma confirmação de entrega
--    (mensagem continua só 'sent' ou nem existe no histórico) vira
--    falha com o código SEM_CONFIRMACAO_ENTREGA — a Meta aceitou,
--    mas nunca confirmou que chegou no aparelho.
-- 3) Recalcula os contadores das campanhas afetadas.
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.crm_reconcile_broadcast_delivery()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_broadcasts uuid[] := '{}';
  step_ids uuid[];
  total_changed integer := 0;
  n integer;
  b uuid;
BEGIN
  -- 1) Falha assíncrona já registrada na mensagem.
  WITH corrigidos AS (
    UPDATE public.crm_broadcast_items i
       SET status = 'failed',
           error_code = COALESCE(i.error_code, 'META_ASYNC_FAILED'),
           error_message = COALESCE(i.error_message, 'A Meta informou que a mensagem não foi entregue'),
           updated_at = now()
      FROM public.crm_messages m
     WHERE m.meta_message_id = i.meta_message_id
       AND m.user_id = i.user_id
       AND i.status = 'sent'
       AND m.status = 'failed'
    RETURNING i.broadcast_id
  )
  SELECT count(*), COALESCE(array_agg(DISTINCT broadcast_id), '{}')
    INTO n, step_ids FROM corrigidos;
  affected_broadcasts := affected_broadcasts || step_ids;
  total_changed := total_changed + COALESCE(n, 0);

  -- 2) Nunca confirmou entrega em 24h: não pode constar como enviado.
  WITH sem_confirmacao AS (
    UPDATE public.crm_broadcast_items i
       SET status = 'failed',
           error_code = 'SEM_CONFIRMACAO_ENTREGA',
           error_message = 'A Meta aceitou o envio, mas não confirmou a entrega no aparelho em 24h',
           updated_at = now()
     WHERE i.status = 'sent'
       AND i.processed_at < now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_messages m
          WHERE m.meta_message_id = i.meta_message_id
            AND m.user_id = i.user_id
            AND m.status IN ('delivered', 'read')
       )
    RETURNING i.broadcast_id
  )
  SELECT count(*), COALESCE(array_agg(DISTINCT broadcast_id), '{}')
    INTO n, step_ids FROM sem_confirmacao;
  affected_broadcasts := affected_broadcasts || step_ids;
  total_changed := total_changed + COALESCE(n, 0);

  -- 3) Recalcula as campanhas afetadas.
  IF array_length(affected_broadcasts, 1) IS NOT NULL THEN
    FOR b IN SELECT DISTINCT unnest(affected_broadcasts) LOOP
      PERFORM public.crm_refresh_broadcast_progress(b);
    END LOOP;
  END IF;

  RETURN total_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_reconcile_broadcast_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reconcile_broadcast_delivery() TO service_role;

-- Roda sozinha a cada 15 minutos, mesmo sem ninguém com a tela aberta.
DO $$
BEGIN
  PERFORM cron.unschedule('reconciliar-entregas-disparo');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM cron.job WHERE database <> current_database()
     AND database NOT IN (SELECT datname FROM pg_database);
  PERFORM cron.schedule_in_database('reconciliar-entregas-disparo', '*/15 * * * *',
    'SELECT public.crm_reconcile_broadcast_delivery();', current_database());
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'agendamento da reconciliacao nao criado: %', SQLERRM;
END $$;

-- Aplica uma vez já na atualização.
SELECT public.crm_reconcile_broadcast_delivery();
