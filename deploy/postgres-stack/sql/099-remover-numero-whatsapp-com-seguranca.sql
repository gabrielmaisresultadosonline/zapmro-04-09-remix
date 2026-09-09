-- ============================================================
-- 099 - Remoção segura de uma caixa de WhatsApp
-- ------------------------------------------------------------
-- Remove somente os dados pertencentes ao número selecionado.
-- Evita o ON DELETE SET NULL em contatos, que causava colisão no índice
-- crm_contacts_wa_user_nonumber_idx quando o mesmo cliente existia em caixas
-- diferentes. As demais caixas e seus dados permanecem intactos.
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.crm_delete_whatsapp_number_internal(
  p_number_id uuid,
  p_user_id uuid,
  p_admin_authorized boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_phone_id text;
  v_caller_id uuid := auth.uid();
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_contacts integer := 0;
  v_messages integer := 0;
  v_flows integer := 0;
  v_templates integer := 0;
  v_remaining integer := 0;
BEGIN
  SELECT user_id, meta_phone_number_id
    INTO v_owner_id, v_phone_id
    FROM public.crm_whatsapp_numbers
   WHERE id = p_number_id
   FOR UPDATE;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Número de WhatsApp não encontrado';
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id <> v_owner_id THEN
    RAISE EXCEPTION 'O número não pertence ao cadastro informado';
  END IF;

  IF NOT p_admin_authorized
     AND v_role <> 'service_role'
     AND v_caller_id IS DISTINCT FROM v_owner_id THEN
    RAISE EXCEPTION 'Sem permissão para remover este número';
  END IF;

  DELETE FROM public.crm_activities
   WHERE contact_id IN (
     SELECT id FROM public.crm_contacts WHERE whatsapp_number_id = p_number_id
   );

  DELETE FROM public.crm_scheduled_messages
   WHERE contact_id IN (
     SELECT id FROM public.crm_contacts WHERE whatsapp_number_id = p_number_id
   )
      OR flow_id IN (
     SELECT id FROM public.crm_flows WHERE whatsapp_number_id = p_number_id
   );

  DELETE FROM public.crm_flow_executions
   WHERE contact_id IN (
     SELECT id FROM public.crm_contacts WHERE whatsapp_number_id = p_number_id
   )
      OR flow_id IN (
     SELECT id FROM public.crm_flows WHERE whatsapp_number_id = p_number_id
   );

  DELETE FROM public.crm_messages
   WHERE whatsapp_number_id = p_number_id
      OR contact_id IN (
     SELECT id FROM public.crm_contacts WHERE whatsapp_number_id = p_number_id
   );
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM public.crm_contacts WHERE whatsapp_number_id = p_number_id;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  UPDATE public.crm_settings
     SET initial_flow_id = NULL
   WHERE user_id = v_owner_id
     AND initial_flow_id IN (
       SELECT id FROM public.crm_flows WHERE whatsapp_number_id = p_number_id
     );

  UPDATE public.crm_broadcasts
     SET flow_id = NULL
   WHERE whatsapp_number_id IS NULL
     AND flow_id IN (
       SELECT id FROM public.crm_flows WHERE whatsapp_number_id = p_number_id
     );

  UPDATE public.crm_webhooks
     SET template_id = NULL
   WHERE whatsapp_number_id IS NULL
     AND template_id IN (
       SELECT id FROM public.crm_templates WHERE whatsapp_number_id = p_number_id
     );

  DELETE FROM public.crm_broadcasts WHERE whatsapp_number_id = p_number_id;
  DELETE FROM public.crm_webhooks WHERE whatsapp_number_id = p_number_id;

  DELETE FROM public.crm_flows WHERE whatsapp_number_id = p_number_id;
  GET DIAGNOSTICS v_flows = ROW_COUNT;

  DELETE FROM public.crm_templates WHERE whatsapp_number_id = p_number_id;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  -- Limpa as credenciais somente quando esta era a caixa aberta.
  UPDATE public.crm_settings
     SET meta_access_token = NULL,
         meta_phone_number_id = NULL,
         meta_waba_id = NULL,
         meta_app_id = NULL,
         meta_app_secret = NULL,
         meta_display_phone_number = NULL,
         meta_verified_name = NULL,
         updated_at = now()
   WHERE user_id = v_owner_id
     AND meta_phone_number_id IS NOT DISTINCT FROM v_phone_id;

  DELETE FROM public.crm_whatsapp_numbers WHERE id = p_number_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.crm_whatsapp_numbers
     WHERE user_id = v_owner_id AND is_primary = true
  ) THEN
    UPDATE public.crm_whatsapp_numbers
       SET is_primary = true, updated_at = now()
     WHERE id = (
       SELECT id FROM public.crm_whatsapp_numbers
        WHERE user_id = v_owner_id
        ORDER BY created_at ASC, id ASC
        LIMIT 1
     );
  END IF;

  SELECT count(*) INTO v_remaining
    FROM public.crm_whatsapp_numbers
   WHERE user_id = v_owner_id;

  RAISE LOG '[crm_delete_whatsapp_number] user=% number=% contacts=% messages=% flows=% templates=% remaining=%',
    v_owner_id, p_number_id, v_contacts, v_messages, v_flows, v_templates, v_remaining;

  RETURN jsonb_build_object(
    'success', true,
    'remaining', v_remaining,
    'deleted_contacts', v_contacts,
    'deleted_messages', v_messages,
    'deleted_flows', v_flows,
    'deleted_templates', v_templates
  );
END;
$$;

-- Entrada usada pelo próprio cliente autenticado. A identidade sempre vem do
-- JWT; o chamador não consegue elevar a operação para administrativa.
CREATE OR REPLACE FUNCTION public.crm_delete_whatsapp_number(
  p_number_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.crm_delete_whatsapp_number_internal(
    p_number_id,
    p_user_id,
    false
  );
END;
$$;

-- Entrada separada do AdminCentral. Somente a service_role pode executá-la;
-- assim não dependemos de um claim JWT que não existe nas chaves opacas
-- usadas pela Edge Function self-hosted.
CREATE OR REPLACE FUNCTION public.crm_admin_delete_whatsapp_number(
  p_number_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.crm_delete_whatsapp_number_internal(
    p_number_id,
    p_user_id,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_delete_whatsapp_number_internal(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_delete_whatsapp_number_internal(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.crm_delete_whatsapp_number_internal(uuid, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.crm_delete_whatsapp_number_internal(uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.crm_delete_whatsapp_number(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_delete_whatsapp_number(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_delete_whatsapp_number(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.crm_admin_delete_whatsapp_number(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_admin_delete_whatsapp_number(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.crm_admin_delete_whatsapp_number(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_delete_whatsapp_number(uuid, uuid) TO service_role;
