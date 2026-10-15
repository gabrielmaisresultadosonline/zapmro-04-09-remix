-- Admin Central: "Reiniciar todos" — sinal que faz cada CRM aberto recarregar a página.
-- Só o Admin Central (service_role) grava; usuários logados apenas leem para reagir.
CREATE TABLE IF NOT EXISTS public.crm_client_reload_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NULL, -- NULL = todos
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_client_reload_signals_created_idx
  ON public.crm_client_reload_signals (created_at DESC);

ALTER TABLE public.crm_client_reload_signals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.crm_client_reload_signals TO authenticated;
GRANT ALL ON public.crm_client_reload_signals TO service_role;

DROP POLICY IF EXISTS crm_client_reload_signals_read ON public.crm_client_reload_signals;
CREATE POLICY crm_client_reload_signals_read ON public.crm_client_reload_signals
  FOR SELECT TO authenticated
  USING (target_user_id IS NULL OR target_user_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename = 'crm_client_reload_signals'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_client_reload_signals;
  END IF;
END
$$;
