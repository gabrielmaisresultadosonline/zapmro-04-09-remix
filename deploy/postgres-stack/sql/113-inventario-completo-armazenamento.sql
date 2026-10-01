-- ============================================================
-- 113 - Inventário completo, somente leitura, de armazenamento
-- Mede todos os registros com user_id sem expor seu conteúdo.
-- ============================================================

ALTER TABLE public.crm_vps_storage_snapshots
  ADD COLUMN IF NOT EXISTS root_total_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS root_used_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS root_available_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS docker_total_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS project_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS system_logs_bytes bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.crm_customer_storage_snapshots (
  user_id uuid PRIMARY KEY,
  email text,
  full_name text,
  database_row_bytes bigint NOT NULL DEFAULT 0,
  media_file_bytes bigint NOT NULL DEFAULT 0,
  total_bytes bigint NOT NULL DEFAULT 0,
  total_rows bigint NOT NULL DEFAULT 0,
  categories jsonb NOT NULL DEFAULT '{}'::jsonb,
  table_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_numbers integer NOT NULL DEFAULT 0,
  disconnected_numbers integer NOT NULL DEFAULT 0,
  removed_numbers integer NOT NULL DEFAULT 0,
  measured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.crm_customer_storage_snapshots TO service_role;
ALTER TABLE public.crm_customer_storage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crm_refresh_customer_storage_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  table_row record;
  category_name text;
  refreshed integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.crm_storage_rows (
    user_id uuid NOT NULL,
    table_name text NOT NULL,
    category text NOT NULL,
    row_count bigint NOT NULL,
    row_bytes bigint NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.crm_storage_rows;

  FOR table_row IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'user_id'
       AND c.udt_name = 'uuid'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('crm_customer_storage_snapshots')
     ORDER BY c.table_name
  LOOP
    category_name := CASE
      WHEN table_row.table_name IN ('crm_messages', 'zapi_messages', 'wpp_bot_messages', 'wpp_bot_messages_v2') THEN 'Mensagens'
      WHEN table_row.table_name IN ('crm_contacts', 'zapi_contacts') THEN 'Contatos'
      WHEN table_row.table_name LIKE '%flow%' OR table_row.table_name LIKE '%automation%' THEN 'Fluxos e automações'
      WHEN table_row.table_name LIKE '%template%' THEN 'Templates'
      WHEN table_row.table_name LIKE '%broadcast%' OR table_row.table_name LIKE '%scheduled%' THEN 'Disparos e agendamentos'
      WHEN table_row.table_name LIKE '%setting%' OR table_row.table_name LIKE '%webhook%' OR table_row.table_name = 'crm_whatsapp_numbers' THEN 'Configurações e conexões'
      WHEN table_row.table_name LIKE '%log%' OR table_row.table_name LIKE '%metric%' OR table_row.table_name LIKE '%analytic%' THEN 'Logs e métricas'
      ELSE 'Outros dados'
    END;

    EXECUTE format(
      'INSERT INTO pg_temp.crm_storage_rows (user_id, table_name, category, row_count, row_bytes)
       SELECT user_id, %L, %L, count(*)::bigint, COALESCE(sum(pg_column_size(t)), 0)::bigint
         FROM public.%I t WHERE user_id IS NOT NULL GROUP BY user_id',
      table_row.table_name, category_name, table_row.table_name
    );
  END LOOP;

  INSERT INTO public.crm_customer_storage_snapshots AS target (
    user_id, email, full_name, database_row_bytes, media_file_bytes,
    total_bytes, total_rows, categories, table_details,
    active_numbers, disconnected_numbers, removed_numbers, measured_at, updated_at
  )
  SELECT u.id,
         u.email::text,
         p.full_name,
         COALESCE(rows.database_row_bytes, 0),
         COALESCE(media.media_file_bytes, 0),
         COALESCE(rows.database_row_bytes, 0) + COALESCE(media.media_file_bytes, 0),
         COALESCE(rows.total_rows, 0),
         COALESCE(rows.categories, '{}'::jsonb),
         COALESCE(rows.table_details, '{}'::jsonb),
         COALESCE(numbers.active_numbers, 0),
         COALESCE(numbers.disconnected_numbers, 0),
         COALESCE(history.removed_numbers, 0),
         now(), now()
    FROM auth.users u
    LEFT JOIN public.crm_profiles p ON p.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT sum(r.row_bytes)::bigint AS database_row_bytes,
             sum(r.row_count)::bigint AS total_rows,
             jsonb_object_agg(r.category, r.category_bytes) AS categories,
             jsonb_object_agg(r.table_name, jsonb_build_object('rows', r.table_rows, 'bytes', r.table_bytes)) AS table_details
        FROM (
          SELECT category, table_name,
                 sum(row_count)::bigint AS table_rows,
                 sum(row_bytes)::bigint AS table_bytes,
                 sum(sum(row_bytes)) OVER (PARTITION BY category)::bigint AS category_bytes
            FROM pg_temp.crm_storage_rows
           WHERE user_id = u.id
           GROUP BY category, table_name
        ) r
    ) rows ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(COALESCE(a.size_bytes, 0)), 0)::bigint AS media_file_bytes
        FROM public.crm_media_assets a WHERE a.user_id = u.id
    ) media ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE n.is_active)::integer AS active_numbers,
             count(*) FILTER (WHERE NOT n.is_active)::integer AS disconnected_numbers
        FROM public.crm_whatsapp_numbers n WHERE n.user_id = u.id
    ) numbers ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS removed_numbers
        FROM public.crm_whatsapp_number_history h WHERE h.user_id = u.id
    ) history ON true
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    database_row_bytes = EXCLUDED.database_row_bytes,
    media_file_bytes = EXCLUDED.media_file_bytes,
    total_bytes = EXCLUDED.total_bytes,
    total_rows = EXCLUDED.total_rows,
    categories = EXCLUDED.categories,
    table_details = EXCLUDED.table_details,
    active_numbers = EXCLUDED.active_numbers,
    disconnected_numbers = EXCLUDED.disconnected_numbers,
    removed_numbers = EXCLUDED.removed_numbers,
    measured_at = EXCLUDED.measured_at,
    updated_at = now();

  DELETE FROM public.crm_customer_storage_snapshots s
   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.user_id);

  SELECT count(*)::integer INTO refreshed FROM public.crm_customer_storage_snapshots;
  RETURN refreshed;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_refresh_customer_storage_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_refresh_customer_storage_snapshots() TO service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_complete_storage_overview()
RETURNS TABLE (
  user_id uuid, email text, full_name text, database_row_bytes bigint,
  media_file_bytes bigint, total_bytes bigint, total_rows bigint,
  categories jsonb, table_details jsonb, active_numbers integer,
  disconnected_numbers integer, removed_numbers integer, measured_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.user_id, s.email, s.full_name, s.database_row_bytes,
         s.media_file_bytes, s.total_bytes, s.total_rows, s.categories,
         s.table_details, s.active_numbers, s.disconnected_numbers,
         s.removed_numbers, s.measured_at
    FROM public.crm_customer_storage_snapshots s
   ORDER BY s.total_bytes DESC, s.email;
$$;

REVOKE ALL ON FUNCTION public.crm_admin_complete_storage_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_complete_storage_overview() TO service_role;

SELECT public.crm_refresh_customer_storage_snapshots();
NOTIFY pgrst, 'reload schema';