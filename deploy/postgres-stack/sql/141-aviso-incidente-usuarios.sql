-- ============================================================
-- 141 - Avisos únicos para usuários (popup ao entrar)
-- ------------------------------------------------------------
-- Cada linha é um aviso pendente para um usuário. O popup aparece
-- enquanto dismissed_at for NULL; ao clicar em "Fechar" ele é marcado.
-- O aviso do incidente de 05/11/2026 vai SÓ para quem já existia no
-- banco no momento da migração — cadastros novos não recebem.
-- Idempotente: reaplicar não recria avisos já fechados.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_user_notices (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notice_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  PRIMARY KEY (user_id, notice_key)
);

GRANT SELECT, UPDATE ON public.crm_user_notices TO authenticated;
GRANT ALL ON public.crm_user_notices TO service_role;
ALTER TABLE public.crm_user_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notices_select_own ON public.crm_user_notices;
CREATE POLICY user_notices_select_own ON public.crm_user_notices
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notices_dismiss_own ON public.crm_user_notices;
CREATE POLICY user_notices_dismiss_own ON public.crm_user_notices
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Usuário só pode marcar como fechado; não altera a chave nem o dono.
REVOKE UPDATE ON public.crm_user_notices FROM authenticated;
GRANT UPDATE (dismissed_at) ON public.crm_user_notices TO authenticated;

INSERT INTO public.crm_user_notices (user_id, notice_key)
SELECT u.id, 'incidente-2026-11-05'
  FROM auth.users u
 WHERE u.created_at < TIMESTAMPTZ '2026-11-06 18:00:00+00'
ON CONFLICT (user_id, notice_key) DO NOTHING;
