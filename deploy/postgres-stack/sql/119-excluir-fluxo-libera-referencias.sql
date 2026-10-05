-- Excluir fluxo manualmente: referências sem ON DELETE bloqueavam o DELETE
-- (contato parado no fluxo, disparo antigo ou fluxo inicial nas configurações).
-- Agora essas referências viram NULL e o fluxo pode ser apagado normalmente.
ALTER TABLE public.crm_broadcasts DROP CONSTRAINT IF EXISTS crm_broadcasts_flow_id_fkey;
ALTER TABLE public.crm_broadcasts ADD CONSTRAINT crm_broadcasts_flow_id_fkey
  FOREIGN KEY (flow_id) REFERENCES public.crm_flows(id) ON DELETE SET NULL;

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_current_flow_id_fkey;
ALTER TABLE public.crm_contacts ADD CONSTRAINT crm_contacts_current_flow_id_fkey
  FOREIGN KEY (current_flow_id) REFERENCES public.crm_flows(id) ON DELETE SET NULL;

ALTER TABLE public.crm_settings DROP CONSTRAINT IF EXISTS crm_settings_initial_flow_id_fkey;
ALTER TABLE public.crm_settings ADD CONSTRAINT crm_settings_initial_flow_id_fkey
  FOREIGN KEY (initial_flow_id) REFERENCES public.crm_flows(id) ON DELETE SET NULL;
