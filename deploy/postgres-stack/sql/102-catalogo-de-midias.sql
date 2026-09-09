-- ============================================================
-- 102 - Catálogo de mídias (arquivo físico separado da mensagem)
-- Idempotente: pode ser executada repetidamente.
--
-- Por quê: a deduplicação por hash já garante 1 arquivo por conteúdo, mas o
-- sistema não sabia QUANTAS mensagens/fluxos/templates usam cada arquivo, nem
-- tinha período de segurança antes de apagar. Aqui criamos:
--
--   crm_media_assets   → 1 linha por arquivo físico (sha256 + caminho + refs)
--   crm_media_gc_queue → lixeira: só apaga do disco depois de 7 dias
--
-- NADA existente é alterado ou removido. Se estas tabelas ficarem vazias, o
-- sistema continua funcionando exatamente como hoje.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Catálogo de arquivos físicos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_media_assets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  sha256 text,
  bucket text NOT NULL,
  path text NOT NULL,
  public_url text NOT NULL,
  mime_type text,
  size_bytes bigint,
  reference_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_media_assets TO authenticated;
GRANT ALL ON public.crm_media_assets TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS crm_media_assets_user_object_idx
  ON public.crm_media_assets (user_id, bucket, path);
CREATE INDEX IF NOT EXISTS crm_media_assets_sha_idx
  ON public.crm_media_assets (sha256);
CREATE INDEX IF NOT EXISTS crm_media_assets_refcount_idx
  ON public.crm_media_assets (reference_count);
CREATE INDEX IF NOT EXISTS crm_media_assets_url_idx
  ON public.crm_media_assets (public_url);

ALTER TABLE public.crm_media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own data" ON public.crm_media_assets;
CREATE POLICY "Users can only access their own data" ON public.crm_media_assets
  AS PERMISSIVE FOR SELECT TO public USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only insert their own data" ON public.crm_media_assets;
CREATE POLICY "Users can only insert their own data" ON public.crm_media_assets
  AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only update their own data" ON public.crm_media_assets;
CREATE POLICY "Users can only update their own data" ON public.crm_media_assets
  AS PERMISSIVE FOR UPDATE TO public USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only delete their own data" ON public.crm_media_assets;
CREATE POLICY "Users can only delete their own data" ON public.crm_media_assets
  AS PERMISSIVE FOR DELETE TO public USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2) Lixeira (só apaga do disco depois do prazo)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_media_gc_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  media_asset_id uuid REFERENCES public.crm_media_assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  bucket text NOT NULL,
  path text NOT NULL,
  public_url text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'purged', 'restored', 'failed')),
  last_error text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  purged_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_media_gc_queue TO authenticated;
GRANT ALL ON public.crm_media_gc_queue TO service_role;

CREATE INDEX IF NOT EXISTS crm_media_gc_queue_due_idx
  ON public.crm_media_gc_queue (status, purge_after);
CREATE UNIQUE INDEX IF NOT EXISTS crm_media_gc_queue_pending_uniq
  ON public.crm_media_gc_queue (user_id, bucket, path)
  WHERE status = 'pending';

ALTER TABLE public.crm_media_gc_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own data" ON public.crm_media_gc_queue;
CREATE POLICY "Users can only access their own data" ON public.crm_media_gc_queue
  AS PERMISSIVE FOR SELECT TO public USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only insert their own data" ON public.crm_media_gc_queue;
CREATE POLICY "Users can only insert their own data" ON public.crm_media_gc_queue
  AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only update their own data" ON public.crm_media_gc_queue;
CREATE POLICY "Users can only update their own data" ON public.crm_media_gc_queue
  AS PERMISSIVE FOR UPDATE TO public USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only delete their own data" ON public.crm_media_gc_queue;
CREATE POLICY "Users can only delete their own data" ON public.crm_media_gc_queue
  AS PERMISSIVE FOR DELETE TO public USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3) Registrar/atualizar um arquivo no catálogo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_media_register(
  p_bucket text,
  p_path text,
  p_public_url text,
  p_sha256 text DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_size_bytes bigint DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id, auth.uid());
  v_id uuid;
