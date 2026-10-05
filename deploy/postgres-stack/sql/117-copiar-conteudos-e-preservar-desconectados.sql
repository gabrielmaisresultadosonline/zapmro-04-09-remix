-- ============================================================
-- 117 - Preservar números desconectados e copiar fluxos
-- ------------------------------------------------------------
-- Desconectar mantém a caixa e todo o seu conteúdo. A exclusão
-- definitiva continua na rotina crm_delete_whatsapp_number.
-- A cópia cria novos fluxos desligados no número de destino.
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.crm_disconnect_whatsapp_number(
  p_number_id uuid,
  p_user_id uuid
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
BEGIN
  SELECT user_id, meta_phone_number_id
    INTO v_owner_id, v_phone_id
    FROM public.crm_whatsapp_numbers
   WHERE id = p_number_id
   FOR UPDATE;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Número de WhatsApp não encontrado';
  END IF;
  IF p_user_id IS DISTINCT FROM v_owner_id OR v_caller_id IS DISTINCT FROM v_owner_id THEN
    RAISE EXCEPTION 'Sem permissão para desconectar este número';
  END IF;

  UPDATE public.crm_whatsapp_numbers
     SET meta_access_token = NULL,
         meta_waba_id = NULL,
         meta_business_id = NULL,
         meta_app_id = NULL,
         meta_app_secret = NULL,
         is_active = false,
         updated_at = now()
   WHERE id = p_number_id;

  UPDATE public.crm_settings
     SET meta_access_token = NULL,
         meta_phone_number_id = NULL,
         meta_waba_id = NULL,
         meta_business_id = NULL,
         meta_app_id = NULL,
         meta_app_secret = NULL,
         meta_display_phone_number = NULL,
         meta_verified_name = NULL,
         updated_at = now()
   WHERE user_id = v_owner_id
     AND meta_phone_number_id IS NOT DISTINCT FROM v_phone_id;

  RETURN jsonb_build_object('success', true, 'number_id', p_number_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_disconnect_whatsapp_number(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_disconnect_whatsapp_number(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_copy_flows_to_number(
  p_user_id uuid,
  p_flow_ids uuid[],
  p_target_number_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_flow public.crm_flows%ROWTYPE;
  v_new_flow_id uuid;
  v_count integer := 0;
BEGIN
  IF v_caller_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Sem permissão para copiar estes fluxos';
  END IF;
  IF COALESCE(array_length(p_flow_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um fluxo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_whatsapp_numbers
     WHERE id = p_target_number_id
       AND user_id = p_user_id
       AND meta_access_token IS NOT NULL
       AND meta_phone_number_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'O WhatsApp de destino não está conectado';
  END IF;

  FOR v_flow IN
    SELECT * FROM public.crm_flows
     WHERE user_id = p_user_id AND id = ANY(p_flow_ids)
     ORDER BY created_at, id
  LOOP
    v_new_flow_id := gen_random_uuid();
    INSERT INTO public.crm_flows (
      id, name, description, is_active, trigger_keyword, created_at, updated_at,
      trigger_type, trigger_keywords, nodes, edges, user_id, trigger_tag,
      whatsapp_number_id, archived_from_number_id, archived_from_label, archived_was_active
    ) VALUES (
      v_new_flow_id, v_flow.name || ' (Cópia)', v_flow.description, false,
      v_flow.trigger_keyword, now(), now(), v_flow.trigger_type,
      v_flow.trigger_keywords, v_flow.nodes, v_flow.edges, p_user_id,
      v_flow.trigger_tag, p_target_number_id, NULL, NULL, NULL
    );

    INSERT INTO public.crm_flow_steps (
      flow_id, step_order, message_text, buttons, delay_seconds, created_at,
      step_type, media_url, media_type, user_id
    )
    SELECT v_new_flow_id, step_order, message_text, buttons, delay_seconds, now(),
           step_type, media_url, media_type, p_user_id
      FROM public.crm_flow_steps
     WHERE flow_id = v_flow.id
     ORDER BY step_order, id;
    v_count := v_count + 1;
  END LOOP;

  IF v_count <> COALESCE(array_length(p_flow_ids, 1), 0) THEN
    RAISE EXCEPTION 'Um ou mais fluxos não pertencem a este cadastro';
  END IF;
  RETURN jsonb_build_object('success', true, 'copied', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_copy_flows_to_number(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_copy_flows_to_number(uuid, uuid[], uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';