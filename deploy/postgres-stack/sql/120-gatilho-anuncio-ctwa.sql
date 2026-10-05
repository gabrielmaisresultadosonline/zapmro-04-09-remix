-- 120 - Gatilho de fluxo "Veio de anúncio" (Click-to-WhatsApp).
-- Idempotente; mantém todos os gatilhos existentes.
DO $$
BEGIN
  IF to_regclass('public.crm_flows') IS NULL THEN RETURN; END IF;
  ALTER TABLE public.crm_flows DROP CONSTRAINT IF EXISTS crm_flows_trigger_type_check;
  ALTER TABLE public.crm_flows
    ADD CONSTRAINT crm_flows_trigger_type_check
    CHECK (trigger_type = ANY (ARRAY[
      'manual', 'keyword', 'exact_phrase', 'first_message',
      'first_message_day', 'after_24h', 'all_messages', 'new_contact',
      '24h_inactivity', 'inactivity_30m', 'inactivity_1h', 'inactivity_2h',
      'ctwa_ad'
    ]));
END $$;
