-- ============================================================
-- 112 - Acelera o painel de armazenamento do AdminCentral
-- Evita uma varredura completa das mensagens para cada número cadastrado.
-- ============================================================

CREATE INDEX IF NOT EXISTS crm_messages_user_number_storage_idx
  ON public.crm_messages (user_id, whatsapp_number_id, created_at DESC);

CREATE INDEX IF NOT EXISTS crm_contacts_user_number_storage_idx
  ON public.crm_contacts (user_id, whatsapp_number_id);

CREATE INDEX IF NOT EXISTS crm_media_assets_user_url_storage_idx
  ON public.crm_media_assets (user_id, public_url);

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
  WITH numbers AS (
    SELECT n.*, u.email::text AS email, p.full_name
      FROM public.crm_whatsapp_numbers n
      LEFT JOIN auth.users u ON u.id = n.user_id
      LEFT JOIN public.crm_profiles p ON p.user_id = n.user_id
  ), messages_by_number AS (
    SELECT n.id AS number_id,
           count(m.id)::bigint AS messages_count,
           COALESCE(sum(pg_column_size(m)), 0)::bigint AS message_bytes,
           max(m.created_at) AS last_message_at
      FROM numbers n
      LEFT JOIN public.crm_messages m
        ON m.user_id = n.user_id
       AND (m.whatsapp_number_id = n.id OR (m.whatsapp_number_id IS NULL AND n.is_primary))
     GROUP BY n.id
  ), contacts_by_number AS (
    SELECT n.id AS number_id, count(c.id)::bigint AS contacts_count
      FROM numbers n
      LEFT JOIN public.crm_contacts c
        ON c.user_id = n.user_id
       AND (c.whatsapp_number_id = n.id OR (c.whatsapp_number_id IS NULL AND n.is_primary))
     GROUP BY n.id
  ), media_by_number AS (
    SELECT x.number_id, COALESCE(sum(a.size_bytes), 0)::bigint AS media_bytes
      FROM (
        SELECT DISTINCT n.id AS number_id, m.user_id, m.media_url
          FROM numbers n
          JOIN public.crm_messages m
            ON m.user_id = n.user_id
           AND (m.whatsapp_number_id = n.id OR (m.whatsapp_number_id IS NULL AND n.is_primary))
         WHERE m.media_url IS NOT NULL
      ) x
      JOIN public.crm_media_assets a
        ON a.user_id = x.user_id AND a.public_url = x.media_url
     GROUP BY x.number_id
  ), cleanup_by_number AS (
    SELECT whatsapp_number_id AS number_id, max(cleaned_at) AS last_cleanup_at
      FROM public.crm_storage_cleanup_events
     GROUP BY whatsapp_number_id
  )
  SELECT n.user_id, n.email, n.full_name, n.id, n.label,
         n.meta_display_phone_number, n.meta_verified_name, n.is_active, n.is_primary,
         COALESCE(m.messages_count, 0), COALESCE(c.contacts_count, 0),
         COALESCE(m.message_bytes, 0), COALESCE(md.media_bytes, 0),
         COALESCE(m.message_bytes, 0) + COALESCE(md.media_bytes, 0),
         m.last_message_at, ce.last_cleanup_at
    FROM numbers n
    LEFT JOIN messages_by_number m ON m.number_id = n.id
    LEFT JOIN contacts_by_number c ON c.number_id = n.id
    LEFT JOIN media_by_number md ON md.number_id = n.id
    LEFT JOIN cleanup_by_number ce ON ce.number_id = n.id
   ORDER BY (COALESCE(m.message_bytes, 0) + COALESCE(md.media_bytes, 0)) DESC,
            n.email, n.created_at;
$$;

REVOKE ALL ON FUNCTION public.crm_admin_storage_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_storage_overview() TO service_role;

NOTIFY pgrst, 'reload schema';