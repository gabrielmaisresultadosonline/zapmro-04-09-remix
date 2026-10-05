-- Google Contatos: só exporta contatos RENOMEADOS pelo usuário.
-- Antes, todo contato novo (nome do perfil do WhatsApp ou o próprio número)
-- entrava na fila. Agora só entra quem foi marcado como renomeado
-- (metadata.user_renamed) ou alterado depois de sincronizado (google_dirty).
CREATE OR REPLACE FUNCTION public.claim_crm_contacts_for_google_sync(p_user_id uuid, p_limit integer, p_claim_token uuid)
 RETURNS SETOF crm_contacts
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH candidates AS (
    SELECT c.id
    FROM public.crm_contacts AS c
    WHERE c.user_id = p_user_id
      AND (
        c.metadata->>'google_dirty' = 'true'
        OR (c.google_sync_account_id IS NULL AND c.metadata->>'user_renamed' = 'true')
      )
      AND NULLIF(btrim(c.name), '') IS NOT NULL
      AND btrim(c.name) <> btrim(COALESCE(c.wa_id, ''))
      AND (
        c.google_sync_claimed_at IS NULL
        OR c.google_sync_claimed_at < now() - interval '10 minutes'
      )
    ORDER BY c.created_at ASC, c.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500)
  )
  UPDATE public.crm_contacts AS c
  SET google_sync_claim_token = p_claim_token,
      google_sync_claimed_at = now()
  FROM candidates
  WHERE c.id = candidates.id
  RETURNING c.*;
$function$;
