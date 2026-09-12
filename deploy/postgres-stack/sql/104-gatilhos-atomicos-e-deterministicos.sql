-- 104 — Reserva atômica de gatilhos automáticos
--
-- Evita que duas mensagens recebidas quase ao mesmo tempo iniciem fluxos
-- diferentes para o mesmo contato. A comparação com o fluxo anterior torna
-- a atualização um compare-and-swap: apenas o primeiro webhook vence.
-- Não altera histórico, credenciais, configurações ou fluxos existentes.

CREATE OR REPLACE FUNCTION public.crm_claim_flow_trigger(
  p_contact_id uuid,
  p_user_id uuid,
  p_flow_id uuid,
  p_start_node_id text,
  p_expected_flow_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.crm_flows f
     WHERE f.id = p_flow_id
       AND f.user_id = p_user_id
       AND f.is_active = true
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.crm_contacts c
     SET current_flow_id = p_flow_id,
         current_node_id = p_start_node_id,
         flow_state = 'running',
         ai_active = false,
         next_execution_time = NULL,
         last_flow_interaction = now()
   WHERE c.id = p_contact_id
     AND c.user_id = p_user_id
     AND c.current_flow_id IS NOT DISTINCT FROM p_expected_flow_id;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_claim_flow_trigger(uuid, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_claim_flow_trigger(uuid, uuid, uuid, text, uuid) TO service_role;

CREATE INDEX IF NOT EXISTS crm_flows_trigger_lookup_idx
  ON public.crm_flows (user_id, whatsapp_number_id, is_active, trigger_type, created_at, id);