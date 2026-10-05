-- ============================================================
-- 116 - Janela de atendimento 24h / 72h (Click-to-WhatsApp)
-- ------------------------------------------------------------
-- Aditiva e idempotente. Guarda o evento do anúncio que abriu a
-- janela especial de 72h. Nada é apagado.
-- ============================================================

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS ctwa_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS ctwa_clid text;

-- Contatos antigos sem marcador: recupera a última mensagem recebida real.
UPDATE public.crm_contacts c
   SET last_message_received_at = m.last_in
  FROM (
    SELECT contact_id, max(created_at) AS last_in
      FROM public.crm_messages
     WHERE direction = 'inbound'
     GROUP BY contact_id
  ) m
 WHERE m.contact_id = c.id
   AND c.last_message_received_at IS NULL;

NOTIFY pgrst, 'reload schema';
