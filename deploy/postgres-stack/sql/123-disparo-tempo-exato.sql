-- 123 - Disparo respeita exatamente o intervalo configurado.
-- Aditiva: um único worker "segura" a campanha e espera o tempo exato entre envios.
ALTER TABLE public.crm_broadcasts
  ADD COLUMN IF NOT EXISTS worker_lease_owner uuid,
  ADD COLUMN IF NOT EXISTS worker_lease_until timestamptz;

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

  -- Recalcula os contadores a partir da fila persistente. Isso também fecha
  -- corretamente campanhas cujo último item foi recuperado como falha.
  UPDATE public.crm_broadcasts b
     SET sent_count = totals.processed,
         failed_count = totals.failed,
         status = CASE WHEN totals.remaining = 0 THEN 'completed' ELSE b.status END,
         completed_at = CASE WHEN totals.remaining = 0 THEN COALESCE(b.completed_at, now()) ELSE b.completed_at END,
         updated_at = now()
    FROM (
      SELECT broadcast_id,
             count(*) FILTER (WHERE status IN ('sent', 'failed', 'skipped'))::integer AS processed,
             count(*) FILTER (WHERE status = 'failed')::integer AS failed,
             count(*) FILTER (WHERE status IN ('queued', 'processing'))::integer AS remaining
        FROM public.crm_broadcast_items
       GROUP BY broadcast_id
    ) totals
   WHERE b.id = totals.broadcast_id
     AND b.status IN ('pending', 'running')
     AND (p_broadcast_id IS NULL OR b.id = p_broadcast_id)
     AND (p_user_id IS NULL OR b.user_id = p_user_id);

  SELECT b.id INTO v_broadcast_id
    FROM public.crm_broadcasts b
   WHERE b.status IN ('pending', 'running')
     AND COALESCE(b.next_run_at, now()) <= now()
     AND (b.worker_lease_until IS NULL OR b.worker_lease_until < now() OR b.worker_lease_owner = p_worker_id)
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
     SET status = 'running', last_heartbeat_at = now(), updated_at = now(),
         worker_lease_owner = p_worker_id, worker_lease_until = now() + interval '75 seconds'
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

NOTIFY pgrst, 'reload schema';
