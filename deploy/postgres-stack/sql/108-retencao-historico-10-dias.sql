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
  queued_media integer
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
    RETURN NEXT;
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.retention_removed_media (
    user_id uuid NOT NULL,
    public_url text NOT NULL,
    PRIMARY KEY (user_id, public_url)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.retention_removed_media;

  WITH removed AS (
    DELETE FROM public.crm_messages m
     USING pg_temp.retention_contacts c
     WHERE m.contact_id = c.contact_id
     RETURNING m.user_id, m.media_url, m.content, m.metadata
  ), stored AS (
    INSERT INTO pg_temp.retention_removed_media (user_id, public_url)
    SELECT DISTINCT r.user_id, urls.public_url
      FROM removed r
      CROSS JOIN LATERAL (
        SELECT r.media_url AS public_url
        UNION ALL SELECT r.content
        UNION ALL
        SELECT trim(both '"' from value::text)
          FROM jsonb_path_query(COALESCE(r.metadata, '{}'::jsonb), '$.** ? (@.type() == "string")') value
      ) urls
     WHERE urls.public_url LIKE '%/storage/v1/object/public/%'
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::bigint INTO deleted_messages FROM removed;

  -- Arquivos registrados no catálogo entram imediatamente na lixeira. A remoção
  -- física continua condicionada à verificação final do worker media-gc.
  WITH parsed_urls AS (
    SELECT r.user_id, r.public_url,
           split_part(split_part(r.public_url, '/storage/v1/object/public/', 2), '/', 1) AS bucket,
           substring(split_part(r.public_url, '/storage/v1/object/public/', 2)
             from position('/' in split_part(r.public_url, '/storage/v1/object/public/', 2)) + 1) AS path
      FROM pg_temp.retention_removed_media r
  ), queued AS (
    INSERT INTO public.crm_media_gc_queue
      (media_asset_id, user_id, bucket, path, public_url, reason, purge_after)
    SELECT a.id, p.user_id, p.bucket, p.path, p.public_url,
           'retencao-historico-10-dias', now()
      FROM parsed_urls p
      LEFT JOIN public.crm_media_assets a
        ON a.user_id = p.user_id AND a.public_url = p.public_url
     WHERE p.bucket <> '' AND p.path <> ''
     WHERE NOT EXISTS (
       SELECT 1 FROM public.crm_media_gc_queue q
        WHERE q.user_id = p.user_id AND q.bucket = p.bucket
          AND q.path = p.path AND q.status = 'pending'
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