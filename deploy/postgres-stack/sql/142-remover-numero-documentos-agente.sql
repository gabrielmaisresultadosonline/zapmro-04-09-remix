-- ============================================================
-- 142 - Remover número não falha por códigos repetidos dos Arquivos do Agente
-- Ao apagar um número, seus documentos iam para whatsapp_number_id NULL e
-- colidiam com códigos iguais do cadastro (crm_ai_documents_code_uidx).
-- Agora, antes de apagar, os documentos desse número são arquivados:
-- desativados e, se o código já existir no cadastro, recebem um sufixo.
-- Nada é apagado. Idempotente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_archive_ai_documents_before_number_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d record; new_code text;
BEGIN
  FOR d IN SELECT id, user_id, code FROM public.crm_ai_documents WHERE whatsapp_number_id = OLD.id LOOP
    new_code := d.code;
    IF EXISTS (SELECT 1 FROM public.crm_ai_documents x
                WHERE x.user_id = d.user_id AND x.whatsapp_number_id IS NULL
                  AND lower(x.code) = lower(new_code) AND x.id <> d.id) THEN
      new_code := left(d.code, 31) || '_' || substr(md5(d.id::text), 1, 8);
    END IF;
    UPDATE public.crm_ai_documents
       SET whatsapp_number_id = NULL, code = new_code, is_active = false, updated_at = now()
     WHERE id = d.id;
  END LOOP;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS crm_archive_ai_documents_before_number_delete ON public.crm_whatsapp_numbers;
CREATE TRIGGER crm_archive_ai_documents_before_number_delete
  BEFORE DELETE ON public.crm_whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.crm_archive_ai_documents_before_number_delete();
