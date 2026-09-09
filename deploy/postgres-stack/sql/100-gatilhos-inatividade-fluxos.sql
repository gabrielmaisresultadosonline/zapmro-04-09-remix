-- 100 - Gatilhos de inatividade nos fluxos
-- Garante que os novos tipos de gatilho sejam aceitos pelo banco.
-- Mantém todos os tipos já existentes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_flows_trigger_type_check'
      AND conrelid = 'public.crm_flows'::regclass
  ) THEN
    ALTER TABLE public.crm_flows DROP CONSTRAINT crm_flows_trigger_type_check;
  END IF;

  ALTER TABLE public.crm_flows
    ADD CONSTRAINT crm_flows_trigger_type_check
    CHECK (trigger_type = ANY (ARRAY[
      'manual',
      'keyword',
      'exact_phrase',
      'first_message',
      'first_message_day',
      'after_24h',
      'all_messages',
      'new_contact',
      '24h_inactivity',
      'inactivity_30m',
      'inactivity_1h',
      'inactivity_2h'
    ]));
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Tabela crm_flows inexistente, ignorando.';
END $$;
