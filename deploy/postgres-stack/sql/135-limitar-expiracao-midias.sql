-- Evita que a expiração de órfãos monopolize o PostgreSQL.
-- Cancela somente as leituras antigas desta RPC, nunca a replicação ou envios.
SELECT pg_cancel_backend(pid) FROM pg_stat_activity
WHERE pid <> pg_backend_pid() AND state = 'active'
  AND query LIKE '%"public"."crm_incoming_media_expired_batch"%'
  AND query_start < clock_timestamp() - interval '30 seconds';

CREATE TABLE IF NOT EXISTS public.crm_incoming_expiration_cursor (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  after_created_at timestamptz,
  after_name text,
  next_run_at timestamptz NOT NULL DEFAULT '-infinity'
);
GRANT ALL ON public.crm_incoming_expiration_cursor TO service_role;
REVOKE ALL ON public.crm_incoming_expiration_cursor FROM anon, authenticated;
ALTER TABLE public.crm_incoming_expiration_cursor ENABLE ROW LEVEL SECURITY;
INSERT INTO public.crm_incoming_expiration_cursor(id) VALUES(true) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS storage_objects_incoming_cursor_idx
ON storage.objects(created_at, name)
WHERE bucket_id='crm-media' AND name LIKE 'incoming/%';

CREATE OR REPLACE FUNCTION public.crm_incoming_media_expired_batch(p_days integer DEFAULT 15,p_limit integer DEFAULT 20)
RETURNS TABLE(name text,size_bytes bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE
  c public.crm_incoming_expiration_cursor%ROWTYPE;
  o record;
  examined integer := 0;
  last_created timestamptz;
  last_name text;
BEGIN
  -- Antes de qualquer varredura. O lock também protege chamadas antigas do worker.
  IF NOT pg_try_advisory_xact_lock(135015) THEN RETURN; END IF;
  SELECT * INTO c FROM public.crm_incoming_expiration_cursor WHERE id=true FOR UPDATE;
  IF c.next_run_at > clock_timestamp() THEN RETURN; END IF;
  -- LIMIT vem ANTES da checagem global: no máximo 20 arquivos por chamada.
  -- O cursor avança mesmo por arquivos protegidos, sem ficar preso no primeiro.
  FOR o IN
    SELECT s.name,s.created_at,s.metadata FROM storage.objects s
    WHERE s.bucket_id='crm-media' AND s.name LIKE 'incoming/%'
      AND s.created_at < now()-make_interval(days=>greatest(coalesce(p_days,15),15))
      AND (c.after_created_at IS NULL OR (s.created_at,s.name)>(c.after_created_at,c.after_name))
    ORDER BY s.created_at,s.name LIMIT least(greatest(coalesce(p_limit,20),1),20)
  LOOP
    examined := examined+1;
    last_created := o.created_at; last_name := o.name;
    -- Mantém proteção GLOBAL de conversas, fluxos, templates, documentos e agendamentos.
    IF NOT public.crm_media_is_referenced(NULL,'/storage/v1/object/public/crm-media/'||o.name,o.name) THEN
      name := o.name;
      size_bytes := coalesce((o.metadata->>'size')::bigint,0);
      RETURN NEXT;
    END IF;
  END LOOP;
  UPDATE public.crm_incoming_expiration_cursor
  SET after_created_at=CASE WHEN examined=0 THEN NULL ELSE last_created END,
      after_name=CASE WHEN examined=0 THEN NULL ELSE last_name END,
      next_run_at=clock_timestamp()+interval '60 seconds'
  WHERE id=true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_incoming_media_expired_batch(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_incoming_media_expired_batch(integer,integer) TO service_role;

-- O timeout HTTP não cancela necessariamente o SQL. Guarda no próprio banco:
-- a cada minuto interrompe apenas esta leitura se durar mais de 30 segundos.
DO $guard$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('incoming-media-query-guard','* * * * *',
      $job$SELECT pg_cancel_backend(pid) FROM pg_stat_activity
      WHERE pid<>pg_backend_pid() AND state='active'
        AND query LIKE '%"public"."crm_incoming_media_expired_batch"%'
        AND query_start<clock_timestamp()-interval '30 seconds';$job$);
  END IF;
END;
$guard$;
NOTIFY pgrst,'reload schema';