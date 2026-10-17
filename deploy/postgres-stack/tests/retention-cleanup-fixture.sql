-- Only run inside a disposable local database, never the VPS.
CREATE TABLE public.admin_announcements(id uuid primary key,message text,updated_at timestamptz);
CREATE TABLE public.crm_contacts(id uuid primary key,user_id uuid,name text);
CREATE TABLE public.crm_messages(id uuid primary key,user_id uuid,contact_id uuid,created_at timestamptz,media_url text,content text,metadata jsonb);
CREATE TABLE public.crm_media_assets(id uuid primary key,user_id uuid,bucket text,path text,public_url text,reference_count int,updated_at timestamptz);
CREATE TABLE public.crm_media_gc_queue(id uuid default gen_random_uuid(),media_asset_id uuid,user_id uuid,bucket text,path text,public_url text,reason text,purge_after timestamptz,status text default 'pending');
CREATE UNIQUE INDEX ON public.crm_media_gc_queue(user_id,bucket,path) WHERE status='pending';
CREATE TABLE public.crm_flows(id uuid,nodes jsonb);
CREATE TABLE public.crm_templates(id uuid,components jsonb);
CREATE TABLE public.crm_ai_documents(id uuid,media_url text);
CREATE TABLE public.crm_broadcasts(id uuid,status text,template_config jsonb);
CREATE TABLE public.crm_scheduled_messages(id uuid,status text,message_data jsonb);
CREATE SCHEMA storage;
CREATE TABLE storage.objects(bucket_id text,name text,created_at timestamptz,metadata jsonb);
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
CREATE FUNCTION public.crm_incoming_protected_refs() RETURNS text LANGUAGE sql AS $$ SELECT ''::text $$;
