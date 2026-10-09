-- 122 - Fluxo automático quando o contato responde a um disparo
-- Aditivo e idempotente: campanhas antigas continuam sem fluxo de resposta.

ALTER TABLE public.crm_broadcasts
  ADD COLUMN IF NOT EXISTS reply_flow_id uuid;

ALTER TABLE public.crm_broadcast_items
  ADD COLUMN IF NOT EXISTS reply_flow_started_at timestamptz;

-- Busca rápida do item enviado ainda sem fluxo de resposta.
CREATE INDEX IF NOT EXISTS crm_broadcast_items_reply_lookup_idx
  ON public.crm_broadcast_items (user_id, wa_id, processed_at DESC)
  WHERE status = 'sent' AND reply_flow_started_at IS NULL;
