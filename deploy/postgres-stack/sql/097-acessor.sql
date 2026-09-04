-- ============================================================
-- 097 - Módulo /acessor (agente de agendamentos + organização financeira)
-- ------------------------------------------------------------
-- Projeto separado do CRM: nenhuma tabela existente é alterada.
-- Idempotente: pode rodar quantas vezes precisar.
-- ============================================================

-- ---------- cadastros ---------------------------------------
CREATE TABLE IF NOT EXISTS public.acessor_profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  whatsapp text,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'expired', 'blocked')),
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '2 days'),
  active_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.acessor_profiles TO authenticated;
GRANT ALL ON public.acessor_profiles TO service_role;
ALTER TABLE public.acessor_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='acessor_profiles' AND policyname='acessor_profiles_owner') THEN
    CREATE POLICY acessor_profiles_owner ON public.acessor_profiles
      FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  END IF;
END $$;

-- ---------- números de WhatsApp autorizados -----------------
CREATE TABLE IF NOT EXISTS public.acessor_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone text NOT NULL,               -- somente dígitos (E.164 sem "+")
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS acessor_numbers_phone_key ON public.acessor_numbers (phone);
CREATE INDEX IF NOT EXISTS acessor_numbers_user_idx ON public.acessor_numbers (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.acessor_numbers TO authenticated;
GRANT ALL ON public.acessor_numbers TO service_role;
ALTER TABLE public.acessor_numbers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='acessor_numbers' AND policyname='acessor_numbers_owner') THEN
    CREATE POLICY acessor_numbers_owner ON public.acessor_numbers
      FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ---------- anotações financeiras ---------------------------
CREATE TABLE IF NOT EXISTS public.acessor_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('gasto', 'entrada', 'investimento', 'nota')),
  description text NOT NULL,
  amount numeric(14,2),
  category text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  raw_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acessor_entries_user_idx ON public.acessor_entries (user_id, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.acessor_entries TO authenticated;
GRANT ALL ON public.acessor_entries TO service_role;
ALTER TABLE public.acessor_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='acessor_entries' AND policyname='acessor_entries_owner') THEN
    CREATE POLICY acessor_entries_owner ON public.acessor_entries
      FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ---------- agendamentos ------------------------------------
CREATE TABLE IF NOT EXISTS public.acessor_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado', 'concluido', 'cancelado')),
  raw_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acessor_appointments_user_idx ON public.acessor_appointments (user_id, starts_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.acessor_appointments TO authenticated;
GRANT ALL ON public.acessor_appointments TO service_role;
ALTER TABLE public.acessor_appointments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='acessor_appointments' AND policyname='acessor_appointments_owner') THEN
    CREATE POLICY acessor_appointments_owner ON public.acessor_appointments
      FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ---------- histórico de mensagens do agente ----------------
CREATE TABLE IF NOT EXISTS public.acessor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  wa_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  body text,
  meta_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS acessor_messages_meta_id_key
  ON public.acessor_messages (meta_message_id) WHERE meta_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS acessor_messages_wa_idx ON public.acessor_messages (wa_id, created_at DESC);

GRANT SELECT ON public.acessor_messages TO authenticated;
GRANT ALL ON public.acessor_messages TO service_role;
ALTER TABLE public.acessor_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='acessor_messages' AND policyname='acessor_messages_owner') THEN
    CREATE POLICY acessor_messages_owner ON public.acessor_messages
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- ---------- configurações globais (somente admin/servidor) ---
CREATE TABLE IF NOT EXISTS public.acessor_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  openai_api_key text,
  openai_model text NOT NULL DEFAULT 'gpt-4o-mini',
  meta_access_token text,
  meta_phone_number_id text,
  meta_waba_id text,
  meta_business_id text,
  meta_app_id text,
  meta_app_secret text,
  meta_verify_token text,
  meta_display_phone_number text,
  coexistence boolean NOT NULL DEFAULT false,
  agent_prompt text,
  unregistered_prompt text,
  trial_days integer NOT NULL DEFAULT 2,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.acessor_settings TO service_role;
ALTER TABLE public.acessor_settings ENABLE ROW LEVEL SECURITY;
-- Sem policy para authenticated/anon: apenas o service_role (Edge Functions) lê/escreve.

INSERT INTO public.acessor_settings (id, agent_prompt, unregistered_prompt)
VALUES (
  1,
  'Você é o Acessor, assistente de agendamentos e organização financeira. Interprete a mensagem do cliente e registre gastos, entradas, investimentos, anotações e compromissos. Responda curto, em português do Brasil, confirmando o que foi anotado.',
  'Olá! Não encontrei este número em nenhum cadastro ativo do Acessor. Crie seu cadastro (2 dias de teste grátis), ative este mesmo número no painel e volte a falar comigo por aqui.'
)
ON CONFLICT (id) DO NOTHING;
