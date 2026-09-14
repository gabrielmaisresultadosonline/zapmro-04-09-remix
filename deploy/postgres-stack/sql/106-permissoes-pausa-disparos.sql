-- ============================================================
-- 106 - Permissões seguras para pausar/retomar disparos
-- Aditivo e idempotente: não altera campanhas nem itens existentes.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_broadcasts TO authenticated;
GRANT ALL ON public.crm_broadcasts TO service_role;

ALTER TABLE public.crm_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own data" ON public.crm_broadcasts;
CREATE POLICY "Users can only access their own data"
  ON public.crm_broadcasts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.crm_is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can only update their own data" ON public.crm_broadcasts;
CREATE POLICY "Users can only update their own data"
  ON public.crm_broadcasts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
