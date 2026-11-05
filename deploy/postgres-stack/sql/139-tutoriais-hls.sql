-- 139 — Vídeos dos tutoriais em streaming adaptativo (HLS).
-- O serviço zapmro-tutorial-transcoder (host) converte cada vídeo em várias
-- qualidades; o player começa na mais leve e sobe conforme a conexão.
-- O vídeo original (video_url) nunca é alterado: serve de reserva.

ALTER TABLE public.sales_tutorials
  ADD COLUMN IF NOT EXISTS hls_url text,
  ADD COLUMN IF NOT EXISTS transcode_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS transcode_error text,
  ADD COLUMN IF NOT EXISTS transcode_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcoded_at timestamptz;

-- Vídeo novo ou trocado => volta para a fila automaticamente.
CREATE OR REPLACE FUNCTION public.sales_tutorials_queue_transcode()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.video_url IS DISTINCT FROM OLD.video_url THEN
    NEW.hls_url := NULL;
    NEW.transcode_error := NULL;
    NEW.transcoded_at := NULL;
    NEW.transcode_status := CASE WHEN NEW.video_url IS NULL THEN 'none' ELSE 'pending' END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sales_tutorials_queue_transcode ON public.sales_tutorials;
CREATE TRIGGER sales_tutorials_queue_transcode
  BEFORE INSERT OR UPDATE OF video_url ON public.sales_tutorials
  FOR EACH ROW EXECUTE FUNCTION public.sales_tutorials_queue_transcode();

UPDATE public.sales_tutorials SET transcode_status = 'none'
 WHERE video_url IS NULL AND transcode_status = 'pending';

CREATE INDEX IF NOT EXISTS sales_tutorials_transcode_queue_idx
  ON public.sales_tutorials (created_at) WHERE transcode_status IN ('pending','processing');
