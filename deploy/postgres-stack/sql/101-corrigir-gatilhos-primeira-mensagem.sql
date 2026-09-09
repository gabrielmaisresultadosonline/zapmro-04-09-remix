-- 101 - Corrige e valida os gatilhos automáticos de primeira mensagem.
-- Idempotente: pode ser reaplicado sem alterar fluxos, mensagens ou contatos.

DO $$
BEGIN
  IF to_regclass('public.crm_flows') IS NULL THEN
    RAISE NOTICE 'Tabela crm_flows inexistente, ignorando.';
    RETURN;
  END IF;

  ALTER TABLE public.crm_flows
    DROP CONSTRAINT IF EXISTS crm_flows_trigger_type_check;

  ALTER TABLE public.crm_flows
    ADD CONSTRAINT crm_flows_trigger_type_check
    CHECK (trigger_type = ANY (ARRAY[
      'manual', 'keyword', 'exact_phrase', 'first_message',
      'first_message_day', 'after_24h', 'all_messages', 'new_contact',
      '24h_inactivity', 'inactivity_30m', 'inactivity_1h', 'inactivity_2h'
    ]));
END $$;

DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO definition
    FROM pg_constraint
   WHERE conname = 'crm_flows_trigger_type_check'
     AND conrelid = 'public.crm_flows'::regclass;

  IF definition IS NULL
     OR position('first_message' IN definition) = 0
     OR position('first_message_day' IN definition) = 0 THEN
    RAISE EXCEPTION 'crm_flows não aceita first_message/first_message_day';
  END IF;
END $$;