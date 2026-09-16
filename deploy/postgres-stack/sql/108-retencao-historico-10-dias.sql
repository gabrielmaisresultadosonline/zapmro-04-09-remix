-- ============================================================
-- 108 - Retenção automática de históricos inativos por 10 dias
-- Idempotente e aditiva: preserva contatos, configurações e integrações.
-- ============================================================

-- Usa o mecanismo de avisos já existente. O UUID fixo identifica esta versão e
-- permite registrar a visualização uma única vez por usuário.
INSERT INTO public.admin_announcements
  (id, title, message, frequency, active, created_at, updated_at)
VALUES (
  '10810810-0000-4000-8000-000000000001',
  'Atenção: mudamos algumas configurações de armazenamento',
  'Retenção automática de históricos inativos por 10 dias.',
  'once',
  true,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
  SET title = EXCLUDED.title,
      message = EXCLUDED.message,
      frequency = EXCLUDED.frequency,
      active = EXCLUDED.active,
      updated_at = now();

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

  -- Serializa com as rotinas que atualizam o contato ao receber/enviar. Assim
  -- uma conversa retomada durante o lote fica para a próxima conferência.
  PERFORM 1
    FROM public.crm_contacts c
    JOIN pg_temp.retention_contacts r ON r.contact_id = c.id
   FOR UPDATE OF c;

  DELETE FROM pg_temp.retention_contacts c
   WHERE EXISTS (
     SELECT 1 FROM public.crm_messages m
      WHERE m.contact_id = c.contact_id AND m.created_at >= v_cutoff
   );

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
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_messages recent
          WHERE recent.contact_id = c.contact_id AND recent.created_at >= v_cutoff
       )
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
       AND NOT EXISTS (
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