-- ============================================================
-- 107 - Acelerar carga inicial e sincronização das conversas
-- ------------------------------------------------------------
-- Somente índices: não altera nem remove contatos, mensagens,
-- histórico, credenciais ou configurações existentes.
-- Idempotente.
-- ============================================================

-- Consulta paginada do CRM por proprietário, caixa e atualização.
CREATE INDEX IF NOT EXISTS crm_contacts_user_number_updated_idx
  ON public.crm_contacts (user_id, whatsapp_number_id, updated_at DESC, id);

-- Fallback do tempo real por proprietário, caixa e janela cronológica.
CREATE INDEX IF NOT EXISTS crm_messages_user_number_created_id_idx
  ON public.crm_messages (user_id, whatsapp_number_id, created_at, id);

-- Abertura e paginação do histórico de uma conversa específica.
CREATE INDEX IF NOT EXISTS crm_messages_contact_user_created_id_idx
  ON public.crm_messages (contact_id, user_id, created_at, id);