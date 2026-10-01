-- ============================================================
-- 110 - Armazenamento por cadastro/número e limpeza manual
-- Idempotente. Preserva contatos, números, configurações, fluxos e templates.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_storage_cleanup_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  whatsapp_number_id uuid REFERENCES public.crm_whatsapp_numbers(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('admin_manual', 'automatic_30_days')),
  deleted_messages bigint NOT NULL DEFAULT 0,
  estimated_freed_bytes bigint NOT NULL DEFAULT 0,
  cleaned_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.crm_storage_cleanup_events TO authenticated;
GRANT ALL ON public.crm_storage_cleanup_events TO service_role;

CREATE INDEX IF NOT EXISTS crm_storage_cleanup_events_user_pending_idx
  ON public.crm_storage_cleanup_events (user_id, cleaned_at DESC)
  WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS crm_storage_cleanup_events_number_idx
  ON public.crm_storage_cleanup_events (whatsapp_number_id, cleaned_at DESC);

ALTER TABLE public.crm_storage_cleanup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_storage_cleanup_events_owner_select ON public.crm_storage_cleanup_events;
CREATE POLICY crm_storage_cleanup_events_owner_select
  ON public.crm_storage_cleanup_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS crm_storage_cleanup_events_owner_ack ON public.crm_storage_cleanup_events;
CREATE POLICY crm_storage_cleanup_events_owner_ack
  ON public.crm_storage_cleanup_events FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Lista administrativa. O tamanho é estimado pela linha PostgreSQL mais os
-- arquivos catalogados, contando cada arquivo físico somente uma vez.
CREATE OR REPLACE FUNCTION public.crm_admin_storage_overview()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  whatsapp_number_id uuid,
  number_label text,
  display_phone_number text,
  verified_name text,
  is_connected boolean,
  is_primary boolean,
  messages_count bigint,
  contacts_count bigint,
  message_bytes bigint,
  media_bytes bigint,
  total_bytes bigint,
  last_message_at timestamptz,
  last_cleanup_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    n.user_id,
    u.email::text,
    p.full_name,
    n.id,
    n.label,
    n.meta_display_phone_number,
    n.meta_verified_name,
    n.is_active,
    n.is_primary,
    COALESCE(ms.messages_count, 0),
    COALESCE(cs.contacts_count, 0),
    COALESCE(ms.message_bytes, 0),
    COALESCE(md.media_bytes, 0),
    COALESCE(ms.message_bytes, 0) + COALESCE(md.media_bytes, 0),
    ms.last_message_at,
    ce.last_cleanup_at
  FROM public.crm_whatsapp_numbers n
  LEFT JOIN auth.users u ON u.id = n.user_id
  LEFT JOIN public.crm_profiles p ON p.user_id = n.user_id
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS messages_count,
           COALESCE(sum(pg_column_size(m)), 0)::bigint AS message_bytes,
           max(m.created_at) AS last_message_at
      FROM public.crm_messages m
     WHERE m.user_id = n.user_id
       AND (m.whatsapp_number_id = n.id OR (m.whatsapp_number_id IS NULL AND n.is_primary))
  ) ms ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS contacts_count
      FROM public.crm_contacts c
     WHERE c.user_id = n.user_id
       AND (c.whatsapp_number_id = n.id OR (c.whatsapp_number_id IS NULL AND n.is_primary))
  ) cs ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(x.size_bytes), 0)::bigint AS media_bytes
      FROM (
        SELECT DISTINCT a.id, COALESCE(a.size_bytes, 0)::bigint AS size_bytes
          FROM public.crm_media_assets a
         WHERE a.user_id = n.user_id
           AND EXISTS (
             SELECT 1
               FROM public.crm_messages m
              WHERE m.user_id = n.user_id
                AND (m.whatsapp_number_id = n.id OR (m.whatsapp_number_id IS NULL AND n.is_primary))
                AND (m.media_url = a.public_url OR m.content = a.public_url OR COALESCE(m.metadata::text, '') LIKE '%' || a.path || '%')
           )
      ) x
  ) md ON true
  LEFT JOIN LATERAL (
    SELECT max(e.cleaned_at) AS last_cleanup_at
      FROM public.crm_storage_cleanup_events e
     WHERE e.whatsapp_number_id = n.id
  ) ce ON true
  ORDER BY (COALESCE(ms.message_bytes, 0) + COALESCE(md.media_bytes, 0)) DESC,
           u.email, n.created_at;
$$;

REVOKE ALL ON FUNCTION public.crm_admin_storage_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_storage_overview() TO service_role;

