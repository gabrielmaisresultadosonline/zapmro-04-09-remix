-- ============================================================
-- 105 - Consulta segura do histórico de destinatários enviados
-- Aditivo e idempotente: não altera nem remove campanhas existentes.
-- ============================================================

CREATE INDEX IF NOT EXISTS crm_broadcast_items_sent_lookup_idx
  ON public.crm_broadcast_items (user_id, whatsapp_number_id, wa_id)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS crm_broadcast_items_processing_lookup_idx
  ON public.crm_broadcast_items (locked_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.crm_find_previously_sent_numbers(
  p_whatsapp_number_id uuid,
  p_wa_ids text[]
) RETURNS TABLE (wa_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested AS (
    SELECT DISTINCT regexp_replace(value, '[^0-9]', '', 'g') AS normalized
      FROM unnest(COALESCE(p_wa_ids, ARRAY[]::text[])) value
     WHERE value IS NOT NULL
       AND regexp_replace(value, '[^0-9]', '', 'g') <> ''
  ), confirmed_items AS (
    SELECT DISTINCT regexp_replace(i.wa_id, '[^0-9]', '', 'g') AS normalized
      FROM public.crm_broadcast_items i
      JOIN requested r
        ON r.normalized = regexp_replace(i.wa_id, '[^0-9]', '', 'g')
     WHERE i.user_id = auth.uid()
       AND i.whatsapp_number_id IS NOT DISTINCT FROM p_whatsapp_number_id
       AND i.status = 'sent'
  ), compatible_legacy AS (
    -- Campanhas antigas não possuem itens individuais. Só consideramos as que
    -- foram concluídas e pertencem exatamente à mesma caixa WhatsApp.
    SELECT DISTINCT regexp_replace(value, '[^0-9]', '', 'g') AS normalized
      FROM public.crm_broadcasts b
      CROSS JOIN LATERAL unnest(COALESCE(b.uploaded_numbers, ARRAY[]::text[])) value
      JOIN requested r
        ON r.normalized = regexp_replace(value, '[^0-9]', '', 'g')
     WHERE b.user_id = auth.uid()
       AND b.whatsapp_number_id IS NOT DISTINCT FROM p_whatsapp_number_id
       AND b.status = 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_broadcast_items i WHERE i.broadcast_id = b.id
       )
  )
  SELECT normalized AS wa_id FROM confirmed_items
  UNION
  SELECT normalized AS wa_id FROM compatible_legacy;
$$;

REVOKE ALL ON FUNCTION public.crm_find_previously_sent_numbers(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_find_previously_sent_numbers(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_find_previously_sent_numbers(uuid, text[]) TO service_role;
