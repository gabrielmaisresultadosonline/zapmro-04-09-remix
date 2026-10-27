-- Disposable test database only; representative real column types.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.crm_whatsapp_numbers(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.crm_contacts(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),whatsapp_number_id uuid REFERENCES crm_whatsapp_numbers(id),wa_id text NOT NULL);
CREATE TABLE public.crm_messages(id uuid PRIMARY KEY,user_id uuid,contact_id uuid,content text,message_type text,metadata jsonb,media_url text,whatsapp_number_id uuid);
CREATE TABLE public.crm_scheduled_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid REFERENCES crm_contacts(id),flow_id uuid,node_id text,scheduled_for timestamptz NOT NULL,message_data jsonb NOT NULL,status text DEFAULT 'pending',created_at timestamptz DEFAULT now(),user_id uuid DEFAULT auth.uid());