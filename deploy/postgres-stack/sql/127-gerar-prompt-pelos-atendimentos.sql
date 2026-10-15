-- ============================================================
-- 127 - Gerar prompt do Agente I.A. a partir dos últimos atendimentos
-- Um trabalho por WhatsApp, processado em segundo plano no servidor
-- (lotes pequenos, com trava), sem depender da tela aberta.
-- Aditiva e idempotente: nada existente é alterado ou apagado.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_ai_prompt_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  whatsapp_number_id uuid REFERENCES public.crm_whatsapp_numbers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
  phase text NOT NULL DEFAULT 'reading'
    CHECK (phase IN ('reading', 'writing', 'done')),
  days integer NOT NULL DEFAULT 5,
  contact_ids uuid[] NOT NULL DEFAULT '{}',
  cursor integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  message_count integer NOT NULL DEFAULT 0,
  audio_count integer NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  low_volume boolean NOT NULL DEFAULT false,
  result_prompt text,
  error text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_ai_prompt_jobs_running_idx
  ON public.crm_ai_prompt_jobs (status, lease_until) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS crm_ai_prompt_jobs_owner_idx
  ON public.crm_ai_prompt_jobs (user_id, whatsapp_number_id, created_at DESC);
-- No máximo um trabalho em andamento por WhatsApp.
CREATE UNIQUE INDEX IF NOT EXISTS crm_ai_prompt_jobs_one_running_uidx
  ON public.crm_ai_prompt_jobs (user_id, COALESCE(whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'running';

GRANT SELECT ON public.crm_ai_prompt_jobs TO authenticated;
GRANT ALL ON public.crm_ai_prompt_jobs TO service_role;
ALTER TABLE public.crm_ai_prompt_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_ai_prompt_jobs_owner_read ON public.crm_ai_prompt_jobs;
CREATE POLICY crm_ai_prompt_jobs_owner_read ON public.crm_ai_prompt_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Reserva atômica de um trabalho (trava de 3 min) para um único processador.
CREATE OR REPLACE FUNCTION public.crm_claim_ai_prompt_job(p_job_id uuid DEFAULT NULL)
RETURNS SETOF public.crm_ai_prompt_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.crm_ai_prompt_jobs j
     SET lease_until = now() + interval '3 minutes',
         attempts = j.attempts + 1,
         updated_at = now()
   WHERE j.id = (
     SELECT id FROM public.crm_ai_prompt_jobs
      WHERE status = 'running'
        AND (lease_until IS NULL OR lease_until < now())
        AND (p_job_id IS NULL OR id = p_job_id)
      ORDER BY updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.crm_claim_ai_prompt_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_claim_ai_prompt_job(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
