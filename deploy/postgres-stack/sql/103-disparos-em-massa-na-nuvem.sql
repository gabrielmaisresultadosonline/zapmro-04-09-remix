-- ============================================================
-- 103 - Disparos em massa persistentes na VPS
-- Aditivo e idempotente: não remove nem altera campanhas antigas.
-- ============================================================

ALTER TABLE public.crm_broadcasts
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid,
  ADD COLUMN IF NOT EXISTS template_config jsonb,
  ADD COLUMN IF NOT EXISTS apply_tag text,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS stopped_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS crm_broadcasts_worker_idx
  ON public.crm_broadcasts (status, next_run_at)
  WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS public.crm_broadcast_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  broadcast_id uuid NOT NULL REFERENCES public.crm_broadcasts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  whatsapp_number_id uuid,
  wa_id text NOT NULL,
  recipient_name text,
  sequence_number integer NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  meta_message_id text,
  error_code text,
  error_message text,
  locked_at timestamptz,
  locked_by uuid,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, sequence_number),
  UNIQUE (broadcast_id, wa_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_broadcast_items TO authenticated;
GRANT ALL ON public.crm_broadcast_items TO service_role;

CREATE INDEX IF NOT EXISTS crm_broadcast_items_queue_idx
  ON public.crm_broadcast_items (broadcast_id, status, sequence_number);
CREATE INDEX IF NOT EXISTS crm_broadcast_items_user_idx
  ON public.crm_broadcast_items (user_id, created_at DESC);

ALTER TABLE public.crm_broadcast_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own broadcast items" ON public.crm_broadcast_items;
CREATE POLICY "Users can view their own broadcast items"
  ON public.crm_broadcast_items FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.crm_is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can insert their own broadcast items" ON public.crm_broadcast_items;
CREATE POLICY "Users can insert their own broadcast items"
  ON public.crm_broadcast_items FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.crm_broadcasts b
      WHERE b.id = broadcast_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own broadcast items" ON public.crm_broadcast_items;
CREATE POLICY "Users can update their own broadcast items"
  ON public.crm_broadcast_items FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own broadcast items" ON public.crm_broadcast_items;
CREATE POLICY "Users can delete their own broadcast items"
  ON public.crm_broadcast_items FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Reivindica um destinatário de forma atômica. Dois workers nunca recebem o
-- mesmo item. Um item antigo preso em processing vira falha incerta, em vez de
-- ser reenviado automaticamente e poder gerar duplicidade.
CREATE OR REPLACE FUNCTION public.crm_claim_broadcast_item(
  p_worker_id uuid,
  p_broadcast_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
) RETURNS TABLE (
  item_id uuid,
  claimed_broadcast_id uuid,
  claimed_user_id uuid,
  claimed_whatsapp_number_id uuid,
  wa_id text,
  recipient_name text,
  sequence_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id uuid;
BEGIN
  UPDATE public.crm_broadcast_items i
     SET status = 'failed',
         error_code = 'WORKER_INTERRUPTED',
         error_message = 'O processamento foi interrompido antes da confirmação. Revise este destinatário antes de reenviar.',
         processed_at = now(),
         updated_at = now()
   WHERE i.status = 'processing'
     AND i.locked_at < now() - interval '10 minutes';

  SELECT b.id INTO v_broadcast_id
    FROM public.crm_broadcasts b
   WHERE b.status IN ('pending', 'running')
     AND COALESCE(b.next_run_at, now()) <= now()
     AND (p_broadcast_id IS NULL OR b.id = p_broadcast_id)
     AND (p_user_id IS NULL OR b.user_id = p_user_id)
     AND EXISTS (
       SELECT 1 FROM public.crm_broadcast_items qi
       WHERE qi.broadcast_id = b.id AND qi.status = 'queued'
     )
   ORDER BY COALESCE(b.next_run_at, b.created_at), b.created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_broadcast_id IS NULL THEN RETURN; END IF;

  UPDATE public.crm_broadcasts
     SET status = 'running', last_heartbeat_at = now(), updated_at = now()
   WHERE id = v_broadcast_id;

  RETURN QUERY
  UPDATE public.crm_broadcast_items i
     SET status = 'processing', attempts = attempts + 1,
         locked_at = now(), locked_by = p_worker_id, updated_at = now()
   WHERE i.id = (
     SELECT qi.id FROM public.crm_broadcast_items qi
      WHERE qi.broadcast_id = v_broadcast_id AND qi.status = 'queued'
      ORDER BY qi.sequence_number
      LIMIT 1 FOR UPDATE SKIP LOCKED
   )
  RETURNING i.id, i.broadcast_id, i.user_id, i.whatsapp_number_id,
            i.wa_id, i.recipient_name, i.sequence_number;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_claim_broadcast_item(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_claim_broadcast_item(uuid, uuid, uuid) TO service_role;

-- Campanhas antigas que ficaram "running" no navegador permanecem intactas;
-- somente novas campanhas com itens persistidos são processadas pelo worker.