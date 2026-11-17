CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.crm_whatsapp_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text,
  meta_display_phone_number text,
  meta_verified_name text,
  meta_access_token text,
  meta_phone_number_id text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.crm_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  trigger_keyword text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  trigger_type text DEFAULT 'keyword',
  trigger_keywords text[],
  nodes jsonb DEFAULT '[]'::jsonb,
  edges jsonb DEFAULT '[]'::jsonb,
  user_id uuid,
  trigger_tag text,
  whatsapp_number_id uuid,
  archived_from_number_id uuid,
  archived_from_label text,
  archived_was_active boolean
);
CREATE TABLE public.crm_flow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid,
  step_order integer NOT NULL,
  message_text text,
  buttons jsonb,
  delay_seconds integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  step_type text DEFAULT 'text',
  media_url text,
  media_type text,
  user_id uuid
);