BEGIN
  IF v_user IS NULL OR p_bucket IS NULL OR p_path IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.crm_media_assets AS a
    (user_id, sha256, bucket, path, public_url, mime_type, size_bytes, reference_count)
  VALUES
    (v_user, p_sha256, p_bucket, p_path, p_public_url, p_mime_type, p_size_bytes, 0)
  ON CONFLICT (user_id, bucket, path) DO UPDATE
    SET sha256     = COALESCE(EXCLUDED.sha256, a.sha256),
        mime_type  = COALESCE(EXCLUDED.mime_type, a.mime_type),
        size_bytes = COALESCE(EXCLUDED.size_bytes, a.size_bytes),
        public_url = EXCLUDED.public_url,
        updated_at = now()
  RETURNING a.id INTO v_id;

  -- O arquivo voltou a ser usado: tira da lixeira.
  UPDATE public.crm_media_gc_queue
     SET status = 'restored', last_error = NULL
   WHERE status = 'pending' AND user_id = v_user AND bucket = p_bucket AND path = p_path;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_media_register(text, text, text, text, text, bigint, uuid)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Somar/subtrair referências (nunca abaixo de zero)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_media_addref(
  p_public_url text,
  p_delta integer,
  p_reason text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id, auth.uid());
  v_asset public.crm_media_assets%ROWTYPE;
BEGIN
  IF v_user IS NULL OR p_public_url IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.crm_media_assets
     SET reference_count = GREATEST(0, reference_count + COALESCE(p_delta, 0)),
         updated_at = now()
   WHERE user_id = v_user AND public_url = p_public_url
  RETURNING * INTO v_asset;

  IF v_asset.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_asset.reference_count = 0 THEN
    -- Entra na lixeira; só sai do disco depois do prazo.
    INSERT INTO public.crm_media_gc_queue
      (media_asset_id, user_id, bucket, path, public_url, reason)
    VALUES
      (v_asset.id, v_user, v_asset.bucket, v_asset.path, v_asset.public_url, p_reason)
    ON CONFLICT (user_id, bucket, path) WHERE status = 'pending' DO NOTHING;
  ELSE
    UPDATE public.crm_media_gc_queue
       SET status = 'restored'
     WHERE status = 'pending' AND media_asset_id = v_asset.id;
  END IF;

  RETURN v_asset.reference_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_media_addref(text, integer, text, uuid)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) Enfileirar diretamente pela URL (usado quando o arquivo não
--    estava catalogado — ex.: mídias antigas de fluxos apagados)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_media_enqueue_delete(
  p_bucket text,
  p_path text,
  p_public_url text,
  p_reason text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_delay_days integer DEFAULT 7
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id, auth.uid());
  v_asset_id uuid;
  v_id uuid;
BEGIN
  IF v_user IS NULL OR p_bucket IS NULL OR p_path IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_asset_id
    FROM public.crm_media_assets
   WHERE user_id = v_user AND bucket = p_bucket AND path = p_path;

  INSERT INTO public.crm_media_gc_queue
    (media_asset_id, user_id, bucket, path, public_url, reason, purge_after)
  VALUES
    (v_asset_id, v_user, p_bucket, p_path, p_public_url, p_reason,
     now() + make_interval(days => GREATEST(1, COALESCE(p_delay_days, 7))))
  ON CONFLICT (user_id, bucket, path) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_media_enqueue_delete(text, text, text, text, uuid, integer)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6) Worker: itens vencidos e marcação do resultado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_media_purge_due(p_limit integer DEFAULT 200)
RETURNS SETOF public.crm_media_gc_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.crm_media_gc_queue
   WHERE status = 'pending' AND purge_after <= now()
   ORDER BY purge_after
   LIMIT GREATEST(1, COALESCE(p_limit, 200));
$$;

GRANT EXECUTE ON FUNCTION public.crm_media_purge_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_media_mark_purged(
  p_id uuid,
  p_status text,
  p_error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('purged', 'restored', 'failed', 'pending') THEN
    RAISE EXCEPTION 'status inválido: %', p_status;
  END IF;

  UPDATE public.crm_media_gc_queue
     SET status = p_status,
         last_error = p_error,
         purged_at = CASE WHEN p_status = 'purged' THEN now() ELSE purged_at END
   WHERE id = p_id;

  IF p_status = 'purged' THEN
    DELETE FROM public.crm_media_assets a
     USING public.crm_media_gc_queue q
     WHERE q.id = p_id AND a.id = q.media_asset_id AND a.reference_count = 0;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_media_mark_purged(uuid, text, text) TO service_role;
