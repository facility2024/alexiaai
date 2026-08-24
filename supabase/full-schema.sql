-- =============================================================
-- SQL GERAL — LexIA CRM (Supabase)
-- Projeto: tweoiunfpawwwyzezlax — 100% idempotente
-- Execute no SQL Editor do Supabase Dashboard.
-- =============================================================

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS supabase_vault; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pgmq; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ENUMS
DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('admin','specialist','agent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.case_status AS ENUM ('triage','analysis','scheduling','scheduled','closed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.agent_type AS ENUM ('agent_1','agent_2','agent_3'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.message_role AS ENUM ('user','assistant','system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.document_status AS ENUM ('pending','processing','processed','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- =============================================================
-- 1. PROFILES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT, phone TEXT, email TEXT,
  avatar_url TEXT,
  max_members INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles; CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles; CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles; CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles; CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 2. USER ROLES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
DO $$ BEGIN DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles; CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles; CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 3. CLIENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  full_name TEXT, cpf TEXT, phone TEXT, email TEXT,
  address TEXT, city TEXT, state TEXT, birth_date DATE, notes TEXT,
  address_street TEXT, address_number TEXT, address_complement TEXT,
  neighborhood TEXT, zip TEXT, interest_level TEXT,
  is_complete BOOLEAN NOT NULL DEFAULT false,
  followup_status TEXT NOT NULL DEFAULT 'none',
  followup_queued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated can view clients" ON public.clients; CREATE POLICY "Authenticated can view clients" ON public.clients FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated can insert clients" ON public.clients; CREATE POLICY "Authenticated can insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated can update clients" ON public.clients; CREATE POLICY "Authenticated can update clients" ON public.clients FOR UPDATE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can delete clients" ON public.clients; CREATE POLICY "Staff can delete clients" ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients; CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 4. CASES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.cases (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status public.case_status NOT NULL DEFAULT 'triage',
  current_agent public.agent_type NOT NULL DEFAULT 'agent_1',
  case_type TEXT, classification TEXT, summary TEXT,
  assigned_specialist_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;
GRANT ALL ON public.cases TO service_role;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated can view cases" ON public.cases; CREATE POLICY "Authenticated can view cases" ON public.cases FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated can insert cases" ON public.cases; CREATE POLICY "Authenticated can insert cases" ON public.cases FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated can update cases" ON public.cases; CREATE POLICY "Authenticated can update cases" ON public.cases FOR UPDATE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can delete cases" ON public.cases; CREATE POLICY "Staff can delete cases" ON public.cases FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_cases_client_id ON public.cases(client_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON public.cases(status);
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_cases_updated_at ON public.cases; CREATE TRIGGER trg_cases_updated_at BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 5. MESSAGES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  agent public.agent_type NOT NULL, role public.message_role NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb, metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can view all messages" ON public.messages; CREATE POLICY "Staff can view all messages" ON public.messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_messages_case_id ON public.messages(case_id, created_at);

-- =============================================================
-- 6. DOCUMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, file_path TEXT NOT NULL,
  mime_type TEXT, size_bytes BIGINT, document_type TEXT,
  extracted_text TEXT, status public.document_status NOT NULL DEFAULT 'pending',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can read case documents" ON public.documents; CREATE POLICY "Staff can read case documents" ON public.documents FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can upload case documents" ON public.documents; CREATE POLICY "Staff can upload case documents" ON public.documents FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can delete case documents" ON public.documents; CREATE POLICY "Staff can delete case documents" ON public.documents FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_documents_case_id ON public.documents(case_id);
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents; CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 7. REQUIRED DOCUMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.required_documents (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL, is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  received BOOLEAN NOT NULL DEFAULT FALSE,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.required_documents TO authenticated;
GRANT ALL ON public.required_documents TO service_role;
ALTER TABLE public.required_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can view all required_documents" ON public.required_documents; CREATE POLICY "Staff can view all required_documents" ON public.required_documents FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_required_documents_case_id ON public.required_documents(case_id);

-- =============================================================
-- 8. CASE ANALYSIS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.case_analysis (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL UNIQUE REFERENCES public.cases(id) ON DELETE CASCADE,
  legal_summary TEXT, suggested_strategy TEXT, risks TEXT, opportunities TEXT,
  viability_score INT CHECK (viability_score BETWEEN 0 AND 100),
  pending_items TEXT, knowledge_refs JSONB DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_analysis TO authenticated;
GRANT ALL ON public.case_analysis TO service_role;
ALTER TABLE public.case_analysis ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can view all analysis" ON public.case_analysis; CREATE POLICY "Staff can view all analysis" ON public.case_analysis FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_case_analysis_updated_at ON public.case_analysis; CREATE TRIGGER trg_case_analysis_updated_at BEFORE UPDATE ON public.case_analysis FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 9. APPOINTMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  specialist_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL, duration_minutes INT NOT NULL DEFAULT 60,
  meeting_link TEXT, calendar_event_id TEXT, google_event_id TEXT, google_event_link TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can view all appointments" ON public.appointments; CREATE POLICY "Staff can view all appointments" ON public.appointments FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can manage appointments" ON public.appointments; CREATE POLICY "Staff can manage appointments" ON public.appointments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments; CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 10. KNOWLEDGE BASE
-- =============================================================
CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL, category TEXT, content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}', active BOOLEAN NOT NULL DEFAULT TRUE,
  agent_key TEXT DEFAULT 'whatsapp',
  agent_keys TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_base TO authenticated;
GRANT ALL ON public.knowledge_base TO service_role;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can view knowledge" ON public.knowledge_base; CREATE POLICY "Staff can view knowledge" ON public.knowledge_base FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Admins manage knowledge" ON public.knowledge_base; CREATE POLICY "Admins manage knowledge" ON public.knowledge_base FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_knowledge_base_agent_keys ON public.knowledge_base(agent_key);
ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS agent_keys text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS idx_knowledge_base_agent_keys_gin ON public.knowledge_base USING GIN (agent_keys);
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_knowledge_base_updated_at ON public.knowledge_base; CREATE TRIGGER trg_knowledge_base_updated_at BEFORE UPDATE ON public.knowledge_base FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 11. AGENT HANDOFFS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.agent_handoffs (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  from_agent public.agent_type NOT NULL, to_agent public.agent_type NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_handoffs TO authenticated;
GRANT ALL ON public.agent_handoffs TO service_role;
ALTER TABLE public.agent_handoffs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Staff can view handoffs" ON public.agent_handoffs; CREATE POLICY "Staff can view handoffs" ON public.agent_handoffs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_case_id ON public.agent_handoffs(case_id);

-- =============================================================
-- 12. AI SETTINGS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  system_prompt TEXT, temperature NUMERIC DEFAULT 0.7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users manage own ai_settings" ON public.ai_settings; CREATE POLICY "Users manage own ai_settings" ON public.ai_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS update_ai_settings_updated_at ON public.ai_settings; CREATE TRIGGER update_ai_settings_updated_at BEFORE UPDATE ON public.ai_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 13. WAPI CONFIG
-- =============================================================
CREATE TABLE IF NOT EXISTS public.wapi_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  instance_id TEXT NOT NULL, api_token TEXT NOT NULL, phone_number TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected', webhook_url TEXT,
  is_connected BOOLEAN NOT NULL DEFAULT false, reply_in_groups BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wapi_config TO authenticated;
GRANT ALL ON public.wapi_config TO service_role;
ALTER TABLE public.wapi_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users manage own wapi_config" ON public.wapi_config; CREATE POLICY "Users manage own wapi_config" ON public.wapi_config FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS update_wapi_config_updated_at ON public.wapi_config; CREATE TRIGGER update_wapi_config_updated_at BEFORE UPDATE ON public.wapi_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 14. MEDIA ASSETS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.media_assets (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','audio','voice','document')),
  mime TEXT, filename TEXT, size BIGINT, width INTEGER, height INTEGER,
  duration_ms INTEGER, sha256 TEXT, storage_provider TEXT NOT NULL DEFAULT 'bunny',
  storage_path TEXT, thumbnail_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','ready','failed')),
  origin TEXT, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO authenticated;
GRANT ALL ON public.media_assets TO service_role;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users manage own media" ON public.media_assets; CREATE POLICY "Users manage own media" ON public.media_assets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS media_assets_user_created_idx ON public.media_assets(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_user_sha_uidx ON public.media_assets(user_id, sha256) WHERE sha256 IS NOT NULL;
DO $$ BEGIN DROP TRIGGER IF EXISTS media_assets_updated_at ON public.media_assets; CREATE TRIGGER media_assets_updated_at BEFORE UPDATE ON public.media_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 15. ORG MEMBERS + FUNCTIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'agent',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.get_org_owner(_user_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT owner_id FROM public.org_members WHERE member_id = _user_id AND active LIMIT 1), _user_id) $$;
CREATE OR REPLACE FUNCTION public.is_org_member(_owner UUID, _user UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _owner = _user OR EXISTS (SELECT 1 FROM public.org_members WHERE owner_id = _owner AND member_id = _user AND active) $$;
CREATE OR REPLACE FUNCTION public.get_master_owner()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1 $$;
DO $$ BEGIN DROP POLICY IF EXISTS "org_members read" ON public.org_members; CREATE POLICY "org_members read" ON public.org_members FOR SELECT USING (owner_id = auth.uid() OR member_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "org_members self read" ON public.org_members; CREATE POLICY "org_members self read" ON public.org_members FOR SELECT USING (member_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "org_members owner writes" ON public.org_members; CREATE POLICY "org_members owner writes" ON public.org_members FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_org_members_updated_at ON public.org_members; CREATE TRIGGER trg_org_members_updated_at BEFORE UPDATE ON public.org_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_org_members_member ON public.org_members(member_id);

-- =============================================================
-- 16. USER PERMISSIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  can_view_all_chats BOOLEAN NOT NULL DEFAULT false, can_edit_kanban BOOLEAN NOT NULL DEFAULT true,
  can_manage_clients BOOLEAN NOT NULL DEFAULT true, can_manage_cases BOOLEAN NOT NULL DEFAULT true,
  can_send_billing BOOLEAN NOT NULL DEFAULT false, can_configure_ai BOOLEAN NOT NULL DEFAULT false,
  can_access_knowledge BOOLEAN NOT NULL DEFAULT true, can_manage_sectors BOOLEAN NOT NULL DEFAULT false,
  can_export BOOLEAN NOT NULL DEFAULT false, can_manage_contracts BOOLEAN NOT NULL DEFAULT false,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "perms owner all" ON public.user_permissions; CREATE POLICY "perms owner all" ON public.user_permissions FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "perms user read" ON public.user_permissions; CREATE POLICY "perms user read" ON public.user_permissions FOR SELECT USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_user_permissions_updated_at ON public.user_permissions; CREATE TRIGGER trg_user_permissions_updated_at BEFORE UPDATE ON public.user_permissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 17. SECTORS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT, keywords TEXT[] NOT NULL DEFAULT '{}',
  icon TEXT, color TEXT DEFAULT '#8b5cf6', active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sectors TO authenticated;
GRANT ALL ON public.sectors TO service_role;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "sectors org read" ON public.sectors; CREATE POLICY "sectors org read" ON public.sectors FOR SELECT USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "sectors owner write" ON public.sectors; CREATE POLICY "sectors owner write" ON public.sectors FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_sectors_updated_at ON public.sectors; CREATE TRIGGER trg_sectors_updated_at BEFORE UPDATE ON public.sectors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 18. SECTOR MEMBERS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.sector_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_lead BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sector_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sector_members TO authenticated;
GRANT ALL ON public.sector_members TO service_role;
ALTER TABLE public.sector_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "sm org read" ON public.sector_members; CREATE POLICY "sm org read" ON public.sector_members FOR SELECT USING (EXISTS (SELECT 1 FROM public.sectors s WHERE s.id = sector_members.sector_id AND public.is_org_member(s.owner_id, auth.uid()))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "sm owner write" ON public.sector_members; CREATE POLICY "sm owner write" ON public.sector_members FOR ALL USING (EXISTS (SELECT 1 FROM public.sectors s WHERE s.id = sector_members.sector_id AND s.owner_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.sectors s WHERE s.id = sector_members.sector_id AND s.owner_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 19. INVITES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE, slug TEXT, email TEXT,
  role public.app_role NOT NULL DEFAULT 'agent',
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb, sector_ids UUID[] NOT NULL DEFAULT '{}',
  note TEXT, expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  used_at TIMESTAMPTZ, used_by UUID REFERENCES auth.users(id), revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "invites owner all" ON public.invites; CREATE POLICY "invites owner all" ON public.invites FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 20. INVITE ACCESS REQUESTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.invite_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id UUID NOT NULL REFERENCES public.invites(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL, token_used TEXT NOT NULL, full_name TEXT NOT NULL,
  email TEXT, status TEXT NOT NULL DEFAULT 'pending', notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invite_access_requests TO authenticated;
GRANT ALL ON public.invite_access_requests TO service_role;
ALTER TABLE public.invite_access_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Owner can view own invite requests" ON public.invite_access_requests; CREATE POLICY "Owner can view own invite requests" ON public.invite_access_requests FOR SELECT TO authenticated USING (auth.uid() = owner_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Owner can update own invite requests" ON public.invite_access_requests; CREATE POLICY "Owner can update own invite requests" ON public.invite_access_requests FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Owner can delete own invite requests" ON public.invite_access_requests; CREATE POLICY "Owner can delete own invite requests" ON public.invite_access_requests FOR DELETE TO authenticated USING (auth.uid() = owner_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_invite_access_requests_updated ON public.invite_access_requests; CREATE TRIGGER trg_invite_access_requests_updated BEFORE UPDATE ON public.invite_access_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 21. CHAT ASSIGNMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.chat_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL, assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sector_id UUID REFERENCES public.sectors(id) ON DELETE SET NULL,
  assigned_by TEXT NOT NULL DEFAULT 'ai',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_assignments TO authenticated;
GRANT ALL ON public.chat_assignments TO service_role;
ALTER TABLE public.chat_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "ca org read" ON public.chat_assignments; CREATE POLICY "ca org read" ON public.chat_assignments FOR SELECT USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "ca write" ON public.chat_assignments; CREATE POLICY "ca write" ON public.chat_assignments FOR ALL USING (owner_id = auth.uid() OR (public.is_org_member(owner_id, auth.uid()) AND assigned_to = auth.uid())) WITH CHECK (owner_id = auth.uid() OR (public.is_org_member(owner_id, auth.uid()) AND assigned_to = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_chat_assignments_updated_at ON public.chat_assignments; CREATE TRIGGER trg_chat_assignments_updated_at BEFORE UPDATE ON public.chat_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_assignments; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_chat_assignments_lookup ON public.chat_assignments(owner_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_assignments_user ON public.chat_assignments(assigned_to);

-- =============================================================
-- 22. CHAT TRANSFER LOG
-- =============================================================
CREATE TABLE IF NOT EXISTS public.chat_transfer_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL, from_user UUID, to_user UUID, sector_id UUID,
  actor TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chat_transfer_log TO authenticated;
GRANT ALL ON public.chat_transfer_log TO service_role;
ALTER TABLE public.chat_transfer_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "ctl org read" ON public.chat_transfer_log; CREATE POLICY "ctl org read" ON public.chat_transfer_log FOR SELECT USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "ctl insert" ON public.chat_transfer_log; CREATE POLICY "ctl insert" ON public.chat_transfer_log FOR INSERT WITH CHECK (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 23. AI GLOBAL STATE
-- =============================================================
CREATE TABLE IF NOT EXISTS public.ai_global_state (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by UUID REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_global_state TO authenticated;
GRANT ALL ON public.ai_global_state TO service_role;
ALTER TABLE public.ai_global_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "ags org read" ON public.ai_global_state; CREATE POLICY "ags org read" ON public.ai_global_state FOR SELECT USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "ags owner write" ON public.ai_global_state; CREATE POLICY "ags owner write" ON public.ai_global_state FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 24. CHAT LABELS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.chat_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL, created_by UUID NOT NULL,
  name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#22c55e',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_labels TO authenticated;
GRANT ALL ON public.chat_labels TO service_role;
ALTER TABLE public.chat_labels ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can view labels" ON public.chat_labels; CREATE POLICY "Org members can view labels" ON public.chat_labels FOR SELECT TO authenticated USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can create labels" ON public.chat_labels; CREATE POLICY "Org members can create labels" ON public.chat_labels FOR INSERT TO authenticated WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND created_by = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Owner or creator can update labels" ON public.chat_labels; CREATE POLICY "Owner or creator can update labels" ON public.chat_labels FOR UPDATE TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Owner or creator can delete labels" ON public.chat_labels; CREATE POLICY "Owner or creator can delete labels" ON public.chat_labels FOR DELETE TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 25. CHAT LABEL ASSIGNMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.chat_label_assignments (
  owner_id UUID NOT NULL, chat_id TEXT NOT NULL,
  label_id UUID NOT NULL REFERENCES public.chat_labels(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL, assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, label_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_label_assignments TO authenticated;
GRANT ALL ON public.chat_label_assignments TO service_role;
ALTER TABLE public.chat_label_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can view assignments" ON public.chat_label_assignments; CREATE POLICY "Org members can view assignments" ON public.chat_label_assignments FOR SELECT TO authenticated USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can create assignments" ON public.chat_label_assignments; CREATE POLICY "Org members can create assignments" ON public.chat_label_assignments FOR INSERT TO authenticated WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND assigned_by = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can delete assignments" ON public.chat_label_assignments; CREATE POLICY "Org members can delete assignments" ON public.chat_label_assignments FOR DELETE TO authenticated USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS chat_label_assignments_chat_idx ON public.chat_label_assignments(chat_id);
CREATE INDEX IF NOT EXISTS chat_label_assignments_owner_idx ON public.chat_label_assignments(owner_id);

-- =============================================================
-- 26. CRM MESSAGES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.crm_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender TEXT NOT NULL CHECK (sender IN ('contact','bot','operator','system','whatsapp','triagem','analise','documentos')),
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image','audio','video','document')),
  content TEXT, media_url TEXT, transcription TEXT, wapi_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'received', raw JSONB,
  storage_path TEXT, mime TEXT, size BIGINT, duration_ms INTEGER,
  width INTEGER, height INTEGER, sha256 TEXT, filename TEXT,
  media_id TEXT REFERENCES public.media_assets(id) ON DELETE SET NULL,
  media_status TEXT, media_attempts INTEGER NOT NULL DEFAULT 0,
  media_next_retry_at TIMESTAMPTZ, media_last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_messages TO authenticated;
GRANT ALL ON public.crm_messages TO service_role;
ALTER TABLE public.crm_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "users manage own crm_messages" ON public.crm_messages; CREATE POLICY "users manage own crm_messages" ON public.crm_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "crm_messages team visibility" ON public.crm_messages; CREATE POLICY "crm_messages team visibility" ON public.crm_messages FOR SELECT USING (EXISTS (SELECT 1 FROM public.user_permissions p WHERE p.owner_id = crm_messages.user_id AND p.user_id = auth.uid() AND p.can_view_all_chats) OR EXISTS (SELECT 1 FROM public.chat_assignments ca WHERE ca.owner_id = crm_messages.user_id AND ca.chat_id = crm_messages.chat_id AND ca.assigned_to = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS media_status text;
ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS media_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS media_next_retry_at timestamptz;
ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS media_last_error text;
DO $$ BEGIN
  ALTER TABLE public.crm_messages DROP CONSTRAINT IF EXISTS crm_messages_sender_check;
  ALTER TABLE public.crm_messages ADD CONSTRAINT crm_messages_sender_check CHECK (sender IN ('contact','bot','operator','system','whatsapp','triagem','analise','documentos'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_crm_messages_user_chat ON public.crm_messages(user_id, chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_user_created ON public.crm_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_messages_media_id_idx ON public.crm_messages(media_id) WHERE media_id IS NOT NULL;
DROP INDEX IF EXISTS public.crm_messages_media_pending_idx;
CREATE INDEX crm_messages_media_pending_idx ON public.crm_messages(media_next_retry_at) WHERE media_status IN ('pending','processing','failed_retry');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_wapi_unique') THEN
    ALTER TABLE public.crm_messages ADD CONSTRAINT crm_messages_wapi_unique UNIQUE (user_id, direction, wapi_message_id);
  END IF;
END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_messages; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 27. CRM PAUSED CHATS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.crm_paused_chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL, paused_by TEXT NOT NULL CHECK (paused_by IN ('user','operator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_paused_chats TO authenticated;
GRANT ALL ON public.crm_paused_chats TO service_role;
ALTER TABLE public.crm_paused_chats ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "users manage own paused chats" ON public.crm_paused_chats; CREATE POLICY "users manage own paused chats" ON public.crm_paused_chats FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_paused_chats; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 28. AI PERSONALITY
-- =============================================================
CREATE TABLE IF NOT EXISTS public.ai_personality (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL DEFAULT 'whatsapp',
  persona TEXT, tone TEXT, rules TEXT,
  use_knowledge_base BOOLEAN NOT NULL DEFAULT true,
  max_chars_per_chunk INT NOT NULL DEFAULT 250, typing_delay_ms INT NOT NULL DEFAULT 25000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_personality TO authenticated;
GRANT ALL ON public.ai_personality TO service_role;
ALTER TABLE public.ai_personality ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "users manage own personality" ON public.ai_personality; CREATE POLICY "users manage own personality" ON public.ai_personality FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_ai_personality_updated ON public.ai_personality; CREATE TRIGGER trg_ai_personality_updated BEFORE UPDATE ON public.ai_personality FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 29. KNOWLEDGE BASE DOCUMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.knowledge_base_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'text', source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_base_documents TO authenticated;
GRANT ALL ON public.knowledge_base_documents TO service_role;
ALTER TABLE public.knowledge_base_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "users manage own kb docs" ON public.knowledge_base_documents; CREATE POLICY "users manage own kb docs" ON public.knowledge_base_documents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_kb_docs_updated ON public.knowledge_base_documents; CREATE TRIGGER trg_kb_docs_updated BEFORE UPDATE ON public.knowledge_base_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 30. KNOWLEDGE CHUNKS + RAG
-- =============================================================
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.knowledge_base_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL, embedding vector(1536), chunk_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "users manage own kb chunks" ON public.knowledge_chunks; CREATE POLICY "users manage own kb chunks" ON public.knowledge_chunks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(_user_id UUID, query_embedding vector(1536), match_count INT DEFAULT 5)
RETURNS TABLE (id UUID, document_id UUID, content TEXT, similarity FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT kc.id, kc.document_id, kc.content, 1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc WHERE kc.user_id = _user_id AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> query_embedding LIMIT match_count; $$;

-- =============================================================
-- 31. FLOWS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, definition JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows TO authenticated;
GRANT ALL ON public.flows TO service_role;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "users manage own flows" ON public.flows; CREATE POLICY "users manage own flows" ON public.flows FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_flows_updated ON public.flows; CREATE TRIGGER trg_flows_updated BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 32. FLOW CONVERSATIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.flow_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flow_id UUID REFERENCES public.flows(id) ON DELETE SET NULL,
  chat_id TEXT NOT NULL, current_node_id TEXT,
  session_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_conversations TO authenticated;
GRANT ALL ON public.flow_conversations TO service_role;
ALTER TABLE public.flow_conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "users manage own flow conversations" ON public.flow_conversations; CREATE POLICY "users manage own flow conversations" ON public.flow_conversations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_flow_conv_updated ON public.flow_conversations; CREATE TRIGGER trg_flow_conv_updated BEFORE UPDATE ON public.flow_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 33. KANBAN COLUMNS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.kanban_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#8b5cf6', icon TEXT NOT NULL DEFAULT 'Circle',
  rule_prompt TEXT, auto_action TEXT, is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_columns TO authenticated;
GRANT ALL ON public.kanban_columns TO service_role;
ALTER TABLE public.kanban_columns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own kanban_columns" ON public.kanban_columns; CREATE POLICY "own kanban_columns" ON public.kanban_columns FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_kanban_columns_user ON public.kanban_columns(user_id, position);
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_kanban_columns_updated ON public.kanban_columns; CREATE TRIGGER trg_kanban_columns_updated BEFORE UPDATE ON public.kanban_columns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 34. KANBAN TAGS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.kanban_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#8b5cf6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_tags TO authenticated;
GRANT ALL ON public.kanban_tags TO service_role;
ALTER TABLE public.kanban_tags ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own kanban_tags" ON public.kanban_tags; CREATE POLICY "own kanban_tags" ON public.kanban_tags FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 35. KANBAN CARDS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.kanban_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES public.kanban_columns(id) ON DELETE RESTRICT,
  chat_id TEXT NOT NULL, contact_name TEXT, contact_phone TEXT,
  tag_ids UUID[] NOT NULL DEFAULT '{}', assignee TEXT,
  estimated_value NUMERIC(12,2), summary TEXT, position INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ, ai_enabled BOOLEAN NOT NULL DEFAULT true,
  legal_area TEXT, urgency TEXT CHECK (urgency IN ('baixa','media','alta','urgente')),
  viability_score INTEGER CHECK (viability_score BETWEEN 0 AND 100),
  estimated_ticket NUMERIC(12,2), case_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  case_timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_ai_analysis_at TIMESTAMPTZ, last_client_message_at TIMESTAMPTZ,
  sla_hours INTEGER NOT NULL DEFAULT 24, qualified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_cards TO authenticated;
GRANT ALL ON public.kanban_cards TO service_role;
ALTER TABLE public.kanban_cards ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own kanban_cards" ON public.kanban_cards; CREATE POLICY "own kanban_cards" ON public.kanban_cards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_kanban_cards_col ON public.kanban_cards(user_id, column_id, position);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_urgency ON public.kanban_cards(user_id, urgency);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_last_msg ON public.kanban_cards(user_id, last_client_message_at);
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_kanban_cards_updated ON public.kanban_cards; CREATE TRIGGER trg_kanban_cards_updated BEFORE UPDATE ON public.kanban_cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 36. KANBAN CARD EVENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.kanban_card_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.kanban_cards(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, from_column_id UUID, to_column_id UUID,
  actor TEXT NOT NULL DEFAULT 'user', payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_card_events TO authenticated;
GRANT ALL ON public.kanban_card_events TO service_role;
ALTER TABLE public.kanban_card_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own kanban_card_events" ON public.kanban_card_events; CREATE POLICY "own kanban_card_events" ON public.kanban_card_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_kanban_events_card ON public.kanban_card_events(card_id, created_at DESC);

-- =============================================================
-- 37. KANBAN DOC CHECKLIST
-- =============================================================
CREATE TABLE IF NOT EXISTS public.kanban_doc_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_type TEXT NOT NULL DEFAULT 'geral', document_name TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true, position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_doc_checklist TO authenticated;
GRANT ALL ON public.kanban_doc_checklist TO service_role;
ALTER TABLE public.kanban_doc_checklist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own kanban_doc_checklist" ON public.kanban_doc_checklist; CREATE POLICY "own kanban_doc_checklist" ON public.kanban_doc_checklist FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 38. LEGAL AREA TEMPLATES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.legal_area_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area TEXT NOT NULL, document_name TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true, position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id, area, document_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_area_templates TO authenticated;
GRANT ALL ON public.legal_area_templates TO service_role;
ALTER TABLE public.legal_area_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own legal_area_templates" ON public.legal_area_templates; CREATE POLICY "own legal_area_templates" ON public.legal_area_templates FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 39. KANBAN CARD DOCUMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.kanban_card_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.kanban_cards(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL, required BOOLEAN NOT NULL DEFAULT true,
  received BOOLEAN NOT NULL DEFAULT false, received_at TIMESTAMPTZ, notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(card_id, document_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_card_documents TO authenticated;
GRANT ALL ON public.kanban_card_documents TO service_role;
ALTER TABLE public.kanban_card_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own kanban_card_documents" ON public.kanban_card_documents; CREATE POLICY "own kanban_card_documents" ON public.kanban_card_documents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_kanban_card_documents_card ON public.kanban_card_documents(card_id);
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_kanban_card_documents_updated ON public.kanban_card_documents; CREATE TRIGGER trg_kanban_card_documents_updated BEFORE UPDATE ON public.kanban_card_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 40. BILLINGS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.billings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  gateway TEXT NOT NULL CHECK (gateway IN ('asaas','mercadopago','stripe','manual')),
  external_id TEXT, status TEXT NOT NULL DEFAULT 'pending', billing_type TEXT,
  amount NUMERIC(12,2) NOT NULL, currency TEXT NOT NULL DEFAULT 'BRL',
  description TEXT, due_date DATE, paid_at TIMESTAMPTZ,
  invoice_url TEXT, pix_code TEXT, bank_slip_url TEXT, raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway, external_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billings TO authenticated;
GRANT ALL ON public.billings TO service_role;
ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users manage own billings" ON public.billings; CREATE POLICY "Users manage own billings" ON public.billings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_billings_user_created ON public.billings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billings_user_card ON public.billings(user_id, card_id);
DO $$ BEGIN DROP TRIGGER IF EXISTS update_billings_updated_at ON public.billings; CREATE TRIGGER update_billings_updated_at BEFORE UPDATE ON public.billings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 41. PAYMENT WEBHOOK EVENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway TEXT NOT NULL, event_type TEXT, external_id TEXT,
  payload JSONB NOT NULL, processed BOOLEAN NOT NULL DEFAULT false,
  error TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.payment_webhook_events TO service_role;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pwe_gateway_received ON public.payment_webhook_events(gateway, received_at DESC);

-- =============================================================
-- 42. PAYMENT CREDENTIALS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.payment_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway TEXT NOT NULL CHECK (gateway IN ('asaas','mercadopago','stripe')),
  display_name TEXT, api_key TEXT,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production','sandbox')),
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, gateway)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_credentials TO authenticated;
GRANT ALL ON public.payment_credentials TO service_role;
ALTER TABLE public.payment_credentials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own creds" ON public.payment_credentials; CREATE POLICY "own creds" ON public.payment_credentials FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS payment_credentials_updated_at ON public.payment_credentials; CREATE TRIGGER payment_credentials_updated_at BEFORE UPDATE ON public.payment_credentials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 43. SMS CREDENTIALS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.sms_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, display_name TEXT, api_key TEXT NOT NULL,
  api_secret TEXT, sender_id TEXT, base_url TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_credentials TO authenticated;
GRANT ALL ON public.sms_credentials TO service_role;
ALTER TABLE public.sms_credentials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "own sms creds" ON public.sms_credentials; CREATE POLICY "own sms creds" ON public.sms_credentials FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS update_sms_credentials_updated_at ON public.sms_credentials; CREATE TRIGGER update_sms_credentials_updated_at BEFORE UPDATE ON public.sms_credentials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 44. CLIENT SMS FOLLOWUPS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.client_sms_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, title TEXT, message TEXT NOT NULL, phone TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','canceled')),
  sent_at TIMESTAMPTZ, error TEXT, provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_sms_followups TO authenticated;
GRANT ALL ON public.client_sms_followups TO service_role;
ALTER TABLE public.client_sms_followups ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users view own followups" ON public.client_sms_followups; CREATE POLICY "Users view own followups" ON public.client_sms_followups FOR SELECT TO authenticated USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Users insert own followups" ON public.client_sms_followups; CREATE POLICY "Users insert own followups" ON public.client_sms_followups FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Users update own followups" ON public.client_sms_followups; CREATE POLICY "Users update own followups" ON public.client_sms_followups FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Users delete own followups" ON public.client_sms_followups; CREATE POLICY "Users delete own followups" ON public.client_sms_followups FOR DELETE TO authenticated USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS client_sms_followups_client_idx ON public.client_sms_followups(client_id);
CREATE INDEX IF NOT EXISTS client_sms_followups_due_idx ON public.client_sms_followups(status, scheduled_at);
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_client_sms_followups_updated ON public.client_sms_followups; CREATE TRIGGER trg_client_sms_followups_updated BEFORE UPDATE ON public.client_sms_followups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 45. SMS FOLLOWUP TEMPLATES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.sms_followup_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, message TEXT NOT NULL,
  send_hour SMALLINT NOT NULL DEFAULT 10 CHECK (send_hour BETWEEN 0 AND 23),
  send_minute SMALLINT NOT NULL DEFAULT 0 CHECK (send_minute BETWEEN 0 AND 59),
  days_after_inactivity SMALLINT NOT NULL DEFAULT 1 CHECK (days_after_inactivity BETWEEN 0 AND 30),
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_followup_templates TO authenticated;
GRANT ALL ON public.sms_followup_templates TO service_role;
ALTER TABLE public.sms_followup_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users manage own sms templates" ON public.sms_followup_templates; CREATE POLICY "Users manage own sms templates" ON public.sms_followup_templates FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_sms_followup_templates_user_active ON public.sms_followup_templates(user_id, active);
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_sms_followup_templates_updated_at ON public.sms_followup_templates; CREATE TRIGGER trg_sms_followup_templates_updated_at BEFORE UPDATE ON public.sms_followup_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 46. CONTRACT TEMPLATES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL, created_by UUID, name TEXT NOT NULL, description TEXT,
  body_html TEXT NOT NULL DEFAULT '', variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_pdf_path TEXT, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_templates TO authenticated;
GRANT ALL ON public.contract_templates TO service_role;
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "org members can read templates" ON public.contract_templates; CREATE POLICY "org members can read templates" ON public.contract_templates FOR SELECT TO authenticated USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "org members can insert templates" ON public.contract_templates; CREATE POLICY "org members can insert templates" ON public.contract_templates FOR INSERT TO authenticated WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND owner_id = public.get_org_owner(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "org members can update templates" ON public.contract_templates; CREATE POLICY "org members can update templates" ON public.contract_templates FOR UPDATE TO authenticated USING (public.is_org_member(owner_id, auth.uid())) WITH CHECK (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "owner can delete templates" ON public.contract_templates; CREATE POLICY "owner can delete templates" ON public.contract_templates FOR DELETE TO authenticated USING (owner_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_contract_templates_updated_at ON public.contract_templates; CREATE TRIGGER trg_contract_templates_updated_at BEFORE UPDATE ON public.contract_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 47. CONTRACTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL, created_by UUID NOT NULL,
  card_id UUID REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL, message TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','signed','rejected','expired','cancelled')),
  autentique_document_id TEXT UNIQUE, autentique_public_id TEXT,
  file_url TEXT, signed_file_url TEXT,
  sent_at TIMESTAMPTZ, signed_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
  contract_code TEXT UNIQUE, template_id UUID REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  responsible_agent_id UUID, values JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_method TEXT, integrity_score INTEGER, integrity_report JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can view contracts" ON public.contracts; CREATE POLICY "Org members can view contracts" ON public.contracts FOR SELECT TO authenticated USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can insert contracts" ON public.contracts; CREATE POLICY "Org members can insert contracts" ON public.contracts FOR INSERT TO authenticated WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND created_by = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can update contracts" ON public.contracts; CREATE POLICY "Org members can update contracts" ON public.contracts FOR UPDATE TO authenticated USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Owner can delete contracts" ON public.contracts; CREATE POLICY "Owner can delete contracts" ON public.contracts FOR DELETE TO authenticated USING (owner_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS contracts_owner_idx ON public.contracts(owner_id);
CREATE INDEX IF NOT EXISTS contracts_card_idx ON public.contracts(card_id);
CREATE INDEX IF NOT EXISTS contracts_client_idx ON public.contracts(client_id);
CREATE INDEX IF NOT EXISTS contracts_autentique_doc_idx ON public.contracts(autentique_document_id);
DO $$ BEGIN DROP TRIGGER IF EXISTS update_contracts_updated_at ON public.contracts; CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SEQUENCE IF NOT EXISTS public.contract_code_seq;
CREATE OR REPLACE FUNCTION public.assign_contract_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN IF NEW.contract_code IS NULL OR NEW.contract_code = '' THEN
  NEW.contract_code := 'CTR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.contract_code_seq')::text, 6, '0');
END IF; RETURN NEW; END; $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_contracts_assign_code ON public.contracts; CREATE TRIGGER trg_contracts_assign_code BEFORE INSERT ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.assign_contract_code(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 48. CONTRACT SIGNERS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.contract_signers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
  action TEXT NOT NULL DEFAULT 'sign' CHECK (action IN ('sign','approve','acknowledge','witness')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','viewed','signed','rejected')),
  autentique_signer_id TEXT, signing_url TEXT, viewed_at TIMESTAMPTZ, signed_at TIMESTAMPTZ,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_signers TO authenticated;
GRANT ALL ON public.contract_signers TO service_role;
ALTER TABLE public.contract_signers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can view signers" ON public.contract_signers; CREATE POLICY "Org members can view signers" ON public.contract_signers FOR SELECT TO authenticated USING (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can manage signers" ON public.contract_signers; CREATE POLICY "Org members can manage signers" ON public.contract_signers FOR ALL TO authenticated USING (public.is_org_member(owner_id, auth.uid())) WITH CHECK (public.is_org_member(owner_id, auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS contract_signers_contract_idx ON public.contract_signers(contract_id);
CREATE INDEX IF NOT EXISTS contract_signers_email_idx ON public.contract_signers(email);
DO $$ BEGIN DROP TRIGGER IF EXISTS update_contract_signers_updated_at ON public.contract_signers; CREATE TRIGGER update_contract_signers_updated_at BEFORE UPDATE ON public.contract_signers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 49. CONTRACT EVENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.contract_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
  autentique_document_id TEXT, event_type TEXT NOT NULL,
  signer_email TEXT, dedupe_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.contract_events TO authenticated;
GRANT ALL ON public.contract_events TO service_role;
ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Org members can view events of their contracts" ON public.contract_events; CREATE POLICY "Org members can view events of their contracts" ON public.contract_events FOR SELECT TO authenticated USING (contract_id IS NULL OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_events.contract_id AND public.is_org_member(c.owner_id, auth.uid()))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS contract_events_contract_idx ON public.contract_events(contract_id);
CREATE INDEX IF NOT EXISTS contract_events_doc_idx ON public.contract_events(autentique_document_id);
CREATE UNIQUE INDEX IF NOT EXISTS contract_events_dedupe_key_uidx ON public.contract_events(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- =============================================================
-- 50. CONTRACT REMINDERS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.contract_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  channel TEXT NOT NULL DEFAULT 'whatsapp', sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, level)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_reminders TO authenticated;
GRANT ALL ON public.contract_reminders TO service_role;
ALTER TABLE public.contract_reminders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "org members can read reminders" ON public.contract_reminders; CREATE POLICY "org members can read reminders" ON public.contract_reminders FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_id AND public.is_org_member(c.owner_id, auth.uid()))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "service role manages reminders" ON public.contract_reminders; CREATE POLICY "service role manages reminders" ON public.contract_reminders FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 51. EDUARDO CONTRACT REVIEWS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.eduardo_contract_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  card_id UUID REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  draft_sent_at TIMESTAMPTZ, draft_message TEXT, approved_at TIMESTAMPTZ,
  handed_off_at TIMESTAMPTZ, handoff_note TEXT, created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eduardo_contract_reviews TO authenticated;
GRANT ALL ON public.eduardo_contract_reviews TO service_role;
ALTER TABLE public.eduardo_contract_reviews ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "eduardo_reviews_owner_all" ON public.eduardo_contract_reviews; CREATE POLICY "eduardo_reviews_owner_all" ON public.eduardo_contract_reviews FOR ALL TO authenticated USING (owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid())) WITH CHECK (owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_eduardo_reviews_contract ON public.eduardo_contract_reviews(contract_id);
CREATE INDEX IF NOT EXISTS idx_eduardo_reviews_owner ON public.eduardo_contract_reviews(owner_id);
DO $$ BEGIN DROP TRIGGER IF EXISTS eduardo_reviews_updated_at ON public.eduardo_contract_reviews; CREATE TRIGGER eduardo_reviews_updated_at BEFORE UPDATE ON public.eduardo_contract_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 52. IMPORT EVENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.import_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL, result JSONB, error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_events TO authenticated;
GRANT ALL ON public.import_events TO service_role;
ALTER TABLE public.import_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users read own import events" ON public.import_events; CREATE POLICY "Users read own import events" ON public.import_events FOR SELECT TO authenticated USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_import_events_user_created ON public.import_events(user_id, created_at DESC);

-- =============================================================
-- 53. CRM CHAT READS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.crm_chat_reads (
  user_id UUID NOT NULL, chat_id TEXT NOT NULL, owner_id UUID NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_chat_reads TO authenticated;
GRANT ALL ON public.crm_chat_reads TO service_role;
ALTER TABLE public.crm_chat_reads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Users manage own read markers" ON public.crm_chat_reads; CREATE POLICY "Users manage own read markers" ON public.crm_chat_reads FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_crm_chat_reads_owner_chat ON public.crm_chat_reads(owner_id, chat_id);
DO $$ BEGIN DROP TRIGGER IF EXISTS update_crm_chat_reads_updated_at ON public.crm_chat_reads; CREATE TRIGGER update_crm_chat_reads_updated_at BEFORE UPDATE ON public.crm_chat_reads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 54. CRM AGENT RATINGS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.crm_agent_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL, chat_id TEXT NOT NULL, agent_key TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5), raw_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_agent_ratings TO authenticated;
GRANT ALL ON public.crm_agent_ratings TO service_role;
ALTER TABLE public.crm_agent_ratings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "owner reads own ratings" ON public.crm_agent_ratings; CREATE POLICY "owner reads own ratings" ON public.crm_agent_ratings FOR SELECT TO authenticated USING (owner_id = public.get_org_owner(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "service manages ratings" ON public.crm_agent_ratings; CREATE POLICY "service manages ratings" ON public.crm_agent_ratings FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS crm_agent_ratings_owner_created_idx ON public.crm_agent_ratings(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_agent_ratings_owner_agent_idx ON public.crm_agent_ratings(owner_id, agent_key, created_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_agent_ratings; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 55. CRM CHAT SURVEYS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.crm_chat_surveys (
  owner_id UUID NOT NULL, chat_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ, answered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_chat_surveys TO authenticated;
GRANT ALL ON public.crm_chat_surveys TO service_role;
ALTER TABLE public.crm_chat_surveys ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "owner reads own surveys" ON public.crm_chat_surveys; CREATE POLICY "owner reads own surveys" ON public.crm_chat_surveys FOR SELECT TO authenticated USING (owner_id = public.get_org_owner(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "service manages surveys" ON public.crm_chat_surveys; CREATE POLICY "service manages surveys" ON public.crm_chat_surveys FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_crm_chat_surveys_updated ON public.crm_chat_surveys; CREATE TRIGGER trg_crm_chat_surveys_updated BEFORE UPDATE ON public.crm_chat_surveys FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_chat_surveys; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 56. EMAIL SEND LOG
-- =============================================================
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), message_id TEXT,
  template_name TEXT NOT NULL, recipient_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','suppressed','failed','bounced','complained','dlq')),
  error_message TEXT, metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.email_send_log TO service_role;
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can read send log" ON public.email_send_log; CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can insert send log" ON public.email_send_log; CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT WITH CHECK (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can update send log" ON public.email_send_log; CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_email_send_log_created ON public.email_send_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_send_log_recipient ON public.email_send_log(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_send_log_message ON public.email_send_log(message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_message_sent_unique ON public.email_send_log(message_id) WHERE status = 'sent';

-- =============================================================
-- 57. EMAIL SEND STATE
-- =============================================================
CREATE TABLE IF NOT EXISTS public.email_send_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), retry_after_until TIMESTAMPTZ,
  batch_size INTEGER NOT NULL DEFAULT 10, send_delay_ms INTEGER NOT NULL DEFAULT 200,
  auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15,
  transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT ALL ON public.email_send_state TO service_role;
ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can manage send state" ON public.email_send_state; CREATE POLICY "Service role can manage send state" ON public.email_send_state FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 58. SUPPRESSED EMAILS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe','bounce','complaint')),
  metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(email)
);
GRANT ALL ON public.suppressed_emails TO service_role;
ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can read suppressed emails" ON public.suppressed_emails; CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails; CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT WITH CHECK (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_suppressed_emails_email ON public.suppressed_emails(email);

-- =============================================================
-- 59. EMAIL UNSUBSCRIBE TOKENS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), used_at TIMESTAMPTZ
);
GRANT ALL ON public.email_unsubscribe_tokens TO service_role;
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can read tokens" ON public.email_unsubscribe_tokens; CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can insert tokens" ON public.email_unsubscribe_tokens; CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT WITH CHECK (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role can mark tokens as used" ON public.email_unsubscribe_tokens; CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens(token);

-- =============================================================
-- EMAIL QUEUE RPCs
-- =============================================================
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name TEXT, payload JSONB)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN PERFORM pgmq.create(queue_name); RETURN pgmq.send(queue_name, payload); END; $$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name TEXT, batch_size INT, vt INT)
RETURNS TABLE(msg_id BIGINT, read_ct INT, message JSONB) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN PERFORM pgmq.create(queue_name); RETURN; END; $$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name TEXT, message_id BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN RETURN FALSE; END; $$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE new_id BIGINT; BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id; PERFORM pgmq.delete(source_queue, message_id); RETURN new_id;
EXCEPTION WHEN undefined_table THEN BEGIN PERFORM pgmq.create(dlq_name); EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id; RETURN new_id; END; $$;

REVOKE ALL ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.read_email_batch(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) TO service_role;
REVOKE ALL ON FUNCTION public.delete_email(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) TO service_role;
REVOKE ALL ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) TO service_role;

-- =============================================================
-- INVITE FUNCTIONS
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_invite_public(_token text)
RETURNS TABLE(valid boolean, reason text, email text, role text, inviter_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; owner_row record; is_uuid boolean; BEGIN
  is_uuid := _token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF is_uuid THEN SELECT * INTO inv FROM public.invites WHERE token::text = _token LIMIT 1;
  ELSE SELECT * INTO inv FROM public.invites WHERE slug = _token LIMIT 1; END IF;
  IF inv.id IS NULL THEN RETURN QUERY SELECT false, 'not_found'::text, ''::text, ''::text, ''::text; RETURN; END IF;
  IF inv.revoked_at IS NOT NULL THEN RETURN QUERY SELECT false, 'revoked'::text, ''::text, ''::text, ''::text; RETURN; END IF;
  IF inv.used_at IS NOT NULL THEN RETURN QUERY SELECT false, 'used'::text, ''::text, ''::text, ''::text; RETURN; END IF;
  IF inv.expires_at < now() THEN RETURN QUERY SELECT false, 'expired'::text, ''::text, ''::text, ''::text; RETURN; END IF;
  SELECT full_name, email INTO owner_row FROM public.profiles WHERE id = inv.owner_id LIMIT 1;
  RETURN QUERY SELECT true, ''::text, COALESCE(inv.email, ''), inv.role::text, COALESCE(owner_row.full_name, owner_row.email, 'sua equipe');
END; $$;
REVOKE ALL ON FUNCTION public.get_invite_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_public(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_invite_access(_token text, _full_name text, _email text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; is_uuid boolean; new_id uuid; BEGIN
  IF _full_name IS NULL OR length(trim(_full_name)) < 2 THEN RAISE EXCEPTION 'Informe seu nome'; END IF;
  is_uuid := _token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF is_uuid THEN SELECT i.* INTO inv FROM public.invites i WHERE i.token::text = _token LIMIT 1;
  ELSE SELECT i.* INTO inv FROM public.invites i WHERE i.slug = _token LIMIT 1; END IF;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Convite invalido'; END IF;
  IF inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Convite revogado'; END IF;
  IF inv.used_at IS NOT NULL THEN RAISE EXCEPTION 'Convite ja utilizado'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'Convite expirado'; END IF;
  INSERT INTO public.invite_access_requests (invite_id, owner_id, token_used, full_name, email, status)
  VALUES (inv.id, inv.owner_id, _token, trim(_full_name), NULLIF(trim(COALESCE(_email, '')), ''), 'pending')
  RETURNING id INTO new_id; RETURN new_id; END; $$;
REVOKE ALL ON FUNCTION public.request_invite_access(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_invite_access(text, text, text) TO anon, authenticated, service_role;

-- =============================================================
-- STORAGE BUCKETS + POLICIES
-- =============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('crm-media', 'crm-media', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('contract-templates', 'contract-templates', false) ON CONFLICT DO NOTHING;

DO $$ BEGIN DROP POLICY IF EXISTS "crm-media owner read" ON storage.objects; CREATE POLICY "crm-media owner read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "crm-media owner insert" ON storage.objects; CREATE POLICY "crm-media owner insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "crm-media owner update" ON storage.objects; CREATE POLICY "crm-media owner update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "crm-media owner delete" ON storage.objects; CREATE POLICY "crm-media owner delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "contract-templates owner read" ON storage.objects; CREATE POLICY "contract-templates owner read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "contract-templates owner insert" ON storage.objects; CREATE POLICY "contract-templates owner insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "contract-templates owner update" ON storage.objects; CREATE POLICY "contract-templates owner update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "contract-templates owner delete" ON storage.objects; CREATE POLICY "contract-templates owner delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- AUTO-PAUSE TRIGGER
-- =============================================================
CREATE OR REPLACE FUNCTION public.auto_pause_chatbot_on_human_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'outbound' AND NEW.sender = 'operator' THEN
    INSERT INTO public.crm_paused_chats (user_id, chat_id, paused_by)
    VALUES (NEW.user_id, NEW.chat_id, 'operator')
    ON CONFLICT (user_id, chat_id) DO UPDATE SET paused_by = 'operator', created_at = now();
  END IF; RETURN NEW; END; $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_auto_pause_on_human ON public.crm_messages; CREATE TRIGGER trg_auto_pause_on_human AFTER INSERT ON public.crm_messages FOR EACH ROW EXECUTE FUNCTION public.auto_pause_chatbot_on_human_message(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- SEED FUNCTIONS
-- =============================================================
CREATE OR REPLACE FUNCTION public.seed_kanban_defaults(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kanban_columns WHERE user_id = _user_id) THEN RETURN; END IF;
  INSERT INTO public.kanban_columns (user_id, name, position, color, icon, rule_prompt, auto_action, is_default) VALUES
    (_user_id, 'Primeiro Atendimento', 0, '#a78bfa', 'Inbox', 'Novo lead.', NULL, true),
    (_user_id, 'Interesse', 1, '#8b5cf6', 'Sparkles', 'Interesse demostrado.', NULL, true),
    (_user_id, 'Call/Meet', 2, '#7c3aed', 'Video', 'Reuniao aceita.', 'schedule_meeting', true),
    (_user_id, 'Falar c/ Especialista', 3, '#6d28d9', 'UserCheck', 'Especialista assume.', 'assign_specialist', true),
    (_user_id, 'Envio de Documentos', 4, '#5b21b6', 'FileUp', 'Solicitar docs.', 'request_documents', true),
    (_user_id, 'Analise IA', 5, '#4c1d95', 'ScanSearch', 'Analise de docs.', 'analyze_document', true),
    (_user_id, 'Contrato', 6, '#8b5cf6', 'FileSignature', 'Finalizar contrato.', NULL, true),
    (_user_id, 'Fechado', 7, '#22c55e', 'CheckCircle2', 'Cliente assinado.', NULL, true);
  INSERT INTO public.kanban_tags (user_id, name, color) VALUES
    (_user_id, 'urgente', '#ef4444'), (_user_id, 'VIP', '#f59e0b'),
    (_user_id, 'trabalhista', '#8b5cf6'), (_user_id, 'civel', '#3b82f6'), (_user_id, 'familia', '#ec4899')
  ON CONFLICT (user_id, name) DO NOTHING; END; $$;

CREATE OR REPLACE FUNCTION public.seed_legal_area_templates(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.legal_area_templates WHERE user_id = _user_id) THEN RETURN; END IF;
  INSERT INTO public.legal_area_templates (user_id, area, document_name, required, position) VALUES
    (_user_id,'trabalhista','RG e CPF',true,0),(_user_id,'trabalhista','Comprovante de residencia',true,1),
    (_user_id,'trabalhista','CTPS',true,2),(_user_id,'trabalhista','Ultimos 6 holerites',true,3),
    (_user_id,'trabalhista','Contrato de trabalho',false,4),(_user_id,'trabalhista','Aviso previo',false,5),
    (_user_id,'trabalhista','Extrato do FGTS',false,6),
    (_user_id,'civel','RG e CPF',true,0),(_user_id,'civel','Comprovante de residencia',true,1),
    (_user_id,'civel','Contrato objeto da acao',true,2),(_user_id,'civel','Comprovantes de pagamento',false,3),
    (_user_id,'civel','Provas (fotos, e-mails)',false,4),
    (_user_id,'familia','RG e CPF',true,0),(_user_id,'familia','Certidao de casamento',true,1),
    (_user_id,'familia','Certidoes dos filhos',false,2),(_user_id,'familia','Comprovantes de renda',true,3),
    (_user_id,'familia','Comprovantes de bens',false,4),
    (_user_id,'previdenciario','RG e CPF',true,0),(_user_id,'previdenciario','CNIS',true,1),
    (_user_id,'previdenciario','CTPS',true,2),(_user_id,'previdenciario','Carneis de contribuicao',false,3),
    (_user_id,'previdenciario','Laudos medicos',false,4),
    (_user_id,'criminal','RG e CPF',true,0),(_user_id,'criminal','Boletim de ocorrencia',true,1),
    (_user_id,'criminal','Copia do processo',false,2),
    (_user_id,'consumidor','RG e CPF',true,0),(_user_id,'consumidor','Nota fiscal / contrato',true,1),
    (_user_id,'consumidor','Protocolos de reclamacao',true,2),(_user_id,'consumidor','Prints / e-mails',false,3),
    (_user_id,'tributario','CNPJ / contrato social',true,0),(_user_id,'tributario','Auto de infracao / CDA',true,1),
    (_user_id,'tributario','Guias e comprovantes',false,2),
    (_user_id,'empresarial','Contrato social',true,0),(_user_id,'empresarial','Faturamento 12 meses',false,1),
    (_user_id,'empresarial','Contratos objeto da questao',true,2)
  ON CONFLICT (user_id, area, document_name) DO NOTHING; END; $$;

-- =============================================================
-- handle_new_user TRIGGER
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);
  RETURN NEW; END; $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users; CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- REPLICA IDENTITY FULL (necessario para Supabase Realtime)
-- =============================================================
ALTER TABLE public.crm_messages REPLICA IDENTITY FULL;
ALTER TABLE public.crm_paused_chats REPLICA IDENTITY FULL;
ALTER TABLE public.clients REPLICA IDENTITY FULL;
ALTER TABLE public.cases REPLICA IDENTITY FULL;
ALTER TABLE public.appointments REPLICA IDENTITY FULL;
ALTER TABLE public.documents REPLICA IDENTITY FULL;
ALTER TABLE public.knowledge_base_documents REPLICA IDENTITY FULL;
ALTER TABLE public.chat_assignments REPLICA IDENTITY FULL;

-- =============================================================
-- INDEXES ADICIONAIS
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_clients_followup_queue ON public.clients(followup_status, followup_queued_at) WHERE followup_status = 'queued';

-- =============================================================
-- COLUNAS ADICIONAIS (ADD COLUMN IF NOT EXISTS para tabelas existentes)
-- =============================================================
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS google_event_id text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS google_event_link text;

-- =============================================================
-- CRON: wapi-media-retry (executa a cada 1 minuto)
-- Requer vault secret 'wapi_webhook_secret' configurado.
-- Ajuste a URL conforme seu dominio de producao.
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wapi-media-retry') THEN
    PERFORM cron.schedule(
      'wapi-media-retry',
      '* * * * *',
      $q$SELECT net.http_post(
        url := current_setting('app.settings.base_url', true) || '/api/public/wapi-media-retry?secret=' || vault.get_secret('wapi_webhook_secret'),
        headers := '{"Content-Type":"application/json"}'::jsonb
      )$q$
    );
  END IF;
END $$;

-- FIM
