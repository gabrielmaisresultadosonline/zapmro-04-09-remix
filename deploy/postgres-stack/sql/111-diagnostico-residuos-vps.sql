-- ============================================================
-- 111 - Diagnóstico completo de armazenamento e resíduos antigos
-- Idempotente. Nunca remove contatos, números, fluxos ou templates.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_vps_storage_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  database_bytes bigint NOT NULL DEFAULT 0,
  storage_bytes bigint NOT NULL DEFAULT 0,
  docker_logs_bytes bigint NOT NULL DEFAULT 0,
  backups_bytes bigint NOT NULL DEFAULT 0,
  orphan_disk_bytes bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.crm_vps_storage_snapshots TO service_role;
ALTER TABLE public.crm_vps_storage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_vps_maintenance_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('safe_cleanup')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.crm_vps_maintenance_requests TO service_role;
ALTER TABLE public.crm_vps_maintenance_requests ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS crm_vps_maintenance_one_active_idx
  ON public.crm_vps_maintenance_requests (action)
  WHERE status IN ('pending', 'running');

-- Resíduos que podem ser atribuídos a um cadastro, mas não a uma caixa ativa:
-- mensagens de cadastros sem número e mídias catalogadas sem qualquer uso.
CREATE OR REPLACE FUNCTION public.crm_admin_storage_residues()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  messages_count bigint,
  message_bytes bigint,
  media_count bigint,
  media_bytes bigint,
  total_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH users_with_residue AS (
    SELECT m.user_id
      FROM public.crm_messages m
     WHERE NOT EXISTS (
       SELECT 1 FROM public.crm_whatsapp_numbers n
        WHERE n.user_id = m.user_id
          AND (n.id = m.whatsapp_number_id OR (m.whatsapp_number_id IS NULL AND n.is_primary))
     )
    UNION
    SELECT a.user_id
      FROM public.crm_media_assets a
     WHERE NOT public.crm_media_is_referenced(a.user_id, a.public_url, a.path)
  )
  SELECT r.user_id,
         u.email::text,
         p.full_name,
         COALESCE(msg.messages_count, 0),
         COALESCE(msg.message_bytes, 0),
         COALESCE(media.media_count, 0),
         COALESCE(media.media_bytes, 0),
         COALESCE(msg.message_bytes, 0) + COALESCE(media.media_bytes, 0)
    FROM users_with_residue r
    LEFT JOIN auth.users u ON u.id = r.user_id
    LEFT JOIN public.crm_profiles p ON p.user_id = r.user_id
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint messages_count,
             COALESCE(sum(pg_column_size(m)), 0)::bigint message_bytes
        FROM public.crm_messages m
       WHERE m.user_id = r.user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.crm_whatsapp_numbers n
            WHERE n.user_id = m.user_id
              AND (n.id = m.whatsapp_number_id OR (m.whatsapp_number_id IS NULL AND n.is_primary))
         )
    ) msg ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint media_count,
             COALESCE(sum(COALESCE(a.size_bytes, 0)), 0)::bigint media_bytes
        FROM public.crm_media_assets a
       WHERE a.user_id = r.user_id
         AND NOT public.crm_media_is_referenced(a.user_id, a.public_url, a.path)
    ) media ON true
   WHERE COALESCE(msg.messages_count, 0) > 0 OR COALESCE(media.media_count, 0) > 0
   ORDER BY (COALESCE(msg.message_bytes, 0) + COALESCE(media.media_bytes, 0)) DESC;
$$;

REVOKE ALL ON FUNCTION public.crm_admin_storage_residues() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_storage_residues() TO service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_clear_residual_storage(p_user_id uuid)
RETURNS TABLE (deleted_messages bigint, queued_media integer, estimated_freed_bytes bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_bytes bigint := 0;
  v_media_bytes bigint := 0;
BEGIN
  WITH removed AS (
    DELETE FROM public.crm_messages m
     WHERE m.user_id = p_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_whatsapp_numbers n
          WHERE n.user_id = m.user_id
            AND (n.id = m.whatsapp_number_id OR (m.whatsapp_number_id IS NULL AND n.is_primary))
       )
     RETURNING pg_column_size(m)::bigint AS row_bytes
  )
  SELECT count(*)::bigint, COALESCE(sum(row_bytes), 0)::bigint
    INTO deleted_messages, v_message_bytes FROM removed;

  WITH safe_assets AS (
    SELECT a.* FROM public.crm_media_assets a
     WHERE a.user_id = p_user_id
       AND NOT public.crm_media_is_referenced(a.user_id, a.public_url, a.path)
  ), queued AS (
    INSERT INTO public.crm_media_gc_queue
      (media_asset_id, user_id, bucket, path, public_url, reason, purge_after)
    SELECT a.id, a.user_id, a.bucket, a.path, a.public_url,
           'limpeza-residuos-admincentral', now()
      FROM safe_assets a
    ON CONFLICT (user_id, bucket, path) WHERE status = 'pending' DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO queued_media FROM queued;

  SELECT COALESCE(sum(COALESCE(a.size_bytes, 0)), 0)::bigint
    INTO v_media_bytes
    FROM public.crm_media_assets a
   WHERE a.user_id = p_user_id
     AND NOT public.crm_media_is_referenced(a.user_id, a.public_url, a.path);

  estimated_freed_bytes := v_message_bytes + v_media_bytes;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_admin_clear_residual_storage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_clear_residual_storage(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_vps_storage_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'snapshot', COALESCE((SELECT to_jsonb(s) FROM public.crm_vps_storage_snapshots s ORDER BY s.created_at DESC LIMIT 1), '{}'::jsonb),
    'maintenance', COALESCE((SELECT to_jsonb(r) FROM public.crm_vps_maintenance_requests r ORDER BY r.requested_at DESC LIMIT 1), '{}'::jsonb),
    'catalogued_media_bytes', COALESCE((SELECT sum(COALESCE(size_bytes, 0)) FROM public.crm_media_assets), 0),
    'pending_media_bytes', COALESCE((SELECT sum(COALESCE(a.size_bytes, 0)) FROM public.crm_media_gc_queue q LEFT JOIN public.crm_media_assets a ON a.id = q.media_asset_id WHERE q.status = 'pending'), 0),
    'failed_media_count', COALESCE((SELECT count(*) FROM public.crm_media_gc_queue WHERE status = 'failed'), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.crm_admin_vps_storage_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_vps_storage_summary() TO service_role;

NOTIFY pgrst, 'reload schema';