-- ============================================================
-- 126 - Aviso de ATENDIMENTO HUMANO no Agente I.A.
-- Aditiva e idempotente. Por número, o valor fica em
-- crm_whatsapp_numbers.number_settings; aqui só o padrão legado.
-- ============================================================
ALTER TABLE public.crm_settings
  ADD COLUMN IF NOT EXISTS ai_human_alert_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_human_alert_phone text;

NOTIFY pgrst, 'reload schema';
