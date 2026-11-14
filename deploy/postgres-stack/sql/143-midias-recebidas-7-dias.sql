-- 143: mídias recebidas passam a expirar em 7 dias (antes 15).
-- Mesma proteção de sempre: fluxos, templates, documentos do Agente e
-- agendamentos/disparos pendentes nunca são apagados; textos e contatos ficam.
CREATE OR REPLACE FUNCTION public.crm_incoming_media_expired_batch(p_days integer DEFAULT 7, p_limit integer DEFAULT 200, p_force boolean DEFAULT false)
RETURNS TABLE(name text, size_bytes bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage AS $$
DECLARE
  c public.crm_incoming_expiration_cursor%ROWTYPE;
  o record; examined integer := 0; last_created timestamptz; last_name text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(135015) THEN RETURN; END IF;
  SELECT * INTO c FROM public.crm_incoming_expiration_cursor WHERE id = true FOR UPDATE;
  IF NOT p_force AND c.next_run_at > clock_timestamp() THEN RETURN; END IF;
  FOR o IN
    SELECT s.name, s.created_at, s.metadata FROM storage.objects s
    WHERE s.bucket_id = 'crm-media' AND s.name LIKE 'incoming/%'
      AND s.created_at < now() - make_interval(days => greatest(coalesce(p_days,7),7))
      AND (c.after_created_at IS NULL OR (s.created_at, s.name) > (c.after_created_at, c.after_name))
    ORDER BY s.created_at, s.name
    LIMIT least(greatest(coalesce(p_limit,200),1),500)
  LOOP
    examined := examined + 1; last_created := o.created_at; last_name := o.name;
    IF NOT public.crm_media_is_protected_asset(o.name, '/storage/v1/object/public/crm-media/'||o.name) THEN
      name := o.name; size_bytes := coalesce((o.metadata->>'size')::bigint, 0);
      RETURN NEXT;
    END IF;
  END LOOP;
  UPDATE public.crm_incoming_expiration_cursor
     SET after_created_at = CASE WHEN examined = 0 THEN NULL ELSE last_created END,
         after_name       = CASE WHEN examined = 0 THEN NULL ELSE last_name END,
         next_run_at      = clock_timestamp() + interval '20 seconds'
   WHERE id = true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_incoming_media_expired_batch(integer,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_incoming_media_expired_batch(integer,integer,boolean) TO service_role;
-- Recomeça a varredura para alcançar os arquivos entre 7 e 15 dias.
UPDATE public.crm_incoming_expiration_cursor SET after_created_at = NULL, after_name = NULL, next_run_at = '-infinity' WHERE id = true;

CREATE OR REPLACE FUNCTION public.crm_admin_incoming_media_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
  WITH inc AS (
    SELECT s.name, s.created_at, coalesce((s.metadata->>'size')::bigint, 0) AS sz
    FROM storage.objects s
    WHERE s.bucket_id = 'crm-media' AND s.name LIKE 'incoming/%'
  ), orphan AS (
    SELECT i.sz FROM inc i
    WHERE i.name NOT LIKE 'incoming/%/%'
      AND i.created_at < now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_messages m
        WHERE m.media_url LIKE '%/crm-media/incoming/%'
          AND substring(m.media_url FROM '/crm-media/(incoming/[^?#]+)') = i.name)
  )
  SELECT jsonb_build_object(
    'total_files', (SELECT count(*) FROM inc),
    'total_bytes', (SELECT coalesce(sum(sz),0) FROM inc),
    'expired_files', (SELECT count(*) FROM inc WHERE created_at < now() - interval '7 days'),
    'expired_bytes', (SELECT coalesce(sum(sz),0) FROM inc WHERE created_at < now() - interval '7 days'),
    'unreferenced_files', (SELECT count(*) FROM orphan),
    'unreferenced_bytes', (SELECT coalesce(sum(sz),0) FROM orphan),
    'retention_days', 7
  );
$$;
REVOKE ALL ON FUNCTION public.crm_admin_incoming_media_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_incoming_media_summary() TO service_role;


NOTIFY pgrst, 'reload schema';