-- Apaga somente o histórico da caixa escolhida. O registro do número, contatos,
-- configurações, fluxos e templates não são removidos.
CREATE OR REPLACE FUNCTION public.crm_admin_clear_number_storage(
  p_number_id uuid,
  p_user_id uuid
) RETURNS TABLE (
  deleted_messages bigint,
  estimated_freed_bytes bigint,
  queued_media integer,
  cleanup_event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_primary boolean;
  v_message_bytes bigint := 0;
  v_media_bytes bigint := 0;
BEGIN
  SELECT n.is_primary INTO v_is_primary
    FROM public.crm_whatsapp_numbers n
   WHERE n.id = p_number_id AND n.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Número não encontrado neste cadastro';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.storage_removed_messages (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    media_url text,
    content text,
    metadata jsonb,
    row_bytes bigint NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.storage_removed_messages;

  WITH removed AS (
    DELETE FROM public.crm_messages m
     WHERE m.user_id = p_user_id
       AND (m.whatsapp_number_id = p_number_id OR (m.whatsapp_number_id IS NULL AND v_is_primary))
     RETURNING m.id, m.user_id, m.media_url, m.content, m.metadata, pg_column_size(m)::bigint AS row_bytes
  )
  INSERT INTO pg_temp.storage_removed_messages
  SELECT * FROM removed;

  SELECT count(*)::bigint, COALESCE(sum(r.row_bytes), 0)::bigint
    INTO deleted_messages, v_message_bytes
    FROM pg_temp.storage_removed_messages r;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.storage_removed_media (
    user_id uuid NOT NULL,
    public_url text NOT NULL,
    removed_references integer NOT NULL,
    PRIMARY KEY (user_id, public_url)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.storage_removed_media;

  INSERT INTO pg_temp.storage_removed_media (user_id, public_url, removed_references)
  SELECT found.user_id, found.public_url, count(*)::integer
    FROM (
      SELECT DISTINCT r.id, r.user_id, urls.public_url
        FROM pg_temp.storage_removed_messages r
        CROSS JOIN LATERAL (
          SELECT r.media_url AS public_url
          UNION ALL SELECT r.content
          UNION ALL
          SELECT trim(both '"' from value::text)
            FROM jsonb_path_query(COALESCE(r.metadata, '{}'::jsonb), '$.** ? (@.type() == "string")') value
        ) urls
       WHERE urls.public_url LIKE '%/storage/v1/object/public/%'
    ) found
   GROUP BY found.user_id, found.public_url
  ON CONFLICT DO NOTHING;

  SELECT COALESCE(sum(COALESCE(a.size_bytes, 0)), 0)::bigint
    INTO v_media_bytes
    FROM public.crm_media_assets a
    JOIN pg_temp.storage_removed_media r
      ON r.user_id = a.user_id AND r.public_url = a.public_url;

  UPDATE public.crm_media_assets a
     SET reference_count = GREATEST(0, a.reference_count - r.removed_references),
         updated_at = now()
    FROM pg_temp.storage_removed_media r
   WHERE a.user_id = r.user_id AND a.public_url = r.public_url;

  WITH parsed AS (
    SELECT r.user_id, r.public_url,
           split_part(split_part(r.public_url, '/storage/v1/object/public/', 2), '/', 1) AS bucket,
           substring(split_part(r.public_url, '/storage/v1/object/public/', 2)
             from position('/' in split_part(r.public_url, '/storage/v1/object/public/', 2)) + 1) AS path
      FROM pg_temp.storage_removed_media r
  ), queued AS (
    INSERT INTO public.crm_media_gc_queue
      (media_asset_id, user_id, bucket, path, public_url, reason, purge_after)
    SELECT a.id, p.user_id, p.bucket, p.path, p.public_url,
           'limpeza-manual-admincentral', now()
      FROM parsed p
      LEFT JOIN public.crm_media_assets a
        ON a.user_id = p.user_id AND a.public_url = p.public_url
     WHERE p.bucket <> '' AND p.path <> ''
    ON CONFLICT (user_id, bucket, path) WHERE status = 'pending' DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO queued_media FROM queued;

  -- Remove somente os resumos derivados do histórico apagado.
  UPDATE public.crm_contacts c
     SET total_messages_received = 0,
         total_messages_sent = 0,
         last_message_received_at = NULL,
         last_read_at = now(),
         updated_at = now()
   WHERE c.user_id = p_user_id
     AND (c.whatsapp_number_id = p_number_id OR (c.whatsapp_number_id IS NULL AND v_is_primary));

  estimated_freed_bytes := v_message_bytes + v_media_bytes;

  IF deleted_messages > 0 THEN
    INSERT INTO public.crm_storage_cleanup_events
      (user_id, whatsapp_number_id, source, deleted_messages, estimated_freed_bytes)
    VALUES
      (p_user_id, p_number_id, 'admin_manual', deleted_messages, estimated_freed_bytes)
    RETURNING id INTO cleanup_event_id;
  ELSE
    cleanup_event_id := NULL;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_admin_clear_number_storage(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_clear_number_storage(uuid, uuid) TO service_role;

-- Atualiza o aviso geral e torna 30 dias o padrão oficial. O worker passa o
-- valor explicitamente, mas o default também protege chamadas administrativas.
UPDATE public.admin_announcements
   SET message = 'Históricos sem novas mensagens por mais de 30 dias serão apagados automaticamente. Contatos e conexões permanecem salvos.',
       updated_at = now()
 WHERE id = '10810810-0000-4000-8000-000000000001';

ALTER FUNCTION public.crm_cleanup_inactive_histories(integer, integer)
  RENAME TO crm_cleanup_inactive_histories_previous;

CREATE OR REPLACE FUNCTION public.crm_cleanup_inactive_histories(
  p_inactive_days integer DEFAULT 30,
  p_contact_limit integer DEFAULT 100
) RETURNS TABLE (
  deleted_contacts integer,
  deleted_messages bigint,
  queued_media integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.crm_cleanup_inactive_histories_previous(
    GREATEST(30, COALESCE(p_inactive_days, 30)),
    p_contact_limit
  );
$$;

REVOKE ALL ON FUNCTION public.crm_cleanup_inactive_histories(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_cleanup_inactive_histories(integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';