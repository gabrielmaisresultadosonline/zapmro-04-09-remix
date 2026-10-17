-- 132 — Sete dias SEM atividade; contatos e automações permanecem intactos.
-- A fila durável guarda URLs antes de qualquer DELETE, inclusive exclusões manuais.
UPDATE public.admin_announcements SET message = 'Conversas sem mensagens recebidas ou enviadas há sete dias terão seu histórico e arquivos exclusivos apagados. Contatos, números, configurações, fluxos e templates permanecem salvos.', updated_at = now()
WHERE id = '10810810-0000-4000-8000-000000000001';

CREATE OR REPLACE FUNCTION public.crm_cleanup_inactive_histories(
  p_inactive_days integer DEFAULT 7,
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
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(1, COALESCE(p_inactive_days, 7)));
BEGIN
  IF NOT pg_try_advisory_xact_lock(132007) THEN
    deleted_contacts := 0; deleted_messages := 0; queued_media := 0; RETURN NEXT; RETURN;
  END IF;
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
    removed_references integer NOT NULL DEFAULT 1,
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
     RETURNING m.id, m.user_id, m.media_url, m.content, m.metadata
  ), stored AS (
    INSERT INTO pg_temp.retention_removed_media (user_id, public_url, removed_references)
    SELECT collected.user_id, collected.public_url, count(*)::integer
      FROM (
        SELECT DISTINCT r.id, r.user_id, urls.public_url
      FROM removed r
      CROSS JOIN LATERAL (
        SELECT r.media_url AS public_url
        UNION ALL SELECT r.content
        UNION ALL
        SELECT trim(both '"' from value::text)
          FROM jsonb_path_query(COALESCE(r.metadata, '{}'::jsonb), '$.** ? (@.type() == "string")') value
      ) urls
     WHERE urls.public_url LIKE '%/storage/v1/object/public/%'
      ) collected
     GROUP BY collected.user_id, collected.public_url
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
           'retencao-historico-7-dias', now()
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


-- Mesmo bloqueio em TODOS os inserts de mensagem, inclusive chamadas diretas.
-- Uma entrada iniciada antes do lote termina antes da rechecagem de atividade.
CREATE OR REPLACE FUNCTION public.crm_lock_message_contact_for_retention()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM 1 FROM public.crm_contacts WHERE id=NEW.contact_id FOR UPDATE;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_lock_message_contact_for_retention() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS crm_messages_retention_write_lock ON public.crm_messages;
CREATE TRIGGER crm_messages_retention_write_lock BEFORE INSERT OR UPDATE OF contact_id,created_at ON public.crm_messages
FOR EACH ROW EXECUTE FUNCTION public.crm_lock_message_contact_for_retention();

-- Referências globais: um arquivo compartilhado entre cadastros também é protegido.
-- Tabelas opcionais são consultadas apenas quando existem; erros abortam a exclusão.
CREATE OR REPLACE FUNCTION public.crm_media_is_referenced(p_user_id uuid, p_public_url text, p_path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; used boolean;
BEGIN
  IF coalesce(p_path, '') = '' OR coalesce(p_public_url, '') = '' THEN RETURN true; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_messages m WHERE m.media_url=p_public_url OR m.content=p_public_url
    OR position(p_path in coalesce(m.media_url,''))>0 OR position(p_path in coalesce(m.content,''))>0
    OR position(p_path in coalesce(m.metadata::text,''))>0) THEN RETURN true; END IF;
  FOREACH t IN ARRAY ARRAY['crm_flows','crm_flow_steps','crm_templates','crm_ai_documents','zapi_flows','zapi_flow_steps'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I x WHERE position($1 in x::text) > 0 OR position($2 in x::text) > 0)', t)
      INTO used USING p_path, p_public_url;
      IF used THEN RETURN true; END IF;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['crm_scheduled_messages','crm_broadcasts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I x WHERE x.status IN (''pending'',''processing'',''running'',''paused'',''queued'') AND (position($1 in x::text) > 0 OR position($2 in x::text) > 0))', t)
      INTO used USING p_path, p_public_url;
      IF used THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_media_is_referenced(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_media_is_referenced(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_queue_deleted_message_media()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u text; b text; p text;
BEGIN
  IF OLD.user_id IS NULL THEN RETURN OLD; END IF;
  FOR u IN
    SELECT DISTINCT match[1] FROM jsonb_path_query(to_jsonb(OLD), '$.** ? (@.type() == "string")') value
    CROSS JOIN LATERAL regexp_matches(trim(both '"' from value::text), '(https?://[^\s"<>]+/storage/v1/object/public/[^\s"<>]+)', 'g') match
  LOOP
    b := split_part(split_part(u, '/storage/v1/object/public/', 2), '/', 1);
    p := regexp_replace(substring(split_part(u, '/storage/v1/object/public/', 2) from length(b)+2), '[?#].*$', '');
    IF b <> '' AND p <> '' THEN
      UPDATE public.crm_media_assets SET reference_count=GREATEST(0,reference_count-1),updated_at=now()
      WHERE user_id=OLD.user_id AND bucket=b AND path=p;
      INSERT INTO public.crm_media_gc_queue(media_asset_id,user_id,bucket,path,public_url,reason,purge_after)
      SELECT a.id, OLD.user_id, b, p, u, 'conversa-mensagem-apagada', now()
      FROM (SELECT 1) dummy LEFT JOIN public.crm_media_assets a ON a.user_id=OLD.user_id AND a.bucket=b AND a.path=p
      ON CONFLICT (user_id,bucket,path) WHERE status='pending'
      DO UPDATE SET purge_after=LEAST(crm_media_gc_queue.purge_after, EXCLUDED.purge_after);
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_queue_deleted_message_media() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_messages_queue_deleted_media ON public.crm_messages;
CREATE TRIGGER crm_messages_queue_deleted_media AFTER DELETE ON public.crm_messages
FOR EACH ROW EXECUTE FUNCTION public.crm_queue_deleted_message_media();

-- Falhas transitórias voltam ao próximo ciclo; não ficam abandonadas na fila.
CREATE OR REPLACE FUNCTION public.crm_media_purge_due(p_limit integer DEFAULT 200)
RETURNS SETOF public.crm_media_gc_queue LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT * FROM public.crm_media_gc_queue WHERE status IN ('pending','failed') AND purge_after <= now()
 ORDER BY purge_after LIMIT LEAST(1000,GREATEST(1,COALESCE(p_limit,200)));
$$;
REVOKE ALL ON FUNCTION public.crm_media_purge_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_media_purge_due(integer) TO service_role;

-- Arquivos recebidos não expiram se alguma conversa ainda os usa.
-- O prazo legado de 15 dias só se aplica aos órfãos anteriores à fila durável.
CREATE OR REPLACE FUNCTION public.crm_incoming_media_expired_batch(p_days integer DEFAULT 15,p_limit integer DEFAULT 300)
RETURNS TABLE(name text,size_bytes bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE refs text := public.crm_incoming_protected_refs();
BEGIN
 RETURN QUERY SELECT o.name::text,coalesce((o.metadata->>'size')::bigint,0) FROM storage.objects o
 WHERE o.bucket_id='crm-media' AND o.name LIKE 'incoming/%'
 AND o.created_at < now()-make_interval(days=>greatest(p_days,15))
 AND position(o.name IN refs)=0
 AND NOT public.crm_media_is_referenced(NULL,'/storage/v1/object/public/crm-media/' || o.name,o.name)
 ORDER BY o.created_at LIMIT least(greatest(p_limit,1),1000);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_incoming_media_expired_batch(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_incoming_media_expired_batch(integer,integer) TO service_role;

-- Fila de conversas já limpas não precisa aguardar mais sete dias.
UPDATE public.crm_media_gc_queue SET purge_after=now()
WHERE status IN ('pending','failed') AND reason IN ('conversa-limpa','conversa-excluida');
NOTIFY pgrst, 'reload schema';
