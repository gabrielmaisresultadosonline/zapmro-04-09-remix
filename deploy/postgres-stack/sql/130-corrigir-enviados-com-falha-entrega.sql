-- ============================================================
-- 130 - Corrige itens de disparo marcados como "enviados" que a
-- Meta depois informou falha de entrega (a mensagem nunca chegou).
-- ------------------------------------------------------------
-- O webhook de status já marca os itens novos como falha, mas os
-- itens antigos (de antes dessa correção) ficaram presos em 'sent'
-- mesmo com a mensagem 'failed' no histórico. Esta migração acerta
-- o histórico uma única vez e recalcula os contadores das campanhas.
-- Idempotente.
-- ============================================================

-- 1) Itens 'sent' cuja mensagem correspondente está 'failed' viram falha.
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
SELECT count(*) FROM corrigidos;

-- 2) Recalcula sent_count/failed_count/status de TODAS as campanhas
--    a partir da fila (a função já existe desde a migração 103).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.crm_broadcasts LOOP
    PERFORM public.crm_refresh_broadcast_progress(r.id);
  END LOOP;
END $$;
