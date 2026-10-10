-- ============================================================
-- 124 - Documentos do Agente I.A. (PDF, imagem, áudio, vídeo)
-- Cada cadastro/WhatsApp tem sua própria biblioteca. O Agente envia o
-- arquivo quando o código (ex.: Document1) é pedido no atendimento.
-- Aditiva e idempotente: nada existente é alterado ou apagado.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_ai_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  whatsapp_number_id uuid REFERENCES public.crm_whatsapp_numbers(id) ON DELETE SET NULL,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9_-]{1,40}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  media_type text NOT NULL CHECK (media_type IN ('document', 'image', 'audio', 'video')),
  media_url text NOT NULL,
  file_name text,
  mime_type text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Um código é único dentro do mesmo WhatsApp (ou do cadastro, sem número).
CREATE UNIQUE INDEX IF NOT EXISTS crm_ai_documents_code_uidx
  ON public.crm_ai_documents (user_id, COALESCE(whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));
CREATE INDEX IF NOT EXISTS crm_ai_documents_number_idx
  ON public.crm_ai_documents (whatsapp_number_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_ai_documents TO authenticated;
GRANT ALL ON public.crm_ai_documents TO service_role;
ALTER TABLE public.crm_ai_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_ai_documents_owner ON public.crm_ai_documents;
CREATE POLICY crm_ai_documents_owner ON public.crm_ai_documents
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (whatsapp_number_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_whatsapp_numbers n
       WHERE n.id = whatsapp_number_id AND n.user_id = auth.uid()
    ))
  );

-- Arquivos da biblioteca nunca podem ir para a limpeza automática.
CREATE OR REPLACE FUNCTION public.crm_media_is_referenced(
  p_user_id uuid,
  p_public_url text,
  p_path text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.crm_messages m
       WHERE m.user_id = p_user_id
         AND (
           m.media_url = p_public_url OR m.content = p_public_url OR
           COALESCE(m.metadata::text, '') LIKE '%' || p_path || '%'
         )
    ) OR EXISTS (
      SELECT 1 FROM public.crm_scheduled_messages s
       WHERE s.user_id = p_user_id
         AND s.status IN ('pending', 'processing')
         AND s.message_data::text LIKE '%' || p_path || '%'
    ) OR EXISTS (
      SELECT 1 FROM public.crm_flows f
       WHERE f.user_id = p_user_id
         AND (f.nodes::text LIKE '%' || p_path || '%' OR f.edges::text LIKE '%' || p_path || '%')
    ) OR EXISTS (
      SELECT 1 FROM public.crm_templates t
       WHERE t.user_id = p_user_id
         AND t.components::text LIKE '%' || p_path || '%'
    ) OR EXISTS (
      SELECT 1 FROM public.crm_ai_documents d
       WHERE d.user_id = p_user_id
         AND (d.media_url = p_public_url OR d.media_url LIKE '%' || p_path || '%')
    );
$$;
REVOKE ALL ON FUNCTION public.crm_media_is_referenced(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_media_is_referenced(uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
