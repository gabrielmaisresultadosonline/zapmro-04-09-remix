-- ============================================================
-- 125 - Contas Google Contatos separadas por WhatsApp
-- ------------------------------------------------------------
-- Cada conta Google pode pertencer a um WhatsApp do cadastro
-- (whatsapp_number_id). Só os contatos daquele WhatsApp são
-- importados/exportados por ela. share_all_numbers = true volta a
-- juntar os contatos de todos os WhatsApps do cadastro.
-- Contas antigas ficam com whatsapp_number_id NULL = compartilhadas,
-- exatamente como funcionavam antes. Aditiva e idempotente.
-- ============================================================

ALTER TABLE public.crm_google_accounts
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid
    REFERENCES public.crm_whatsapp_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS share_all_numbers boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS crm_google_accounts_number_idx
  ON public.crm_google_accounts (whatsapp_number_id);

NOTIFY pgrst, 'reload schema';
