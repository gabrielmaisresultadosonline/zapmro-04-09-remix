-- Additive migration: keep contacts, messages and existing automations intact.
ALTER TABLE public.crm_scheduled_messages ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid REFERENCES public.crm_whatsapp_numbers(id) ON DELETE SET NULL;
ALTER TABLE public.crm_scheduled_messages ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.crm_scheduled_messages ADD COLUMN IF NOT EXISTS last_error text;
UPDATE public.crm_scheduled_messages s SET user_id=c.user_id, whatsapp_number_id=COALESCE(s.whatsapp_number_id,c.whatsapp_number_id)
FROM public.crm_contacts c WHERE c.id=s.contact_id AND (s.user_id IS NULL OR s.whatsapp_number_id IS NULL);
CREATE INDEX IF NOT EXISTS crm_scheduled_due_idx ON public.crm_scheduled_messages(scheduled_for) WHERE status='pending';
CREATE OR REPLACE FUNCTION public.crm_schedule_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.crm_contacts;
BEGIN
 SELECT * INTO c FROM public.crm_contacts WHERE id=NEW.contact_id;
 IF c.id IS NULL OR c.user_id IS NULL THEN RAISE EXCEPTION 'Contato do agendamento inválido'; END IF;
 IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM c.user_id THEN RAISE EXCEPTION 'Cadastro do agendamento inválido'; END IF;
 IF NEW.whatsapp_number_id IS NOT NULL AND c.whatsapp_number_id IS NOT NULL AND NEW.whatsapp_number_id<>c.whatsapp_number_id THEN RAISE EXCEPTION 'WhatsApp do contato não corresponde ao agendamento'; END IF;
 NEW.user_id:=c.user_id;
 NEW.whatsapp_number_id:=COALESCE(NEW.whatsapp_number_id,c.whatsapp_number_id);
 IF NEW.whatsapp_number_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.crm_whatsapp_numbers n WHERE n.id=NEW.whatsapp_number_id AND n.user_id=c.user_id) THEN RAISE EXCEPTION 'WhatsApp de outro cadastro'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_schedule_owner_trigger ON public.crm_scheduled_messages;
CREATE TRIGGER crm_schedule_owner_trigger BEFORE INSERT OR UPDATE OF contact_id,user_id,whatsapp_number_id ON public.crm_scheduled_messages FOR EACH ROW EXECUTE FUNCTION public.crm_schedule_owner();
CREATE OR REPLACE FUNCTION public.crm_claim_scheduled_messages(p_limit integer DEFAULT 10)
RETURNS SETOF public.crm_scheduled_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.crm_scheduled_messages SET status='failed',last_error='Execução interrompida; confira a conversa antes de reagendar.',processed_at=now()
 WHERE status='processing' AND processed_at<now()-interval '10 minutes';
 RETURN QUERY UPDATE public.crm_scheduled_messages SET status='processing',processed_at=now()
 WHERE id IN (SELECT id FROM public.crm_scheduled_messages WHERE status='pending' AND scheduled_for<=now() ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT GREATEST(1,LEAST(p_limit,50))) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.crm_claim_scheduled_messages(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_claim_scheduled_messages(integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.crm_translation_settings (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 target_language text NOT NULL DEFAULT 'pt',
 auto_incoming boolean NOT NULL DEFAULT false,
 auto_outgoing boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(target_language IN ('pt','en','es','fr','de','it','ar','ja','zh','ru','ko','hi'))
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.crm_translation_settings TO authenticated;
GRANT ALL ON public.crm_translation_settings TO service_role;
ALTER TABLE public.crm_translation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS translation_settings_owner ON public.crm_translation_settings;
CREATE POLICY translation_settings_owner ON public.crm_translation_settings TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE TABLE IF NOT EXISTS public.crm_message_translations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 message_id uuid NOT NULL REFERENCES public.crm_messages(id) ON DELETE CASCADE,
 target_language text NOT NULL,
 original_text text NOT NULL,
 translated_text text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(message_id,target_language)
);
GRANT SELECT ON public.crm_message_translations TO authenticated;
GRANT ALL ON public.crm_message_translations TO service_role;
ALTER TABLE public.crm_message_translations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS translations_owner ON public.crm_message_translations;
CREATE POLICY translations_owner ON public.crm_message_translations FOR SELECT TO authenticated USING(user_id=auth.uid());
NOTIFY pgrst,'reload schema';