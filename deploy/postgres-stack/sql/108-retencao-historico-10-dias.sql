-- ============================================================
-- 108 - Retenção automática de históricos inativos por 10 dias
-- Idempotente e aditiva: preserva contatos, configurações e integrações.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_retention_notice_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notice_version text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, notice_version)
);

GRANT SELECT, INSERT ON public.crm_retention_notice_views TO authenticated;
GRANT ALL ON public.crm_retention_notice_views TO service_role;

ALTER TABLE public.crm_retention_notice_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own retention notices" ON public.crm_retention_notice_views;
CREATE POLICY "Users read own retention notices"
  ON public.crm_retention_notice_views
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users register own retention notices" ON public.crm_retention_notice_views;
CREATE POLICY "Users register own retention notices"
  ON public.crm_retention_notice_views
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS crm_messages_retention_contact_created_idx
  ON public.crm_messages (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

-- Remove um lote de históricos cuja mensagem mais recente, recebida OU enviada,
-- já tenha mais de 10 dias. O contato permanece intacto. As URLs catalogadas são
-- colocadas na lixeira para o media-gc fazer uma última verificação antes de
-- remover o objeto físico do servidor.
CREATE OR REPLACE FUNCTION public.crm_cleanup_inactive_histories(
  p_inactive_days integer DEFAULT 10,
  p_contact_limit integer DEFAULT 100
) RETURNS TABLE (
  deleted_contacts integer,
  deleted_messages bigint,
  queued_media integer,
  deleted_payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(1, COALESCE(p_inactive_days, 10)));
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.retention_contacts (
    contact_id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.retention_contacts;

  INSERT INTO pg_temp.retention_contacts (contact_id)
  SELECT m.contact_id
    FROM public.crm_messages m
   WHERE m.contact_id IS NOT NULL
   GROUP BY m.contact_id
  HAVING max(m.created_at) < v_cutoff
   ORDER BY max(m.created_at)
   LIMIT LEAST(1000, GREATEST(1, COALESCE(p_contact_limit, 100)));

  SELECT count(*)::integer INTO deleted_contacts FROM pg_temp.retention_contacts;
  IF deleted_contacts = 0 THEN
    deleted_messages := 0;
    queued_media := 0;
    deleted_payload := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  WITH removed AS (
    DELETE FROM public.crm_messages m
     USING pg_temp.retention_contacts c
     WHERE m.contact_id = c.contact_id
     RETURNING m.id, m.user_id, m.media_url, m.content, m.metadata
  ), payload AS (
    SELECT count(*)::bigint AS amount,
           COALESCE(jsonb_agg(to_jsonb(removed)), '[]'::jsonb) AS rows
      FROM removed
  )
  SELECT amount, rows INTO deleted_messages, deleted_payload FROM payload;

  -- Arquivos registrados no catálogo entram imediatamente na lixeira. A remoção
  -- física continua condicionada à verificação final do worker media-gc.
  WITH removed_urls AS (
    SELECT DISTINCT
           row_data->>'user_id' AS user_id,
           row_data->>'media_url' AS public_url
      FROM jsonb_array_elements(deleted_payload) AS row_data
     WHERE COALESCE(row_data->>'media_url', '') <> ''
  ), queued AS (
    INSERT INTO public.crm_media_gc_queue
      (media_asset_id, user_id, bucket, path, public_url, reason, purge_after)
    SELECT a.id, a.user_id, a.bucket, a.path, a.public_url,
           'retencao-historico-10-dias', now()
      FROM public.crm_media_assets a
      JOIN removed_urls r
        ON r.user_id::uuid = a.user_id AND r.public_url = a.public_url
     WHERE NOT EXISTS (
       SELECT 1 FROM public.crm_media_gc_queue q
        WHERE q.user_id = a.user_id AND q.bucket = a.bucket
          AND q.path = a.path AND q.status = 'pending'
     )
    ON CONFLICT (user_id, bucket, path) WHERE status = 'pending' DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO queued_media FROM queued;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_cleanup_inactive_histories(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_cleanup_inactive_histories(integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';