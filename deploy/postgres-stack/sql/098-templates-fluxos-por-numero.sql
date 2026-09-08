-- ============================================================
-- 098 - Templates e fluxos separados por número de WhatsApp
-- ------------------------------------------------------------
-- Cadastros com 2+ números (crm_whatsapp_numbers) precisam de
-- bancos de dados independentes por número: cada número tem seus
-- próprios templates aprovados (crm_templates) e seus próprios
-- fluxos (crm_flows). Antes, tudo era filtrado só por user_id e
-- os templates/fluxos de um número apareciam nos outros.
--
-- Regra de leitura (app e edge functions):
--   whatsapp_number_id = <número aberto>  -> dado daquele número
--   whatsapp_number_id IS NULL            -> legado/compartilhado
--
-- O backfill abaixo atribui os registros existentes ao número
-- principal do cadastro (o mesmo das credenciais em crm_settings),
-- e a próxima sincronização com a Meta corrige a propriedade de
-- cada template, pois o upsert grava o número que sincronizou.
-- Idempotente.
-- ============================================================

ALTER TABLE public.crm_templates
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid
  REFERENCES public.crm_whatsapp_numbers(id) ON DELETE CASCADE;

ALTER TABLE public.crm_flows
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid
  REFERENCES public.crm_whatsapp_numbers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS crm_templates_user_number_idx
  ON public.crm_templates (user_id, whatsapp_number_id);

CREATE INDEX IF NOT EXISTS crm_flows_user_number_idx
  ON public.crm_flows (user_id, whatsapp_number_id);

-- Backfill 1: número cujas credenciais estão ativas em crm_settings.
UPDATE public.crm_templates t
SET whatsapp_number_id = n.id
FROM public.crm_whatsapp_numbers n, public.crm_settings s
WHERE t.whatsapp_number_id IS NULL
  AND s.user_id = t.user_id
  AND n.user_id = t.user_id
  AND n.meta_phone_number_id IS NOT NULL
  AND n.meta_phone_number_id = s.meta_phone_number_id;

UPDATE public.crm_flows f
SET whatsapp_number_id = n.id
FROM public.crm_whatsapp_numbers n, public.crm_settings s
WHERE f.whatsapp_number_id IS NULL
  AND s.user_id = f.user_id
  AND n.user_id = f.user_id
  AND n.meta_phone_number_id IS NOT NULL
  AND n.meta_phone_number_id = s.meta_phone_number_id;

-- Backfill 2: demais registros vão para o número principal/mais antigo.
UPDATE public.crm_templates t
SET whatsapp_number_id = (
  SELECT n.id
  FROM public.crm_whatsapp_numbers n
  WHERE n.user_id = t.user_id
  ORDER BY n.is_primary DESC NULLS LAST, n.created_at ASC
  LIMIT 1
)
WHERE t.whatsapp_number_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.crm_whatsapp_numbers n WHERE n.user_id = t.user_id
  );

UPDATE public.crm_flows f
SET whatsapp_number_id = (
  SELECT n.id
  FROM public.crm_whatsapp_numbers n
  WHERE n.user_id = f.user_id
  ORDER BY n.is_primary DESC NULLS LAST, n.created_at ASC
  LIMIT 1
)
WHERE f.whatsapp_number_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.crm_whatsapp_numbers n WHERE n.user_id = f.user_id
  );
