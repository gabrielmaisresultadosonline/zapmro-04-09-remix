-- ============================================================
-- 121 - Automações separadas por número de WhatsApp
-- ------------------------------------------------------------
-- Agente I.A., Recuperador, gatilho de 24h, prompt, fluxo inicial e
-- horário de atendimento passam a ser de cada número. Cada número
-- começa com uma cópia do que o cadastro tinha; daqui em diante
-- alterar um número não muda os outros. Idempotente.
-- ============================================================

ALTER TABLE public.crm_whatsapp_numbers
  ADD COLUMN IF NOT EXISTS number_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.crm_whatsapp_numbers n
SET number_settings = (
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'ai_agent_enabled', s.ai_agent_enabled,
    'ai_kanban_auto_organizer', s.ai_kanban_auto_organizer,
    'ai_send_bundled', s.ai_send_bundled,
    'ai_operation_mode', s.ai_operation_mode,
    'ai_system_prompt', s.ai_system_prompt,
    'ai_recovery_enabled', s.ai_recovery_enabled,
    'ai_recovery_delay_minutes', s.ai_recovery_delay_minutes,
    'ai_recovery_max_attempts', s.ai_recovery_max_attempts,
    'ai_recovery_finalized_status', s.ai_recovery_finalized_status,
    'ai_recovery_scope', s.ai_recovery_scope,
    'ai_agent_trigger', s.ai_agent_trigger,
    'ai_agent_trigger_keyword', s.ai_agent_trigger_keyword,
    'ai_agent_prompt', s.ai_agent_prompt,
    'ai_agent_label_on_transfer', s.ai_agent_label_on_transfer,
    'business_description', s.business_description,
    'countdown_trigger_enabled', s.countdown_trigger_enabled,
    'countdown_trigger_message_type', s.countdown_trigger_message_type,
    'countdown_trigger_content', s.countdown_trigger_content,
    'countdown_trigger_threshold_minutes', s.countdown_trigger_threshold_minutes,
    'countdown_trigger_template_id', s.countdown_trigger_template_id,
    -- Fluxo só é copiado para o número dono dele (fluxos são por número).
    'countdown_trigger_flow_id', (SELECT f.id FROM public.crm_flows f
                                  WHERE f.id = s.countdown_trigger_flow_id
                                    AND (f.whatsapp_number_id = n.id OR f.whatsapp_number_id IS NULL))
  ))
  FROM public.crm_settings s
  WHERE s.user_id = n.user_id
)
WHERE n.number_settings = '{}'::jsonb
  AND EXISTS (SELECT 1 FROM public.crm_settings s WHERE s.user_id = n.user_id);
