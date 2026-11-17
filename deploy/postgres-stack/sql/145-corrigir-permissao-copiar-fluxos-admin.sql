-- ============================================================
-- 145 - Corrigir a permissão da cópia de fluxos no AdminCentral
-- ------------------------------------------------------------
-- O PostgREST pode expor o papel do JWT em request.jwt.claims
-- (JSON), enquanto a migração 144 lia apenas request.jwt.claim.role.
-- Assim, uma chamada legítima com service_role era recusada.
-- Aceita os dois formatos e continua exclusiva do service_role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.crm_admin_copy_flows_between_numbers(
  p_flow_ids uuid[],
  p_target_number_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_target_user_id uuid;
  v_flow public.crm_flows%ROWTYPE;
  v_new_flow_id uuid;
  v_count integer := 0;
  v_requested integer;
  v_new_ids jsonb := '[]'::jsonb;
BEGIN
  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Operação exclusiva do AdminCentral';
  END IF;

  SELECT COUNT(DISTINCT id) INTO v_requested FROM unnest(COALESCE(p_flow_ids, '{}')) AS id;
  IF COALESCE(v_requested, 0) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um fluxo';
  END IF;
  IF v_requested > 100 THEN
    RAISE EXCEPTION 'Copie no máximo 100 fluxos por vez';
  END IF;

  SELECT user_id INTO v_target_user_id
    FROM public.crm_whatsapp_numbers
   WHERE id = p_target_number_id
     AND meta_access_token IS NOT NULL
     AND meta_phone_number_id IS NOT NULL
   FOR UPDATE;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'O WhatsApp de destino não está conectado';
  END IF;

  FOR v_flow IN
    SELECT f.* FROM public.crm_flows f
    WHERE f.id IN (SELECT DISTINCT id FROM unnest(p_flow_ids) AS id)
    ORDER BY f.created_at, f.id
  LOOP
    v_new_flow_id := gen_random_uuid();
    INSERT INTO public.crm_flows (
      id, name, description, is_active, trigger_keyword, created_at, updated_at,
      trigger_type, trigger_keywords, nodes, edges, user_id, trigger_tag,
      whatsapp_number_id, archived_from_number_id, archived_from_label, archived_was_active
    ) VALUES (
      v_new_flow_id, v_flow.name || ' (Cópia)', v_flow.description, false,
      v_flow.trigger_keyword, now(), now(), v_flow.trigger_type,
      v_flow.trigger_keywords, v_flow.nodes, v_flow.edges, v_target_user_id,
      v_flow.trigger_tag, p_target_number_id, NULL, NULL, NULL
    );

    INSERT INTO public.crm_flow_steps (
      flow_id, step_order, message_text, buttons, delay_seconds, created_at,
      step_type, media_url, media_type, user_id
    )
    SELECT v_new_flow_id, step_order, message_text, buttons, delay_seconds, now(),
           step_type, media_url, media_type, v_target_user_id
      FROM public.crm_flow_steps
     WHERE flow_id = v_flow.id
     ORDER BY step_order, id;

    v_new_ids := v_new_ids || jsonb_build_array(v_new_flow_id);
    v_count := v_count + 1;
  END LOOP;

  IF v_count <> v_requested THEN
    RAISE EXCEPTION 'Um ou mais fluxos de origem não foram encontrados';
  END IF;

  RETURN jsonb_build_object('success', true, 'copied', v_count, 'flow_ids', v_new_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_admin_copy_flows_between_numbers(uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_copy_flows_between_numbers(uuid[], uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
