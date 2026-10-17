-- 133 - Cancelar manualmente o "fluxo ao responder" de disparos
-- Aditivo e idempotente: nada é apagado; campanhas e itens antigos continuam iguais.

ALTER TABLE public.crm_broadcasts
  ADD COLUMN IF NOT EXISTS reply_flow_cancelled_at timestamptz;

ALTER TABLE public.crm_broadcast_items
  ADD COLUMN IF NOT EXISTS reply_flow_cancelled_at timestamptz;

-- Lista "aguardando resposta" por campanha.
CREATE INDEX IF NOT EXISTS crm_broadcast_items_reply_waiting_idx
  ON public.crm_broadcast_items (broadcast_id, processed_at DESC)
  WHERE status = 'sent' AND reply_flow_started_at IS NULL AND reply_flow_cancelled_at IS NULL;
