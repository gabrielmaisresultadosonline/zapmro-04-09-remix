-- ============================================================
-- 109 - Garantir tempo real das conversas na VPS
-- ------------------------------------------------------------
-- Não altera nem remove contatos, mensagens ou históricos.
-- Apenas garante que as duas tabelas usadas pela tela de conversas
-- façam parte da publicação consumida pelo serviço Realtime.
-- Idempotente.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication
     WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'crm_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'crm_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_contacts;
  END IF;
END;
$$;

ALTER TABLE public.crm_messages REPLICA IDENTITY FULL;
ALTER TABLE public.crm_contacts REPLICA IDENTITY FULL;

-- `updated_at` é o cursor da sincronização incremental. Garante que qualquer
-- alteração futura no contato avance esse cursor, mesmo quando uma rotina
-- antiga atualizar somente `last_interaction`.
DROP TRIGGER IF EXISTS update_crm_contacts_updated_at ON public.crm_contacts;
CREATE TRIGGER update_crm_contacts_updated_at
  BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();