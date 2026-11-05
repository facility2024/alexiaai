-- =====================================================================
-- SCHEMA COMPLETO - consolidado das 74 migrations (ordem cronologica)
-- Gerado de supabase/migrations/*.sql — rode no SQL Editor de um projeto NOVO
-- =====================================================================

-- ---------------------------------------------------------------------
-- FILE: 20260614142753_e2df2906-f9e1-4e9f-a4c0-af6c6376b6cd.sql
-- ---------------------------------------------------------------------

-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'specialist');
CREATE TYPE public.case_status AS ENUM ('triage', 'analysis', 'scheduling', 'scheduled', 'closed', 'cancelled');
CREATE TYPE public.agent_type AS ENUM ('agent_1', 'agent_2', 'agent_3');
CREATE TYPE public.message_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE public.document_status AS ENUM ('pending', 'processing', 'processed', 'failed');

-- =========================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =========================================================
-- PROFILES (advogados/especialistas autenticados)
-- =========================================================
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto criar perfil ao registrar usuário
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- USER ROLES + has_role (padrão recomendado)
-- =========================================================
CREATE TABLE public.user_roles (
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
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- CLIENTS (atendidos - acesso anônimo via token)
-- =========================================================
CREATE TABLE public.clients (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  full_name TEXT,
  cpf TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all clients"
  ON public.clients FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));
CREATE POLICY "Staff can update clients"
  ON public.clients FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- CASES
-- =========================================================
CREATE TABLE public.cases (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status public.case_status NOT NULL DEFAULT 'triage',
  current_agent public.agent_type NOT NULL DEFAULT 'agent_1',
  case_type TEXT,
  classification TEXT,
  summary TEXT,
  assigned_specialist_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;
GRANT ALL ON public.cases TO service_role;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all cases"
  ON public.cases FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));
CREATE POLICY "Staff can update cases"
  ON public.cases FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));

CREATE INDEX idx_cases_client_id ON public.cases(client_id);
CREATE INDEX idx_cases_status ON public.cases(status);

CREATE TRIGGER trg_cases_updated_at
  BEFORE UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- MESSAGES (histórico de chat com agentes)
-- =========================================================
CREATE TABLE public.messages (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  agent public.agent_type NOT NULL,
  role public.message_role NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all messages"
  ON public.messages FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));

CREATE INDEX idx_messages_case_id ON public.messages(case_id, created_at);

-- =========================================================
-- DOCUMENTS
-- =========================================================
CREATE TABLE public.documents (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  document_type TEXT,
  extracted_text TEXT,
  status public.document_status NOT NULL DEFAULT 'pending',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));

CREATE INDEX idx_documents_case_id ON public.documents(case_id);

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- REQUIRED DOCUMENTS (checklist por caso)
-- =========================================================
CREATE TABLE public.required_documents (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  received BOOLEAN NOT NULL DEFAULT FALSE,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.required_documents TO authenticated;
GRANT ALL ON public.required_documents TO service_role;
ALTER TABLE public.required_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all required_documents"
  ON public.required_documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));

CREATE INDEX idx_required_documents_case_id ON public.required_documents(case_id);

-- =========================================================
-- CASE ANALYSIS (Agente 2)
-- =========================================================
CREATE TABLE public.case_analysis (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL UNIQUE REFERENCES public.cases(id) ON DELETE CASCADE,
  legal_summary TEXT,
  suggested_strategy TEXT,
  risks TEXT,
  opportunities TEXT,
  viability_score INT CHECK (viability_score BETWEEN 0 AND 100),
  pending_items TEXT,
  knowledge_refs JSONB DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_analysis TO authenticated;
GRANT ALL ON public.case_analysis TO service_role;
ALTER TABLE public.case_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all analysis"
  ON public.case_analysis FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));

CREATE TRIGGER trg_case_analysis_updated_at
  BEFORE UPDATE ON public.case_analysis
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- APPOINTMENTS (Agente 3)
-- =========================================================
CREATE TABLE public.appointments (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  specialist_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  meeting_link TEXT,
  calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all appointments"
  ON public.appointments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));
CREATE POLICY "Staff can manage appointments"
  ON public.appointments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- KNOWLEDGE BASE
-- =========================================================
CREATE TABLE public.knowledge_base (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_base TO authenticated;
GRANT ALL ON public.knowledge_base TO service_role;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view knowledge"
  ON public.knowledge_base FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));
CREATE POLICY "Admins manage knowledge"
  ON public.knowledge_base FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_knowledge_base_updated_at
  BEFORE UPDATE ON public.knowledge_base
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- AGENT HANDOFFS (log de transferências)
-- =========================================================
CREATE TABLE public.agent_handoffs (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  from_agent public.agent_type NOT NULL,
  to_agent public.agent_type NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_handoffs TO authenticated;
GRANT ALL ON public.agent_handoffs TO service_role;
ALTER TABLE public.agent_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view handoffs"
  ON public.agent_handoffs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'));

CREATE INDEX idx_agent_handoffs_case_id ON public.agent_handoffs(case_id);

-- ---------------------------------------------------------------------
-- FILE: 20260614142813_eff2e7c4-94ca-44fc-ae2a-a3a7b044e621.sql
-- ---------------------------------------------------------------------

-- Restringir SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Storage policies para bucket case-documents
CREATE POLICY "Staff can read case documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'case-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'))
  );

CREATE POLICY "Staff can upload case documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'case-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'))
  );

CREATE POLICY "Staff can delete case documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'case-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'))
  );

-- ---------------------------------------------------------------------
-- FILE: 20260614175049_3d7c16f0-fa10-455d-b38d-3f26777900d5.sql
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- ---------------------------------------------------------------------
-- FILE: 20260614175059_7d426a43-c14b-4c88-9f91-da2fffc8eb2a.sql
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
-- ---------------------------------------------------------------------
-- FILE: 20260614182028_542a06d8-f25f-4ae3-8882-1bc6155bd003.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  system_prompt text,
  temperature numeric DEFAULT 0.7,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ai_settings"
ON public.ai_settings FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_ai_settings_updated_at
BEFORE UPDATE ON public.ai_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ---------------------------------------------------------------------
-- FILE: 20260614185417_0adbd54b-8e6c-44d6-a1f8-d6be882aaa8a.sql
-- ---------------------------------------------------------------------

CREATE TABLE public.whatsapp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  instance_id text NOT NULL,
  api_token text NOT NULL,
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected',
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_settings TO authenticated;
GRANT ALL ON public.whatsapp_settings TO service_role;

ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own whatsapp settings"
  ON public.whatsapp_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_whatsapp_settings_updated_at
  BEFORE UPDATE ON public.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- FILE: 20260614193729_660d06ff-5e77-423c-be08-f35a065ca80a.sql
-- ---------------------------------------------------------------------

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- 1) Rename whatsapp_settings -> wapi_config + new columns
ALTER TABLE public.whatsapp_settings RENAME TO wapi_config;
ALTER TABLE public.wapi_config ADD COLUMN IF NOT EXISTS webhook_url TEXT;
ALTER TABLE public.wapi_config ADD COLUMN IF NOT EXISTS is_connected BOOLEAN NOT NULL DEFAULT false;

-- 2) CRM messages
CREATE TABLE public.crm_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender TEXT NOT NULL CHECK (sender IN ('contact','bot','operator','system')),
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image','audio','video','document')),
  content TEXT,
  media_url TEXT,
  transcription TEXT,
  wapi_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_messages TO authenticated;
GRANT ALL ON public.crm_messages TO service_role;
ALTER TABLE public.crm_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own crm_messages" ON public.crm_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_crm_messages_user_chat ON public.crm_messages(user_id, chat_id, created_at DESC);

-- 3) Paused chats
CREATE TABLE public.crm_paused_chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  paused_by TEXT NOT NULL CHECK (paused_by IN ('user','operator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_paused_chats TO authenticated;
GRANT ALL ON public.crm_paused_chats TO service_role;
ALTER TABLE public.crm_paused_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own paused chats" ON public.crm_paused_chats FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4) AI personality
CREATE TABLE public.ai_personality (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  persona TEXT,
  tone TEXT,
  rules TEXT,
  use_knowledge_base BOOLEAN NOT NULL DEFAULT true,
  max_chars_per_chunk INT NOT NULL DEFAULT 250,
  typing_delay_ms INT NOT NULL DEFAULT 25000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_personality TO authenticated;
GRANT ALL ON public.ai_personality TO service_role;
ALTER TABLE public.ai_personality ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own personality" ON public.ai_personality FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_ai_personality_updated BEFORE UPDATE ON public.ai_personality FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Knowledge base documents + chunks
CREATE TABLE public.knowledge_base_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'text',
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_base_documents TO authenticated;
GRANT ALL ON public.knowledge_base_documents TO service_role;
ALTER TABLE public.knowledge_base_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own kb docs" ON public.knowledge_base_documents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_kb_docs_updated BEFORE UPDATE ON public.knowledge_base_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.knowledge_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.knowledge_base_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536),
  chunk_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own kb chunks" ON public.knowledge_chunks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_kb_chunks_embedding ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 6) Flows
CREATE TABLE public.flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  definition JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows TO authenticated;
GRANT ALL ON public.flows TO service_role;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own flows" ON public.flows FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_flows_updated BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.flow_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flow_id UUID REFERENCES public.flows(id) ON DELETE SET NULL,
  chat_id TEXT NOT NULL,
  current_node_id TEXT,
  session_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_conversations TO authenticated;
GRANT ALL ON public.flow_conversations TO service_role;
ALTER TABLE public.flow_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own flow conversations" ON public.flow_conversations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_flow_conv_updated BEFORE UPDATE ON public.flow_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7) RAG match function
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  _user_id UUID,
  query_embedding vector(1536),
  match_count INT DEFAULT 5
)
RETURNS TABLE (id UUID, document_id UUID, content TEXT, similarity FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT kc.id, kc.document_id, kc.content,
         1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.user_id = _user_id AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 8) Auto-pause trigger: when operator sends an outbound message, pause the bot
CREATE OR REPLACE FUNCTION public.auto_pause_chatbot_on_human_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'outbound' AND NEW.sender = 'operator' THEN
    INSERT INTO public.crm_paused_chats (user_id, chat_id, paused_by)
    VALUES (NEW.user_id, NEW.chat_id, 'operator')
    ON CONFLICT (user_id, chat_id) DO UPDATE SET paused_by = 'operator', created_at = now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_auto_pause_on_human
AFTER INSERT ON public.crm_messages
FOR EACH ROW EXECUTE FUNCTION public.auto_pause_chatbot_on_human_message();

-- ---------------------------------------------------------------------
-- FILE: 20260614195851_6feedf39-3738-4015-811f-801cf6376300.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.ai_settings 
  ADD COLUMN IF NOT EXISTS api_key text,
  ADD COLUMN IF NOT EXISTS base_url text;
-- ---------------------------------------------------------------------
-- FILE: 20260614200328_76843984-938b-496c-be9f-38ea4a928ab9.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS openai_key text,
  ADD COLUMN IF NOT EXISTS gemini_key text,
  ADD COLUMN IF NOT EXISTS inworld_key text;
-- ---------------------------------------------------------------------
-- FILE: 20260709062424_644c7334-807f-4970-a253-8fc71bfa425a.sql
-- ---------------------------------------------------------------------

UPDATE public.crm_messages
SET content = COALESCE(
  raw->'msgContent'->>'conversation',
  raw->'msgContent'->'extendedTextMessage'->>'text',
  raw->'msgContent'->'encodedTextMessage'->>'text',
  raw->'msgContent'->'imageMessage'->>'caption',
  raw->'msgContent'->'videoMessage'->>'caption',
  raw->'msgContent'->'documentMessage'->>'caption',
  raw->'msgContent'->'buttonsResponseMessage'->>'selectedDisplayText',
  raw->'msgContent'->'listResponseMessage'->>'title',
  raw->>'text',
  raw->>'body',
  raw->'message'->>'text',
  raw->>'conversation'
)
WHERE content IS NULL
  AND raw IS NOT NULL;

-- ---------------------------------------------------------------------
-- FILE: 20260709074916_659bf413-f233-4b30-b4c6-3f25563ceef0.sql
-- ---------------------------------------------------------------------

-- =========================================================
-- Kanban Inteligente
-- =========================================================

-- 1) COLUNAS
CREATE TABLE public.kanban_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#8b5cf6',
  icon text NOT NULL DEFAULT 'Circle',
  rule_prompt text,
  auto_action text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_columns TO authenticated;
GRANT ALL ON public.kanban_columns TO service_role;
ALTER TABLE public.kanban_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_columns" ON public.kanban_columns
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_kanban_columns_user ON public.kanban_columns(user_id, position);

-- 2) TAGS
CREATE TABLE public.kanban_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8b5cf6',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_tags TO authenticated;
GRANT ALL ON public.kanban_tags TO service_role;
ALTER TABLE public.kanban_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_tags" ON public.kanban_tags
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3) CARDS (1 por chat)
CREATE TABLE public.kanban_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES public.kanban_columns(id) ON DELETE RESTRICT,
  chat_id text NOT NULL,
  contact_name text,
  contact_phone text,
  tag_ids uuid[] NOT NULL DEFAULT '{}',
  assignee text,
  estimated_value numeric(12,2),
  summary text,
  position integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  ai_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_cards TO authenticated;
GRANT ALL ON public.kanban_cards TO service_role;
ALTER TABLE public.kanban_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_cards" ON public.kanban_cards
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_kanban_cards_col ON public.kanban_cards(user_id, column_id, position);

-- 4) EVENTOS / HISTÓRICO
CREATE TABLE public.kanban_card_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.kanban_cards(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- moved | tag_added | tag_removed | ai_decision | note | auto_action
  from_column_id uuid,
  to_column_id uuid,
  actor text NOT NULL DEFAULT 'user', -- user | ai | system
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_card_events TO authenticated;
GRANT ALL ON public.kanban_card_events TO service_role;
ALTER TABLE public.kanban_card_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_card_events" ON public.kanban_card_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_kanban_events_card ON public.kanban_card_events(card_id, created_at DESC);

-- 5) CHECKLIST DE DOCUMENTOS
CREATE TABLE public.kanban_doc_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_type text NOT NULL DEFAULT 'geral',
  document_name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_doc_checklist TO authenticated;
GRANT ALL ON public.kanban_doc_checklist TO service_role;
ALTER TABLE public.kanban_doc_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_doc_checklist" ON public.kanban_doc_checklist
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6) TRIGGERS updated_at
CREATE TRIGGER trg_kanban_columns_updated BEFORE UPDATE ON public.kanban_columns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_kanban_cards_updated BEFORE UPDATE ON public.kanban_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7) SEED de colunas padrão para novos usuários (e existentes)
CREATE OR REPLACE FUNCTION public.seed_kanban_defaults(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kanban_columns WHERE user_id = _user_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.kanban_columns (user_id, name, position, color, icon, rule_prompt, auto_action, is_default) VALUES
    (_user_id, 'Primeiro Atendimento', 0, '#a78bfa', 'Inbox',        'Novo lead que acabou de chamar; ainda não demonstrou interesse claro.', NULL, true),
    (_user_id, 'Interesse',            1, '#8b5cf6', 'Sparkles',     'Cliente demonstrou interesse no serviço, fez perguntas ou pediu detalhes.', NULL, true),
    (_user_id, 'Call/Meet',            2, '#7c3aed', 'Video',        'Cliente aceitou marcar uma reunião ou call.', 'schedule_meeting', true),
    (_user_id, 'Falar c/ Especialista',3, '#6d28d9', 'UserCheck',    'Reunião pré-agendada; especialista humano deve assumir.', 'assign_specialist', true),
    (_user_id, 'Envio de Documentos', 4, '#5b21b6', 'FileUp',       'Especialista fechou o atendimento humanizado; solicitar documentos ao cliente.', 'request_documents', true),
    (_user_id, 'Análise IA',           5, '#4c1d95', 'ScanSearch',   'Documentos recebidos; agente analisa se atende o checklist.', 'analyze_document', true),
    (_user_id, 'Contrato',             6, '#8b5cf6', 'FileSignature','Documentos ok; jurídico finaliza contrato pelo WhatsApp.', NULL, true),
    (_user_id, 'Fechado',              7, '#22c55e', 'CheckCircle2', 'Cliente assinado e onboardado.', NULL, true);

  INSERT INTO public.kanban_tags (user_id, name, color) VALUES
    (_user_id, 'urgente',      '#ef4444'),
    (_user_id, 'VIP',          '#f59e0b'),
    (_user_id, 'trabalhista',  '#8b5cf6'),
    (_user_id, 'cível',        '#3b82f6'),
    (_user_id, 'família',      '#ec4899')
  ON CONFLICT (user_id, name) DO NOTHING;
END;
$$;

-- Seed para todos os usuários existentes
DO $$
DECLARE u record;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    PERFORM public.seed_kanban_defaults(u.id);
  END LOOP;
END $$;

-- Estender handle_new_user para semear kanban ao criar conta
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  PERFORM public.seed_kanban_defaults(NEW.id);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- FILE: 20260709074932_fb9fe15a-7a27-45b9-8a82-19898d393f20.sql
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.seed_kanban_defaults(uuid) FROM PUBLIC, anon, authenticated;
-- ---------------------------------------------------------------------
-- FILE: 20260709081944_1ee5533b-9330-49ca-bb94-a62df5b30209.sql
-- ---------------------------------------------------------------------
-- 1) Extend kanban_cards with legal intelligence fields
ALTER TABLE public.kanban_cards
  ADD COLUMN IF NOT EXISTS legal_area text,
  ADD COLUMN IF NOT EXISTS urgency text CHECK (urgency IN ('baixa','media','alta','urgente')),
  ADD COLUMN IF NOT EXISTS viability_score integer CHECK (viability_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS estimated_ticket numeric(12,2),
  ADD COLUMN IF NOT EXISTS case_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS case_timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_ai_analysis_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_client_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS qualified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_kanban_cards_urgency ON public.kanban_cards(user_id, urgency);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_last_msg ON public.kanban_cards(user_id, last_client_message_at);

-- 2) Legal area checklist templates (per user, per area)
CREATE TABLE IF NOT EXISTS public.legal_area_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area text NOT NULL,
  document_name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, area, document_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_area_templates TO authenticated;
GRANT ALL ON public.legal_area_templates TO service_role;
ALTER TABLE public.legal_area_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own legal_area_templates" ON public.legal_area_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3) Per-card checklist status (documents received per lead)
CREATE TABLE IF NOT EXISTS public.kanban_card_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.kanban_cards(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  received boolean NOT NULL DEFAULT false,
  received_at timestamptz,
  notes text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_id, document_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_card_documents TO authenticated;
GRANT ALL ON public.kanban_card_documents TO service_role;
ALTER TABLE public.kanban_card_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_card_documents" ON public.kanban_card_documents
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_kanban_card_documents_updated
  BEFORE UPDATE ON public.kanban_card_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_kanban_card_documents_card ON public.kanban_card_documents(card_id);

-- 4) Seed defaults for legal area templates
CREATE OR REPLACE FUNCTION public.seed_legal_area_templates(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.legal_area_templates WHERE user_id = _user_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.legal_area_templates (user_id, area, document_name, required, position) VALUES
    -- Trabalhista
    (_user_id,'trabalhista','RG e CPF', true, 0),
    (_user_id,'trabalhista','Comprovante de residência', true, 1),
    (_user_id,'trabalhista','CTPS (carteira de trabalho)', true, 2),
    (_user_id,'trabalhista','Últimos 6 holerites', true, 3),
    (_user_id,'trabalhista','Contrato de trabalho', false, 4),
    (_user_id,'trabalhista','Aviso prévio / rescisão', false, 5),
    (_user_id,'trabalhista','Extrato do FGTS', false, 6),
    -- Cível
    (_user_id,'cível','RG e CPF', true, 0),
    (_user_id,'cível','Comprovante de residência', true, 1),
    (_user_id,'cível','Contrato objeto da ação', true, 2),
    (_user_id,'cível','Comprovantes de pagamento', false, 3),
    (_user_id,'cível','Provas (fotos, e-mails, prints)', false, 4),
    -- Família
    (_user_id,'família','RG e CPF', true, 0),
    (_user_id,'família','Certidão de casamento / união estável', true, 1),
    (_user_id,'família','Certidões dos filhos', false, 2),
    (_user_id,'família','Comprovantes de renda', true, 3),
    (_user_id,'família','Comprovantes de bens', false, 4),
    -- Previdenciário
    (_user_id,'previdenciário','RG e CPF', true, 0),
    (_user_id,'previdenciário','CNIS (extrato INSS)', true, 1),
    (_user_id,'previdenciário','CTPS', true, 2),
    (_user_id,'previdenciário','Carnês de contribuição', false, 3),
    (_user_id,'previdenciário','Laudos médicos', false, 4),
    -- Criminal
    (_user_id,'criminal','RG e CPF', true, 0),
    (_user_id,'criminal','Boletim de ocorrência', true, 1),
    (_user_id,'criminal','Cópia do processo / inquérito', false, 2),
    -- Consumidor
    (_user_id,'consumidor','RG e CPF', true, 0),
    (_user_id,'consumidor','Nota fiscal / contrato', true, 1),
    (_user_id,'consumidor','Protocolos de reclamação', true, 2),
    (_user_id,'consumidor','Prints / e-mails', false, 3),
    -- Tributário
    (_user_id,'tributário','CNPJ / contrato social', true, 0),
    (_user_id,'tributário','Auto de infração / CDA', true, 1),
    (_user_id,'tributário','Guias e comprovantes', false, 2),
    -- Empresarial
    (_user_id,'empresarial','Contrato social', true, 0),
    (_user_id,'empresarial','Faturamento dos últimos 12 meses', false, 1),
    (_user_id,'empresarial','Contratos objeto da questão', true, 2)
  ON CONFLICT (user_id, area, document_name) DO NOTHING;
END;
$$;

-- 5) Update handle_new_user to also seed legal area templates
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);
  RETURN NEW;
END;
$$;

-- 6) Backfill: seed templates for existing users who don't have any
DO $$
DECLARE u record;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    PERFORM public.seed_legal_area_templates(u.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- FILE: 20260709082003_fa3c204d-1b7d-4515-b662-3f0426bcde76.sql
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.seed_legal_area_templates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_legal_area_templates(uuid) TO service_role;
-- ---------------------------------------------------------------------
-- FILE: 20260709085922_988cf89c-e4f7-465c-ae3b-e0507e806435.sql
-- ---------------------------------------------------------------------

-- ============ Performance indexes ============
CREATE INDEX IF NOT EXISTS idx_kanban_cards_user_column_pos
  ON public.kanban_cards(user_id, column_id, position);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_user_chat
  ON public.kanban_cards(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_crm_messages_user_chat_created
  ON public.crm_messages(user_id, chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_user_created
  ON public.crm_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_events_user_card_created
  ON public.kanban_card_events(user_id, card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_user_pos
  ON public.kanban_columns(user_id, position);

-- ============ Import events (webhook log) ============
CREATE TABLE IF NOT EXISTS public.import_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_events TO authenticated;
GRANT ALL ON public.import_events TO service_role;
ALTER TABLE public.import_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own import events" ON public.import_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_import_events_user_created
  ON public.import_events(user_id, created_at DESC);

-- ============ Billings (cobranças multi-gateway) ============
CREATE TABLE IF NOT EXISTS public.billings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  gateway TEXT NOT NULL CHECK (gateway IN ('asaas','mercadopago','stripe','manual')),
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  billing_type TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  description TEXT,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  invoice_url TEXT,
  pix_code TEXT,
  bank_slip_url TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway, external_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billings TO authenticated;
GRANT ALL ON public.billings TO service_role;
ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own billings" ON public.billings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_billings_user_created
  ON public.billings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billings_user_card
  ON public.billings(user_id, card_id);
CREATE TRIGGER update_billings_updated_at
  BEFORE UPDATE ON public.billings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Payment webhook events log ============
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway TEXT NOT NULL,
  event_type TEXT,
  external_id TEXT,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.payment_webhook_events TO service_role;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
-- no user policies — only service_role writes/reads
CREATE INDEX IF NOT EXISTS idx_pwe_gateway_received
  ON public.payment_webhook_events(gateway, received_at DESC);

-- ---------------------------------------------------------------------
-- FILE: 20260709090421_3c88a3e9-72b6-4abc-9966-eae22d385d7a.sql
-- ---------------------------------------------------------------------

CREATE TABLE public.payment_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway text NOT NULL CHECK (gateway IN ('asaas','mercadopago','stripe')),
  api_key text,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production','sandbox')),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gateway)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_credentials TO authenticated;
GRANT ALL ON public.payment_credentials TO service_role;
ALTER TABLE public.payment_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own creds" ON public.payment_credentials FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER payment_credentials_updated_at BEFORE UPDATE ON public.payment_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- FILE: 20260709090707_0aa5ed1c-843f-4332-981a-c9413898e378.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.payment_credentials DROP CONSTRAINT IF EXISTS payment_credentials_gateway_check;
ALTER TABLE public.payment_credentials ADD COLUMN IF NOT EXISTS display_name text;

-- ---------------------------------------------------------------------
-- FILE: 20260709091808_c483c89b-ad0a-4b42-9c19-60d69b24acc1.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.sms_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  display_name TEXT,
  api_key TEXT NOT NULL,
  api_secret TEXT,
  sender_id TEXT,
  base_url TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_credentials TO authenticated;
GRANT ALL ON public.sms_credentials TO service_role;

ALTER TABLE public.sms_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own sms creds" ON public.sms_credentials
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_sms_credentials_updated_at
  BEFORE UPDATE ON public.sms_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ---------------------------------------------------------------------
-- FILE: 20260709092632_c2bd2704-18bc-4355-bb82-d33f075314f6.sql
-- ---------------------------------------------------------------------

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'agent';

-- ---------------------------------------------------------------------
-- FILE: 20260709092731_50b96356-f73b-414c-a4c2-d6db432962eb.sql
-- ---------------------------------------------------------------------

-- org_members
CREATE TABLE public.org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'agent',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_org_owner(_user_id UUID)
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT owner_id FROM public.org_members WHERE member_id = _user_id AND active LIMIT 1),
    _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_owner UUID, _user UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _owner = _user
    OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE owner_id = _owner AND member_id = _user AND active
    );
$$;

CREATE POLICY "org_members read" ON public.org_members
  FOR SELECT USING (owner_id = auth.uid() OR member_id = auth.uid());
CREATE POLICY "org_members owner writes" ON public.org_members
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- user_permissions
CREATE TABLE public.user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  can_view_all_chats BOOLEAN NOT NULL DEFAULT false,
  can_edit_kanban BOOLEAN NOT NULL DEFAULT true,
  can_manage_clients BOOLEAN NOT NULL DEFAULT true,
  can_manage_cases BOOLEAN NOT NULL DEFAULT true,
  can_send_billing BOOLEAN NOT NULL DEFAULT false,
  can_configure_ai BOOLEAN NOT NULL DEFAULT false,
  can_access_knowledge BOOLEAN NOT NULL DEFAULT true,
  can_manage_sectors BOOLEAN NOT NULL DEFAULT false,
  can_export BOOLEAN NOT NULL DEFAULT false,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perms owner all" ON public.user_permissions
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "perms user read" ON public.user_permissions
  FOR SELECT USING (user_id = auth.uid());

CREATE TRIGGER trg_user_permissions_updated_at
  BEFORE UPDATE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- sectors
CREATE TABLE public.sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  icon TEXT,
  color TEXT DEFAULT '#8b5cf6',
  active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sectors TO authenticated;
GRANT ALL ON public.sectors TO service_role;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sectors org read" ON public.sectors
  FOR SELECT USING (public.is_org_member(owner_id, auth.uid()));
CREATE POLICY "sectors owner write" ON public.sectors
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER trg_sectors_updated_at
  BEFORE UPDATE ON public.sectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- sector_members
CREATE TABLE public.sector_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_lead BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sector_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sector_members TO authenticated;
GRANT ALL ON public.sector_members TO service_role;
ALTER TABLE public.sector_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sm org read" ON public.sector_members
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.sectors s
    WHERE s.id = sector_members.sector_id
      AND public.is_org_member(s.owner_id, auth.uid())
  ));
CREATE POLICY "sm owner write" ON public.sector_members
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.sectors s
    WHERE s.id = sector_members.sector_id AND s.owner_id = auth.uid()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.sectors s
    WHERE s.id = sector_members.sector_id AND s.owner_id = auth.uid()
  ));

-- invites
CREATE TABLE public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email TEXT,
  role public.app_role NOT NULL DEFAULT 'agent',
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  sector_ids UUID[] NOT NULL DEFAULT '{}',
  note TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites owner all" ON public.invites
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- chat_assignments
CREATE TABLE public.chat_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sector_id UUID REFERENCES public.sectors(id) ON DELETE SET NULL,
  assigned_by TEXT NOT NULL DEFAULT 'ai',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_assignments TO authenticated;
GRANT ALL ON public.chat_assignments TO service_role;
ALTER TABLE public.chat_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ca org read" ON public.chat_assignments
  FOR SELECT USING (
    owner_id = auth.uid()
    OR (
      public.is_org_member(owner_id, auth.uid())
      AND (
        assigned_to = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_permissions p
          WHERE p.owner_id = chat_assignments.owner_id
            AND p.user_id = auth.uid()
            AND p.can_view_all_chats
        )
      )
    )
  );
CREATE POLICY "ca owner write" ON public.chat_assignments
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER trg_chat_assignments_updated_at
  BEFORE UPDATE ON public.chat_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- chat_transfer_log
CREATE TABLE public.chat_transfer_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  from_user UUID,
  to_user UUID,
  sector_id UUID,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chat_transfer_log TO authenticated;
GRANT ALL ON public.chat_transfer_log TO service_role;
ALTER TABLE public.chat_transfer_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctl org read" ON public.chat_transfer_log
  FOR SELECT USING (public.is_org_member(owner_id, auth.uid()));
CREATE POLICY "ctl insert" ON public.chat_transfer_log
  FOR INSERT WITH CHECK (public.is_org_member(owner_id, auth.uid()));

-- ai_global_state
CREATE TABLE public.ai_global_state (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_global_state TO authenticated;
GRANT ALL ON public.ai_global_state TO service_role;
ALTER TABLE public.ai_global_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ags org read" ON public.ai_global_state
  FOR SELECT USING (public.is_org_member(owner_id, auth.uid()));
CREATE POLICY "ags owner write" ON public.ai_global_state
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Extra SELECT policy em crm_messages para membros e responsáveis
CREATE POLICY "crm_messages team visibility" ON public.crm_messages
  FOR SELECT USING (
    public.is_org_member(crm_messages.user_id, auth.uid())
    AND (
      EXISTS (
        SELECT 1 FROM public.user_permissions p
        WHERE p.owner_id = crm_messages.user_id
          AND p.user_id = auth.uid()
          AND p.can_view_all_chats
      )
      OR EXISTS (
        SELECT 1 FROM public.chat_assignments ca
        WHERE ca.owner_id = crm_messages.user_id
          AND ca.chat_id = crm_messages.chat_id
          AND ca.assigned_to = auth.uid()
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_chat_assignments_lookup
  ON public.chat_assignments (owner_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_assignments_user
  ON public.chat_assignments (assigned_to);
CREATE INDEX IF NOT EXISTS idx_org_members_member
  ON public.org_members (member_id);

-- ---------------------------------------------------------------------
-- FILE: 20260709095641_b1e088a9-8eb6-4ab7-bfce-cfd7788a330e.sql
-- ---------------------------------------------------------------------

CREATE TABLE public.chat_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  created_by uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#22c55e',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_labels TO authenticated;
GRANT ALL ON public.chat_labels TO service_role;

ALTER TABLE public.chat_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view labels"
  ON public.chat_labels FOR SELECT TO authenticated
  USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Org members can create labels"
  ON public.chat_labels FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Owner or creator can update labels"
  ON public.chat_labels FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid());

CREATE POLICY "Owner or creator can delete labels"
  ON public.chat_labels FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid());


CREATE TABLE public.chat_label_assignments (
  owner_id uuid NOT NULL,
  chat_id text NOT NULL,
  label_id uuid NOT NULL REFERENCES public.chat_labels(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, label_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_label_assignments TO authenticated;
GRANT ALL ON public.chat_label_assignments TO service_role;

ALTER TABLE public.chat_label_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view assignments"
  ON public.chat_label_assignments FOR SELECT TO authenticated
  USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Org members can create assignments"
  ON public.chat_label_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND assigned_by = auth.uid());

CREATE POLICY "Org members can delete assignments"
  ON public.chat_label_assignments FOR DELETE TO authenticated
  USING (public.is_org_member(owner_id, auth.uid()));

CREATE INDEX chat_label_assignments_chat_idx ON public.chat_label_assignments(chat_id);
CREATE INDEX chat_label_assignments_owner_idx ON public.chat_label_assignments(owner_id);

-- ---------------------------------------------------------------------
-- FILE: 20260709100545_88b63ff5-2f27-474c-8cdf-b34798ad8926.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.invites ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS invites_slug_key ON public.invites (slug) WHERE slug IS NOT NULL;
-- ---------------------------------------------------------------------
-- FILE: 20260709104705_f9910363-2d36-45ea-bdcc-7bfaaf7ddde3.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS max_members integer NOT NULL DEFAULT 5;

-- Permite que o próprio member leia seu registro (sidebar/guard precisa saber se está ativo)
DROP POLICY IF EXISTS "org_members self read" ON public.org_members;
CREATE POLICY "org_members self read" ON public.org_members
  FOR SELECT USING (member_id = auth.uid() OR owner_id = auth.uid());

-- Permite que o próprio member leia suas permissões
DROP POLICY IF EXISTS "user_permissions self read" ON public.user_permissions;
CREATE POLICY "user_permissions self read" ON public.user_permissions
  FOR SELECT USING (user_id = auth.uid() OR owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- FILE: 20260709161422_346d58a1-c057-4c44-95ea-54c299c4b10c.sql
-- ---------------------------------------------------------------------

-- Função que retorna o "dono principal" do sistema (admin mais antigo)
CREATE OR REPLACE FUNCTION public.get_master_owner()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'admin'
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

-- Novo trigger: cria profile e adiciona como pendente na equipe do admin principal
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  master_id uuid;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);

  master_id := public.get_master_owner();

  -- Se existe um dono principal e o novo user não é ele próprio, adiciona como pendente
  IF master_id IS NOT NULL AND master_id <> NEW.id THEN
    INSERT INTO public.org_members (owner_id, member_id, role, active)
    VALUES (master_id, NEW.id, 'agent', false)
    ON CONFLICT (owner_id, member_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: usuários já existentes que ainda não fazem parte de nenhuma equipe
INSERT INTO public.org_members (owner_id, member_id, role, active)
SELECT public.get_master_owner(), p.id, 'agent', false
FROM public.profiles p
WHERE public.get_master_owner() IS NOT NULL
  AND p.id <> public.get_master_owner()
  AND NOT EXISTS (
    SELECT 1 FROM public.org_members om WHERE om.member_id = p.id
  )
ON CONFLICT (owner_id, member_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- FILE: 20260709161504_a0cfc4e7-fb21-46ca-a0d8-3f27a07e8071.sql
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_master_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_master_owner() TO service_role;

-- ---------------------------------------------------------------------
-- FILE: 20260709162553_db5f3932-271b-49da-96d7-6d6c3fbc8a24.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_owner_id uuid;
  matched_invite record;
  invite_permissions jsonb;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);

  SELECT * INTO matched_invite
  FROM public.invites
  WHERE email IS NOT NULL
    AND lower(email) = lower(NEW.email)
    AND revoked_at IS NULL
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  target_owner_id := COALESCE(matched_invite.owner_id, public.get_master_owner());

  IF target_owner_id IS NOT NULL AND target_owner_id <> NEW.id THEN
    INSERT INTO public.org_members (owner_id, member_id, role, active)
    VALUES (target_owner_id, NEW.id, COALESCE(matched_invite.role, 'agent'::public.app_role), false)
    ON CONFLICT (owner_id, member_id) DO UPDATE SET
      role = EXCLUDED.role,
      active = false,
      updated_at = now();

    IF matched_invite.id IS NOT NULL THEN
      invite_permissions := COALESCE(matched_invite.permissions, '{}'::jsonb);

      INSERT INTO public.user_permissions (
        owner_id,
        user_id,
        can_view_all_chats,
        can_edit_kanban,
        can_manage_clients,
        can_manage_cases,
        can_send_billing,
        can_configure_ai,
        can_access_knowledge,
        can_manage_sectors,
        can_export
      ) VALUES (
        target_owner_id,
        NEW.id,
        COALESCE((invite_permissions->>'can_view_all_chats')::boolean, false),
        COALESCE((invite_permissions->>'can_edit_kanban')::boolean, true),
        COALESCE((invite_permissions->>'can_manage_clients')::boolean, true),
        COALESCE((invite_permissions->>'can_manage_cases')::boolean, true),
        COALESCE((invite_permissions->>'can_send_billing')::boolean, false),
        COALESCE((invite_permissions->>'can_configure_ai')::boolean, false),
        COALESCE((invite_permissions->>'can_access_knowledge')::boolean, true),
        COALESCE((invite_permissions->>'can_manage_sectors')::boolean, false),
        COALESCE((invite_permissions->>'can_export')::boolean, false)
      )
      ON CONFLICT (owner_id, user_id) DO UPDATE SET
        can_view_all_chats = EXCLUDED.can_view_all_chats,
        can_edit_kanban = EXCLUDED.can_edit_kanban,
        can_manage_clients = EXCLUDED.can_manage_clients,
        can_manage_cases = EXCLUDED.can_manage_cases,
        can_send_billing = EXCLUDED.can_send_billing,
        can_configure_ai = EXCLUDED.can_configure_ai,
        can_access_knowledge = EXCLUDED.can_access_knowledge,
        can_manage_sectors = EXCLUDED.can_manage_sectors,
        can_export = EXCLUDED.can_export,
        updated_at = now();

      IF matched_invite.sector_ids IS NOT NULL THEN
        INSERT INTO public.sector_members (sector_id, user_id, is_lead)
        SELECT unnest(matched_invite.sector_ids), NEW.id, false
        ON CONFLICT (sector_id, user_id) DO NOTHING;
      END IF;

      UPDATE public.invites
      SET used_at = now(), used_by = NEW.id
      WHERE id = matched_invite.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
-- ---------------------------------------------------------------------
-- FILE: 20260709162728_955c97a3-0112-4c95-ba21-b7756f2ef496.sql
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- ---------------------------------------------------------------------
-- FILE: 20260709164104_eb09d3f2-ffdc-4322-9cff-5785de854ec7.sql
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_invite_public(_token text)
RETURNS TABLE(valid boolean, reason text, email text, role text, inviter_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  owner_row record;
  is_uuid boolean;
BEGIN
  is_uuid := _token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF is_uuid THEN
    SELECT * INTO inv FROM public.invites WHERE token::text = _token LIMIT 1;
  ELSE
    SELECT * INTO inv FROM public.invites WHERE slug = _token LIMIT 1;
  END IF;

  IF inv.id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text, ''::text, ''::text, ''::text;
    RETURN;
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked'::text, ''::text, ''::text, ''::text;
    RETURN;
  END IF;
  IF inv.used_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'used'::text, ''::text, ''::text, ''::text;
    RETURN;
  END IF;
  IF inv.expires_at < now() THEN
    RETURN QUERY SELECT false, 'expired'::text, ''::text, ''::text, ''::text;
    RETURN;
  END IF;

  SELECT full_name, email INTO owner_row FROM public.profiles WHERE id = inv.owner_id LIMIT 1;

  RETURN QUERY SELECT
    true,
    ''::text,
    COALESCE(inv.email, ''),
    inv.role::text,
    COALESCE(owner_row.full_name, owner_row.email, 'sua equipe');
END;
$$;

REVOKE ALL ON FUNCTION public.get_invite_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_public(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- FILE: 20260709165345_2f88ed56-c9b4-4a46-9f93-74eff648b1f1.sql
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_invite_public(text) TO anon, authenticated, service_role;
-- ---------------------------------------------------------------------
-- FILE: 20260709170735_ac236c77-386d-475e-98f0-f6bb0161de50.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_invite_public(_token text)
RETURNS TABLE(valid boolean, reason text, email text, role text, inviter_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inv record;
  owner_full_name text;
  owner_email text;
  is_uuid boolean;
BEGIN
  is_uuid := _token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF is_uuid THEN
    SELECT i.* INTO inv FROM public.invites AS i WHERE i.token::text = _token LIMIT 1;
  ELSE
    SELECT i.* INTO inv FROM public.invites AS i WHERE i.slug = _token LIMIT 1;
  END IF;

  IF inv.id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text, ''::text, ''::text, ''::text;
    RETURN;
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked'::text, ''::text, ''::text, ''::text;
    RETURN;
  END IF;
  IF inv.used_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'used'::text, ''::text, ''::text, ''::text;
    RETURN;
  END IF;
  IF inv.expires_at < now() THEN
    RETURN QUERY SELECT false, 'expired'::text, ''::text, ''::text, ''::text;
    RETURN;
  END IF;

  SELECT p.full_name, p.email
    INTO owner_full_name, owner_email
    FROM public.profiles AS p
   WHERE p.id = inv.owner_id
   LIMIT 1;

  RETURN QUERY SELECT
    true,
    ''::text,
    COALESCE(inv.email, '')::text,
    inv.role::text,
    COALESCE(owner_full_name, owner_email, 'sua equipe')::text;
END;
$$;

REVOKE ALL ON FUNCTION public.get_invite_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_public(text) TO anon, authenticated, service_role;
-- ---------------------------------------------------------------------
-- FILE: 20260709171310_f55077a6-9e1d-43eb-bde0-9ed70ec8047e.sql
-- ---------------------------------------------------------------------

CREATE TABLE public.invite_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.invites(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  token_used text NOT NULL,
  full_name text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invite_access_requests TO authenticated;
GRANT ALL ON public.invite_access_requests TO service_role;

ALTER TABLE public.invite_access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can view own invite requests"
  ON public.invite_access_requests FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

CREATE POLICY "Owner can update own invite requests"
  ON public.invite_access_requests FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owner can delete own invite requests"
  ON public.invite_access_requests FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);

CREATE TRIGGER trg_invite_access_requests_updated
  BEFORE UPDATE ON public.invite_access_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.request_invite_access(
  _token text,
  _full_name text,
  _email text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  is_uuid boolean;
  new_id uuid;
BEGIN
  IF _full_name IS NULL OR length(trim(_full_name)) < 2 THEN
    RAISE EXCEPTION 'Informe seu nome';
  END IF;

  is_uuid := _token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF is_uuid THEN
    SELECT i.* INTO inv FROM public.invites i WHERE i.token::text = _token LIMIT 1;
  ELSE
    SELECT i.* INTO inv FROM public.invites i WHERE i.slug = _token LIMIT 1;
  END IF;

  IF inv.id IS NULL THEN RAISE EXCEPTION 'Convite inválido'; END IF;
  IF inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Convite revogado'; END IF;
  IF inv.used_at IS NOT NULL THEN RAISE EXCEPTION 'Convite já utilizado'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'Convite expirado'; END IF;

  INSERT INTO public.invite_access_requests (invite_id, owner_id, token_used, full_name, email, status)
  VALUES (inv.id, inv.owner_id, _token, trim(_full_name), NULLIF(trim(COALESCE(_email, '')), ''), 'pending')
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_invite_access(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_invite_access(text, text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- FILE: 20260709173557_844c9c67-e983-4e33-8960-73b398161f2a.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_invite_membership(
  _owner_id uuid,
  _member_id uuid,
  _role public.app_role DEFAULT 'agent'::public.app_role,
  _permissions jsonb DEFAULT '{}'::jsonb,
  _sector_ids uuid[] DEFAULT '{}',
  _active boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _owner_id IS NULL OR _member_id IS NULL OR _owner_id = _member_id THEN
    RETURN;
  END IF;

  INSERT INTO public.org_members (owner_id, member_id, role, active)
  VALUES (_owner_id, _member_id, COALESCE(_role, 'agent'::public.app_role), COALESCE(_active, false))
  ON CONFLICT (owner_id, member_id) DO UPDATE SET
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    updated_at = now();

  INSERT INTO public.user_permissions (
    owner_id,
    user_id,
    can_view_all_chats,
    can_edit_kanban,
    can_manage_clients,
    can_manage_cases,
    can_send_billing,
    can_configure_ai,
    can_access_knowledge,
    can_manage_sectors,
    can_export
  ) VALUES (
    _owner_id,
    _member_id,
    COALESCE((_permissions->>'can_view_all_chats')::boolean, false),
    COALESCE((_permissions->>'can_edit_kanban')::boolean, true),
    COALESCE((_permissions->>'can_manage_clients')::boolean, true),
    COALESCE((_permissions->>'can_manage_cases')::boolean, true),
    COALESCE((_permissions->>'can_send_billing')::boolean, false),
    COALESCE((_permissions->>'can_configure_ai')::boolean, false),
    COALESCE((_permissions->>'can_access_knowledge')::boolean, true),
    COALESCE((_permissions->>'can_manage_sectors')::boolean, false),
    COALESCE((_permissions->>'can_export')::boolean, false)
  )
  ON CONFLICT (owner_id, user_id) DO UPDATE SET
    can_view_all_chats = EXCLUDED.can_view_all_chats,
    can_edit_kanban = EXCLUDED.can_edit_kanban,
    can_manage_clients = EXCLUDED.can_manage_clients,
    can_manage_cases = EXCLUDED.can_manage_cases,
    can_send_billing = EXCLUDED.can_send_billing,
    can_configure_ai = EXCLUDED.can_configure_ai,
    can_access_knowledge = EXCLUDED.can_access_knowledge,
    can_manage_sectors = EXCLUDED.can_manage_sectors,
    can_export = EXCLUDED.can_export,
    updated_at = now();

  IF _sector_ids IS NOT NULL AND array_length(_sector_ids, 1) IS NOT NULL THEN
    INSERT INTO public.sector_members (sector_id, user_id, is_lead)
    SELECT unnest(_sector_ids), _member_id, false
    ON CONFLICT (sector_id, user_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_member_id, COALESCE(_role, 'agent'::public.app_role))
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_invite_access_request(
  _request_id uuid,
  _email text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req record;
  inv record;
  target_profile record;
  final_email text;
  member_limit integer;
  active_count integer;
  already_active boolean;
  released boolean := false;
BEGIN
  SELECT * INTO req
  FROM public.invite_access_requests
  WHERE id = _request_id
  LIMIT 1;

  IF req.id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;

  IF req.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Você não pode aprovar esta solicitação';
  END IF;

  final_email := lower(trim(COALESCE(_email, req.email, '')));
  IF final_email = '' OR final_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido para aprovar';
  END IF;

  SELECT * INTO inv
  FROM public.invites
  WHERE id = req.invite_id
    AND owner_id = req.owner_id
  LIMIT 1;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'Convite original não encontrado';
  END IF;

  SELECT id, email, full_name INTO target_profile
  FROM public.profiles
  WHERE lower(email) = final_email
  ORDER BY created_at DESC
  LIMIT 1;

  IF target_profile.id IS NOT NULL THEN
    SELECT COALESCE(max_members, 5) INTO member_limit
    FROM public.profiles
    WHERE id = req.owner_id;

    SELECT count(*) INTO active_count
    FROM public.org_members
    WHERE owner_id = req.owner_id
      AND active = true;

    SELECT EXISTS (
      SELECT 1
      FROM public.org_members
      WHERE owner_id = req.owner_id
        AND member_id = target_profile.id
        AND active = true
    ) INTO already_active;

    IF COALESCE(already_active, false) = false AND active_count >= COALESCE(member_limit, 5) THEN
      RAISE EXCEPTION 'Limite de % membros ativos atingido. Aumente o limite antes de aprovar.', COALESCE(member_limit, 5);
    END IF;

    PERFORM public.apply_invite_membership(
      req.owner_id,
      target_profile.id,
      inv.role,
      COALESCE(inv.permissions, '{}'::jsonb),
      COALESCE(inv.sector_ids, '{}'::uuid[]),
      true
    );

    released := true;
  END IF;

  UPDATE public.invite_access_requests
  SET status = 'approved',
      email = final_email,
      notes = CASE
        WHEN released THEN 'Usuário liberado automaticamente pelo painel admin.'
        ELSE 'Aprovado; aguardando cadastro do usuário com este e-mail.'
      END
  WHERE id = req.id;

  RETURN jsonb_build_object(
    'ok', true,
    'email', final_email,
    'released', released,
    'user_id', target_profile.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_invite_access_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_invite_access_request(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_owner_id uuid;
  matched_invite record;
  matched_request record;
  invite_permissions jsonb;
  should_activate boolean := false;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);

  SELECT iar.*, i.role AS invite_role, i.permissions AS invite_permissions, i.sector_ids AS invite_sector_ids
  INTO matched_request
  FROM public.invite_access_requests iar
  JOIN public.invites i ON i.id = iar.invite_id
  WHERE iar.email IS NOT NULL
    AND lower(iar.email) = lower(NEW.email)
    AND iar.status IN ('pending', 'approved')
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  ORDER BY CASE WHEN iar.status = 'approved' THEN 0 ELSE 1 END, iar.created_at DESC
  LIMIT 1;

  IF matched_request.id IS NOT NULL THEN
    should_activate := matched_request.status = 'approved';
    PERFORM public.apply_invite_membership(
      matched_request.owner_id,
      NEW.id,
      COALESCE(matched_request.invite_role, 'agent'::public.app_role),
      COALESCE(matched_request.invite_permissions, '{}'::jsonb),
      COALESCE(matched_request.invite_sector_ids, '{}'::uuid[]),
      should_activate
    );

    IF should_activate THEN
      UPDATE public.invite_access_requests
      SET notes = 'Usuário cadastrado e liberado automaticamente.'
      WHERE id = matched_request.id;
    END IF;

    RETURN NEW;
  END IF;

  SELECT * INTO matched_invite
  FROM public.invites
  WHERE email IS NOT NULL
    AND lower(email) = lower(NEW.email)
    AND revoked_at IS NULL
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  target_owner_id := COALESCE(matched_invite.owner_id, public.get_master_owner());

  IF target_owner_id IS NOT NULL AND target_owner_id <> NEW.id THEN
    IF matched_invite.id IS NOT NULL THEN
      invite_permissions := COALESCE(matched_invite.permissions, '{}'::jsonb);

      PERFORM public.apply_invite_membership(
        target_owner_id,
        NEW.id,
        COALESCE(matched_invite.role, 'agent'::public.app_role),
        invite_permissions,
        COALESCE(matched_invite.sector_ids, '{}'::uuid[]),
        false
      );

      UPDATE public.invites
      SET used_at = now(), used_by = NEW.id
      WHERE id = matched_invite.id;
    ELSE
      PERFORM public.apply_invite_membership(
        target_owner_id,
        NEW.id,
        'agent'::public.app_role,
        '{}'::jsonb,
        '{}'::uuid[],
        false
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

WITH matched AS (
  SELECT DISTINCT ON (iar.id)
    iar.id AS request_id,
    iar.owner_id,
    p.id AS member_id,
    i.role,
    i.permissions,
    i.sector_ids
  FROM public.invite_access_requests iar
  JOIN public.invites i ON i.id = iar.invite_id
  JOIN public.profiles p ON lower(p.email) = lower(iar.email)
  WHERE iar.status = 'approved'
    AND iar.email IS NOT NULL
    AND p.id <> iar.owner_id
  ORDER BY iar.id, iar.created_at DESC
)
SELECT public.apply_invite_membership(owner_id, member_id, role, COALESCE(permissions, '{}'::jsonb), COALESCE(sector_ids, '{}'::uuid[]), true)
FROM matched;
-- ---------------------------------------------------------------------
-- FILE: 20260709173817_b77d6f88-0c5f-4c8c-a975-a2082bc55f1a.sql
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM anon;
REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) TO service_role;
-- ---------------------------------------------------------------------
-- FILE: 20260709173909_f02e4b2f-6426-407c-a1ec-b0c2496bb26c.sql
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.approve_invite_access_request(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.approve_invite_access_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_invite_access_request(uuid, text) TO authenticated, service_role;
-- ---------------------------------------------------------------------
-- FILE: 20260709224710_798c0d20-aa62-447c-b92f-a24ec0901ec3.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_approved_invite_for_current_user()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_email text := lower(trim(COALESCE(auth.jwt()->>'email', '')));
  current_name text := COALESCE(NULLIF(auth.jwt()->'user_metadata'->>'full_name', ''), NULLIF(auth.jwt()->'user_metadata'->>'name', ''), current_email);
  req record;
  inv record;
  member_limit integer;
  active_count integer;
  already_active boolean := false;
BEGIN
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_authenticated');
  END IF;

  IF current_email = '' OR current_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'missing_email');
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (current_user_id, current_email, current_name)
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    updated_at = now();

  SELECT iar.*, i.role AS invite_role, i.permissions AS invite_permissions, i.sector_ids AS invite_sector_ids,
         i.revoked_at AS invite_revoked_at, i.expires_at AS invite_expires_at
  INTO req
  FROM public.invite_access_requests iar
  JOIN public.invites i ON i.id = iar.invite_id
  WHERE iar.status = 'approved'
    AND iar.email IS NOT NULL
    AND lower(iar.email) = current_email
    AND iar.owner_id <> current_user_id
  ORDER BY iar.created_at DESC
  LIMIT 1;

  IF req.id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'no_approved_request');
  END IF;

  IF req.invite_revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invite_revoked');
  END IF;

  IF req.invite_expires_at < now() THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invite_expired');
  END IF;

  SELECT COALESCE(max_members, 5)
  INTO member_limit
  FROM public.profiles
  WHERE id = req.owner_id;

  SELECT count(*)
  INTO active_count
  FROM public.org_members
  WHERE owner_id = req.owner_id
    AND active = true;

  SELECT EXISTS (
    SELECT 1
    FROM public.org_members
    WHERE owner_id = req.owner_id
      AND member_id = current_user_id
      AND active = true
  ) INTO already_active;

  IF COALESCE(already_active, false) = false AND active_count >= COALESCE(member_limit, 5) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'member_limit');
  END IF;

  PERFORM public.apply_invite_membership(
    req.owner_id,
    current_user_id,
    COALESCE(req.invite_role, 'agent'::public.app_role),
    COALESCE(req.invite_permissions, '{}'::jsonb),
    COALESCE(req.invite_sector_ids, '{}'::uuid[]),
    true
  );

  UPDATE public.invite_access_requests
  SET notes = 'Usuário entrou e foi liberado automaticamente pela web.'
  WHERE id = req.id;

  RETURN jsonb_build_object('released', true, 'owner_id', req.owner_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_approved_invite_for_current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_approved_invite_for_current_user() TO authenticated, service_role;
-- ---------------------------------------------------------------------
-- FILE: 20260709224823_d66ce94e-c971-4b9d-8c84-c0815223fc24.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_invite_access(
  _token text,
  _full_name text,
  _email text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  is_uuid boolean;
  new_id uuid;
  final_email text := lower(NULLIF(trim(COALESCE(_email, '')), ''));
BEGIN
  IF _full_name IS NULL OR length(trim(_full_name)) < 2 THEN
    RAISE EXCEPTION 'Informe seu nome';
  END IF;

  is_uuid := _token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF is_uuid THEN
    SELECT i.* INTO inv FROM public.invites i WHERE i.token::text = _token LIMIT 1;
  ELSE
    SELECT i.* INTO inv FROM public.invites i WHERE i.slug = _token LIMIT 1;
  END IF;

  IF inv.id IS NULL THEN RAISE EXCEPTION 'Convite inválido'; END IF;
  IF inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Convite revogado'; END IF;
  IF inv.used_at IS NOT NULL THEN RAISE EXCEPTION 'Convite já utilizado'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'Convite expirado'; END IF;

  IF final_email IS NOT NULL THEN
    SELECT id INTO new_id
    FROM public.invite_access_requests
    WHERE invite_id = inv.id
      AND lower(email) = final_email
    ORDER BY created_at DESC
    LIMIT 1;

    IF new_id IS NOT NULL THEN
      UPDATE public.invite_access_requests
      SET full_name = COALESCE(NULLIF(trim(_full_name), ''), full_name),
          token_used = _token
      WHERE id = new_id;
      RETURN new_id;
    END IF;
  END IF;

  INSERT INTO public.invite_access_requests (invite_id, owner_id, token_used, full_name, email, status)
  VALUES (inv.id, inv.owner_id, _token, trim(_full_name), final_email, 'pending')
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_invite_access(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_invite_access(text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_access_request_status_public(_id uuid)
RETURNS TABLE(id uuid, full_name text, email text, status text, notes text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT iar.id, iar.full_name, iar.email, iar.status, iar.notes, iar.created_at
  FROM public.invite_access_requests iar
  WHERE iar.id = _id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_access_request_status_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_access_request_status_public(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.find_access_request_by_token_public(_token text, _email text DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, email text, status text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  final_email text := lower(NULLIF(trim(COALESCE(_email, '')), ''));
BEGIN
  RETURN QUERY
  SELECT iar.id, iar.full_name, iar.email, iar.status, iar.created_at
  FROM public.invite_access_requests iar
  WHERE iar.token_used = _token
    AND (final_email IS NULL OR lower(iar.email) = final_email)
  ORDER BY iar.created_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.find_access_request_by_token_public(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_access_request_by_token_public(text, text) TO anon, authenticated, service_role;
-- ---------------------------------------------------------------------
-- FILE: 20260710015311_b7c1ba93-1b4e-4e7c-bca8-bc4cde78884e.sql
-- ---------------------------------------------------------------------
CREATE POLICY "Staff can insert clients" ON public.clients FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'specialist'::app_role));

CREATE POLICY "Staff can delete clients" ON public.clients FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'specialist'::app_role));
-- ---------------------------------------------------------------------
-- FILE: 20260710020905_af4c8543-eebb-421e-aea5-72fa4a163fbd.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS google_event_id text,
  ADD COLUMN IF NOT EXISTS google_event_link text;
-- ---------------------------------------------------------------------
-- FILE: 20260710023036_d0b42344-8a58-4636-97a4-1c4e2e4f29bc.sql
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Staff can view all clients" ON public.clients;
DROP POLICY IF EXISTS "Staff can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Staff can update clients" ON public.clients;
DROP POLICY IF EXISTS "Staff can delete clients" ON public.clients;

CREATE POLICY "Authenticated can view clients" ON public.clients
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update clients" ON public.clients
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Staff can delete clients" ON public.clients
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'specialist'::app_role));

-- ---------------------------------------------------------------------
-- FILE: 20260710023328_e0add61c-6946-4962-b63f-f2bdcd6d21df.sql
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Staff can view all cases" ON public.cases;
DROP POLICY IF EXISTS "Staff can update cases" ON public.cases;

CREATE POLICY "Authenticated can view cases" ON public.cases
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert cases" ON public.cases
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update cases" ON public.cases
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Staff can delete cases" ON public.cases
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'specialist'::app_role));

-- ---------------------------------------------------------------------
-- FILE: 20260710030014_email_infra.sql
-- ---------------------------------------------------------------------
-- Email infrastructure
-- Creates the queue system, send log, send state, suppression, and unsubscribe
-- tables used by both auth and transactional emails.

-- Extensions required for queue processing
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create email queues (auth = high priority, transactional = normal)
-- Wrapped in DO blocks to handle "queue already exists" errors idempotently.
DO $$ BEGIN PERFORM pgmq.create('auth_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Dead-letter queues for messages that exceed max retries
DO $$ BEGIN PERFORM pgmq.create('auth_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Email send log table (audit trail for all send attempts)
-- UPDATE is allowed for the service role so the suppression edge function
-- can update a log record's status when a bounce/complaint/unsubscribe occurs.
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT,
  template_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq')),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supabase no longer grants public-schema access to service_role by default;
-- emit the grant explicitly so edge functions can reach the table via PostgREST.
GRANT ALL ON public.email_send_log TO service_role;

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can read send log"
    ON public.email_send_log FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can insert send log"
    ON public.email_send_log FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can update send log"
    ON public.email_send_log FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_created ON public.email_send_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_send_log_recipient ON public.email_send_log(recipient_email);

-- Backfill: add message_id column to existing tables that predate this migration
DO $$ BEGIN
  ALTER TABLE public.email_send_log ADD COLUMN message_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_message ON public.email_send_log(message_id);

-- Prevent duplicate sends: only one 'sent' row per message_id.
-- If VT expires and another worker picks up the same message, the pre-send
-- check catches it. This index is a DB-level safety net for race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_message_sent_unique
  ON public.email_send_log(message_id) WHERE status = 'sent';

-- Backfill: update status CHECK constraint for existing tables that predate new statuses
DO $$ BEGIN
  ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
  ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
    CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq'));
END $$;

-- Rate-limit state and queue config (single row, tracks Retry-After cooldown + throughput settings)
CREATE TABLE IF NOT EXISTS public.email_send_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  retry_after_until TIMESTAMPTZ,
  batch_size INTEGER NOT NULL DEFAULT 10,
  send_delay_ms INTEGER NOT NULL DEFAULT 200,
  auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15,
  transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Backfill: add config columns to existing tables that predate this migration
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 10;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN send_delay_ms INTEGER NOT NULL DEFAULT 200;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

GRANT ALL ON public.email_send_state TO service_role;

ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage send state"
    ON public.email_send_state FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RPC wrappers so Edge Functions can interact with pgmq via supabase.rpc()
-- (PostgREST only exposes functions in the public schema; pgmq functions are in the pgmq schema)
-- All wrappers auto-create the queue on undefined_table (42P01) so emails
-- are never lost if the queue was dropped (extension upgrade, restore, etc.).
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name TEXT, payload JSONB)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name TEXT, batch_size INT, vt INT)
RETURNS TABLE(msg_id BIGINT, read_ct INT, message JSONB)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name TEXT, message_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;

-- Restrict queue RPC wrappers to service_role only (SECURITY DEFINER runs as owner,
-- so without this any authenticated user could manipulate the email queues)
REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) TO service_role;

-- Suppressed emails table (tracks unsubscribes, bounces, complaints)
-- Append-only: no DELETE or UPDATE policies to prevent bypassing suppression.
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email)
);

GRANT ALL ON public.suppressed_emails TO service_role;

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can read suppressed emails"
    ON public.suppressed_emails FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can insert suppressed emails"
    ON public.suppressed_emails FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_suppressed_emails_email ON public.suppressed_emails(email);

-- Email unsubscribe tokens table (one token per email address for unsubscribe links)
-- No DELETE policy to prevent removing tokens. UPDATE allowed only to mark tokens as used.
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

GRANT ALL ON public.email_unsubscribe_tokens TO service_role;

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can read tokens"
    ON public.email_unsubscribe_tokens FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can insert tokens"
    ON public.email_unsubscribe_tokens FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can mark tokens as used"
    ON public.email_unsubscribe_tokens FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens(token);

-- ============================================================
-- POST-MIGRATION STEPS (applied dynamically by setup_email_infra)
-- These steps contain project-specific secrets and URLs and
-- cannot be expressed as static SQL. They are applied via the
-- Supabase Management API (ExecuteSQL) each time the tool runs.
-- ============================================================
--
-- 1. VAULT SECRET
--    Stores (or updates) the Supabase service_role key in
--    vault as 'email_queue_service_role_key'.
--    Uses vault.create_secret / vault.update_secret (upsert).
--    To revert: DELETE FROM vault.secrets WHERE name = 'email_queue_service_role_key';
--
-- 2. CRON JOB (pg_cron)
--    Creates job 'process-email-queue' with a 5-second interval.
--    The job checks:
--      a) rate-limit cooldown (email_send_state.retry_after_until)
--      b) whether auth_emails or transactional_emails queues have messages
--    If conditions are met, it calls the process-email-queue Edge Function
--    via net.http_post using the vault-stored service_role key.
--    To revert: SELECT cron.unschedule('process-email-queue');

-- ---------------------------------------------------------------------
-- FILE: 20260710151615_c9dcbd8a-d455-4bf6-890d-eff565738bd6.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_approved_invite_for_current_user()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid := auth.uid();
  current_email text := lower(trim(COALESCE(auth.jwt()->>'email', '')));
  current_name text := COALESCE(NULLIF(auth.jwt()->'user_metadata'->>'full_name', ''), NULLIF(auth.jwt()->'user_metadata'->>'name', ''), current_email);
  req record;
  member_limit integer;
  active_count integer;
BEGIN
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_authenticated');
  END IF;

  IF current_email = '' OR current_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'missing_email');
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (current_user_id, current_email, current_name)
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    updated_at = now();

  SELECT iar.*, i.role AS invite_role, i.permissions AS invite_permissions, i.sector_ids AS invite_sector_ids,
         i.revoked_at AS invite_revoked_at, i.expires_at AS invite_expires_at
  INTO req
  FROM public.invite_access_requests iar
  JOIN public.invites i ON i.id = iar.invite_id
  WHERE iar.status = 'approved'
    AND iar.email IS NOT NULL
    AND lower(iar.email) = current_email
    AND iar.owner_id <> current_user_id
  ORDER BY iar.created_at DESC
  LIMIT 1;

  IF req.id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'no_approved_request');
  END IF;

  -- CRITICAL: if the user is already a member of this org, the admin is the
  -- source of truth for permissions. Do NOT re-apply invite defaults on every
  -- page refresh, or admin toggles get overwritten.
  IF EXISTS (
    SELECT 1 FROM public.org_members
    WHERE owner_id = req.owner_id AND member_id = current_user_id
  ) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'already_member', 'owner_id', req.owner_id);
  END IF;

  IF req.invite_revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invite_revoked');
  END IF;

  IF req.invite_expires_at < now() THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invite_expired');
  END IF;

  SELECT COALESCE(max_members, 5)
  INTO member_limit
  FROM public.profiles
  WHERE id = req.owner_id;

  SELECT count(*)
  INTO active_count
  FROM public.org_members
  WHERE owner_id = req.owner_id
    AND active = true;

  IF active_count >= COALESCE(member_limit, 5) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'member_limit');
  END IF;

  PERFORM public.apply_invite_membership(
    req.owner_id,
    current_user_id,
    COALESCE(req.invite_role, 'agent'::public.app_role),
    COALESCE(req.invite_permissions, '{}'::jsonb),
    COALESCE(req.invite_sector_ids, '{}'::uuid[]),
    true
  );

  UPDATE public.invite_access_requests
  SET notes = 'Usuário entrou e foi liberado automaticamente pela web.'
  WHERE id = req.id;

  RETURN jsonb_build_object('released', true, 'owner_id', req.owner_id);
END;
$function$;
-- ---------------------------------------------------------------------
-- FILE: 20260711025639_1efb07aa-72b8-4b67-9f75-f1ac1b517f78.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.wapi_config ADD COLUMN IF NOT EXISTS reply_in_groups boolean NOT NULL DEFAULT false;
-- ---------------------------------------------------------------------
-- FILE: 20260711033143_fb9c45d7-d8dc-44eb-bfac-8ec3fa9923a2.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.crm_messages REPLICA IDENTITY FULL;
ALTER TABLE public.crm_paused_chats REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_paused_chats;
-- ---------------------------------------------------------------------
-- FILE: 20260711131718_a179c375-95e5-446c-8cd8-89ae529889a9.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS agent_keys text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_knowledge_base_agent_keys
  ON public.knowledge_base USING GIN (agent_keys);
-- ---------------------------------------------------------------------
-- FILE: 20260711133806_4f1ba0c4-286f-47b0-9bc4-8faa21d3f88c.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.ai_personality DROP CONSTRAINT IF EXISTS ai_personality_user_id_key;
ALTER TABLE public.ai_personality ADD COLUMN IF NOT EXISTS agent_key TEXT NOT NULL DEFAULT 'whatsapp';
UPDATE public.ai_personality SET agent_key = 'whatsapp' WHERE agent_key IS NULL OR agent_key = '';
CREATE UNIQUE INDEX IF NOT EXISTS ai_personality_user_agent_uidx ON public.ai_personality (user_id, agent_key);
-- ---------------------------------------------------------------------
-- FILE: 20260711141835_6f3fc063-be3d-4928-bedf-d9798991f2b3.sql
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'kanban_cards'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.kanban_cards;
  END IF;
END
$$;
-- ---------------------------------------------------------------------
-- FILE: 20260711152958_291e6d04-9557-42eb-a63d-c8fb0bd2f52a.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.crm_messages DROP CONSTRAINT IF EXISTS crm_messages_sender_check;
ALTER TABLE public.crm_messages ADD CONSTRAINT crm_messages_sender_check
  CHECK (sender = ANY (ARRAY['contact','bot','operator','system','whatsapp','triagem','analise','documentos']));
-- ---------------------------------------------------------------------
-- FILE: 20260711155743_c4f91c19-5e39-461d-af1b-70f82ec8afa8.sql
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auto_pause_on_human ON public.crm_messages;
DROP FUNCTION IF EXISTS public.auto_pause_chatbot_on_human_message();
-- ---------------------------------------------------------------------
-- FILE: 20260711185959_3cca82b3-e47f-43c8-90c9-87096ee165f7.sql
-- ---------------------------------------------------------------------

-- Media columns on crm_messages (binary payload metadata)
ALTER TABLE public.crm_messages
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime text,
  ADD COLUMN IF NOT EXISTS size bigint,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS filename text;

-- Storage policies for crm-media bucket (per-user folder: {user_id}/...)
CREATE POLICY "crm-media owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------
-- FILE: 20260711191333_29669e85-d822-4eab-8ee3-df5c1bae081d.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.clients REPLICA IDENTITY FULL;
ALTER TABLE public.cases REPLICA IDENTITY FULL;
ALTER TABLE public.appointments REPLICA IDENTITY FULL;
ALTER TABLE public.documents REPLICA IDENTITY FULL;
ALTER TABLE public.knowledge_base_documents REPLICA IDENTITY FULL;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['clients', 'cases', 'appointments', 'documents', 'knowledge_base_documents']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END $$;
-- ---------------------------------------------------------------------
-- FILE: 20260711191858_d1941896-4188-46d7-a3a4-765f0de063ac.sql
-- ---------------------------------------------------------------------

DO $$ BEGIN
  DROP POLICY IF EXISTS "crm-media owner read" ON storage.objects;
  DROP POLICY IF EXISTS "crm-media owner insert" ON storage.objects;
  DROP POLICY IF EXISTS "crm-media owner update" ON storage.objects;
  DROP POLICY IF EXISTS "crm-media owner delete" ON storage.objects;
END $$;

CREATE POLICY "crm-media owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------
-- FILE: 20260711194541_f3c0d650-ed79-44b9-97b4-149738903624.sql
-- ---------------------------------------------------------------------

-- Media processing state on crm_messages
ALTER TABLE public.crm_messages
  ADD COLUMN IF NOT EXISTS media_status text,
  ADD COLUMN IF NOT EXISTS media_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS media_last_error text;

-- Idempotency: same wapi_message_id per user/direction = same row.
-- Allows upsert so a slow first attempt can be completed by a retry.
CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_wapi_unique
  ON public.crm_messages (user_id, direction, wapi_message_id)
  WHERE wapi_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_messages_media_pending_idx
  ON public.crm_messages (media_next_retry_at)
  WHERE media_status IN ('pending','processing','failed_retry');

-- Cron: retry pending media every minute
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wapi-media-retry') THEN
    PERFORM cron.unschedule('wapi-media-retry');
  END IF;
END $$;

SELECT cron.schedule(
  'wapi-media-retry',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://SEU-DOMINIO-AQUI/api/public/wapi-media-retry',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'WAPI_WEBHOOK_SECRET' LIMIT 1))
  );
  $$
);

-- ---------------------------------------------------------------------
-- FILE: 20260711195322_7d2a1091-de4e-4e65-b19f-a757231f1798.sql
-- ---------------------------------------------------------------------

-- =========================================
-- media_assets: catálogo central de mídias
-- =========================================
CREATE TABLE IF NOT EXISTS public.media_assets (
  id                text PRIMARY KEY,               -- Media ID opaco (12 chars base32)
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('image','video','audio','voice','document')),
  mime              text,
  filename          text,
  size              bigint,
  width             integer,
  height            integer,
  duration_ms       integer,
  sha256            text,
  storage_provider  text NOT NULL DEFAULT 'bunny',
  storage_path      text,                            -- caminho no provedor (nunca sai da API)
  thumbnail_path    text,                            -- opcional; Bunny Optimizer normalmente cobre isso
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','uploading','ready','failed')),
  origin            text,                            -- wapi_inbound / operator_upload / ai_generated
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO authenticated;
GRANT ALL ON public.media_assets TO service_role;

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own media"
  ON public.media_assets
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS media_assets_user_created_idx
  ON public.media_assets (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_user_sha_uidx
  ON public.media_assets (user_id, sha256)
  WHERE sha256 IS NOT NULL;

CREATE TRIGGER media_assets_updated_at
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- crm_messages: nova coluna media_id
-- (storage_path/mime/filename permanecem como fallback legado)
-- =========================================
ALTER TABLE public.crm_messages
  ADD COLUMN IF NOT EXISTS media_id text REFERENCES public.media_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS crm_messages_media_id_idx
  ON public.crm_messages (media_id)
  WHERE media_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- FILE: 20260711213003_48218bfa-e16d-4750-bd61-06b9051528b0.sql
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.crm_messages_wapi_unique;

CREATE UNIQUE INDEX crm_messages_wapi_unique
  ON public.crm_messages (user_id, direction, wapi_message_id);
-- ---------------------------------------------------------------------
-- FILE: 20260711213105_a738a5f8-44bc-4a85-9197-200366deed2e.sql
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wapi-media-retry') THEN
    PERFORM cron.unschedule('wapi-media-retry');
  END IF;
END $$;

SELECT cron.schedule(
  'wapi-media-retry',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://SEU-DOMINIO-AQUI/api/public/wapi-media-retry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);
-- ---------------------------------------------------------------------
-- FILE: 20260711213304_fd683f01-7708-4c29-9afa-5be821a8b070.sql
-- ---------------------------------------------------------------------

-- 1) Promote unique index to unique constraint so PostgREST upsert onConflict works.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_wapi_unique'
  ) THEN
    ALTER TABLE public.crm_messages
      ADD CONSTRAINT crm_messages_wapi_unique
      UNIQUE USING INDEX crm_messages_wapi_unique;
  END IF;
END $$;

-- 2) Reagenda cron do retry passando o WAPI_WEBHOOK_SECRET via query string.
--    Guarda o segredo no vault para não expor no cron.command.
DO $$
DECLARE
  wapi_secret text;
BEGIN
  SELECT decrypted_secret INTO wapi_secret
  FROM vault.decrypted_secrets
  WHERE name = 'wapi_webhook_secret'
  LIMIT 1;

  IF wapi_secret IS NULL THEN
    -- Placeholder: precisa ser preenchido pelo operador via vault.
    PERFORM vault.create_secret('REPLACE_ME', 'wapi_webhook_secret', 'Segredo do webhook W-API para chamadas internas do cron.');
  END IF;
END $$;

SELECT cron.unschedule('wapi-media-retry')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wapi-media-retry');

SELECT cron.schedule(
  'wapi-media-retry',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://SEU-DOMINIO-AQUI/api/public/wapi-media-retry?secret=' ||
           (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'wapi_webhook_secret' LIMIT 1),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);

-- ---------------------------------------------------------------------
-- FILE: 20260711213320_4f967499-120e-4f19-88da-a45311d4ef1b.sql
-- ---------------------------------------------------------------------

DO $$
DECLARE
  sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = 'wapi_webhook_secret' LIMIT 1;
  IF sid IS NULL THEN
    PERFORM vault.create_secret('S6h9kJk0cIy7QHDh1jTshvcjNpGjdQuSa', 'wapi_webhook_secret', 'WAPI webhook secret for internal cron auth');
  ELSE
    PERFORM vault.update_secret(sid, 'S6h9kJk0cIy7QHDh1jTshvcjNpGjdQuSa');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- FILE: 20260711220611_592632ac-28eb-43c1-9e30-390e34130fef.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.crm_chat_reads (
  user_id uuid NOT NULL,
  chat_id text NOT NULL,
  owner_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_id)
);

CREATE INDEX idx_crm_chat_reads_owner_chat ON public.crm_chat_reads (owner_id, chat_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_chat_reads TO authenticated;
GRANT ALL ON public.crm_chat_reads TO service_role;

ALTER TABLE public.crm_chat_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own read markers"
ON public.crm_chat_reads
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_crm_chat_reads_updated_at
BEFORE UPDATE ON public.crm_chat_reads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ---------------------------------------------------------------------
-- FILE: 20260711221259_5f9bcd49-b9d0-40e3-9e92-bedad7165632.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.chat_assignments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_assignments;
-- ---------------------------------------------------------------------
-- FILE: 20260712131644_8c78d5db-080f-4e74-8820-7858b1c4147d.sql
-- ---------------------------------------------------------------------

-- 1) Campos extras em clients (aditivo, sem tocar nos existentes)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS notes text;

-- 2) Tabela de follow-ups por SMS
CREATE TABLE IF NOT EXISTS public.client_sms_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text,
  message text NOT NULL,
  phone text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error text,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_sms_followups_status_chk
    CHECK (status IN ('pending','sent','failed','canceled'))
);

CREATE INDEX IF NOT EXISTS client_sms_followups_client_idx
  ON public.client_sms_followups(client_id);
CREATE INDEX IF NOT EXISTS client_sms_followups_due_idx
  ON public.client_sms_followups(status, scheduled_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_sms_followups TO authenticated;
GRANT ALL ON public.client_sms_followups TO service_role;

ALTER TABLE public.client_sms_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own followups"
  ON public.client_sms_followups FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own followups"
  ON public.client_sms_followups FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own followups"
  ON public.client_sms_followups FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own followups"
  ON public.client_sms_followups FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger updated_at (reutiliza função existente do projeto)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $f$ LANGUAGE plpgsql SET search_path = public;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_client_sms_followups_updated ON public.client_sms_followups;
CREATE TRIGGER trg_client_sms_followups_updated
  BEFORE UPDATE ON public.client_sms_followups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- FILE: 20260712153206_4649c936-305c-4757-b630-70bde224b908.sql
-- ---------------------------------------------------------------------

-- 1) Novas colunas em clients (todas opcionais, zero impacto no existente)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address_street text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS zip text,
  ADD COLUMN IF NOT EXISTS interest_level text,
  ADD COLUMN IF NOT EXISTS is_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS followup_queued_at timestamptz;

-- 2) Templates SMS de follow-up
CREATE TABLE IF NOT EXISTS public.sms_followup_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  message text NOT NULL,
  send_hour smallint NOT NULL DEFAULT 10 CHECK (send_hour BETWEEN 0 AND 23),
  send_minute smallint NOT NULL DEFAULT 0 CHECK (send_minute BETWEEN 0 AND 59),
  days_after_inactivity smallint NOT NULL DEFAULT 1 CHECK (days_after_inactivity BETWEEN 0 AND 30),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_followup_templates TO authenticated;
GRANT ALL ON public.sms_followup_templates TO service_role;

ALTER TABLE public.sms_followup_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sms templates"
  ON public.sms_followup_templates
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_sms_followup_templates_user_active
  ON public.sms_followup_templates(user_id, active);

CREATE INDEX IF NOT EXISTS idx_clients_followup_queue
  ON public.clients(followup_status, followup_queued_at)
  WHERE followup_status = 'queued';

-- Trigger updated_at (reutiliza função pública se existir; caso contrário cria)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sms_followup_templates_updated_at ON public.sms_followup_templates;
CREATE TRIGGER trg_sms_followup_templates_updated_at
  BEFORE UPDATE ON public.sms_followup_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- FILE: 20260712211954_4207a00e-b4bf-4785-aa90-8c8e3cb0d136.sql
-- ---------------------------------------------------------------------

-- 1) Ratings recebidos por agente
CREATE TABLE public.crm_agent_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  chat_id text NOT NULL,
  agent_key text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  raw_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_agent_ratings_owner_created_idx ON public.crm_agent_ratings (owner_id, created_at DESC);
CREATE INDEX crm_agent_ratings_owner_agent_idx ON public.crm_agent_ratings (owner_id, agent_key, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_agent_ratings TO authenticated;
GRANT ALL ON public.crm_agent_ratings TO service_role;

ALTER TABLE public.crm_agent_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own ratings"
  ON public.crm_agent_ratings FOR SELECT TO authenticated
  USING (owner_id = public.get_org_owner(auth.uid()));

CREATE POLICY "service manages ratings"
  ON public.crm_agent_ratings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2) Estado da pesquisa por chat (idempotência)
CREATE TABLE public.crm_chat_surveys (
  owner_id uuid NOT NULL,
  chat_id text NOT NULL,
  sent_at timestamptz,
  answered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, chat_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_chat_surveys TO authenticated;
GRANT ALL ON public.crm_chat_surveys TO service_role;

ALTER TABLE public.crm_chat_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own surveys"
  ON public.crm_chat_surveys FOR SELECT TO authenticated
  USING (owner_id = public.get_org_owner(auth.uid()));

CREATE POLICY "service manages surveys"
  ON public.crm_chat_surveys FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_crm_chat_surveys_updated
  BEFORE UPDATE ON public.crm_chat_surveys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_agent_ratings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_chat_surveys;

-- ---------------------------------------------------------------------
-- FILE: 20260713175502_acac66b3-0db4-4c27-b025-e8a5754bc2d0.sql
-- ---------------------------------------------------------------------
-- =========================================
-- CONTRACTS
-- =========================================
CREATE TABLE public.contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  created_by UUID NOT NULL,
  card_id UUID REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','signed','rejected','expired','cancelled')),
  autentique_document_id TEXT UNIQUE,
  autentique_public_id TEXT,
  file_url TEXT,
  signed_file_url TEXT,
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contracts_owner_idx ON public.contracts(owner_id);
CREATE INDEX contracts_card_idx ON public.contracts(card_id);
CREATE INDEX contracts_client_idx ON public.contracts(client_id);
CREATE INDEX contracts_autentique_doc_idx ON public.contracts(autentique_document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view contracts"
ON public.contracts FOR SELECT TO authenticated
USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Org members can insert contracts"
ON public.contracts FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Org members can update contracts"
ON public.contracts FOR UPDATE TO authenticated
USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Owner can delete contracts"
ON public.contracts FOR DELETE TO authenticated
USING (owner_id = auth.uid());

CREATE TRIGGER update_contracts_updated_at
BEFORE UPDATE ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- CONTRACT SIGNERS
-- =========================================
CREATE TABLE public.contract_signers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  action TEXT NOT NULL DEFAULT 'sign' CHECK (action IN ('sign','approve','acknowledge','witness')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','viewed','signed','rejected')),
  autentique_signer_id TEXT,
  signing_url TEXT,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contract_signers_contract_idx ON public.contract_signers(contract_id);
CREATE INDEX contract_signers_email_idx ON public.contract_signers(email);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_signers TO authenticated;
GRANT ALL ON public.contract_signers TO service_role;

ALTER TABLE public.contract_signers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view signers"
ON public.contract_signers FOR SELECT TO authenticated
USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Org members can manage signers"
ON public.contract_signers FOR ALL TO authenticated
USING (public.is_org_member(owner_id, auth.uid()))
WITH CHECK (public.is_org_member(owner_id, auth.uid()));

CREATE TRIGGER update_contract_signers_updated_at
BEFORE UPDATE ON public.contract_signers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- CONTRACT EVENTS (webhook audit trail)
-- =========================================
CREATE TABLE public.contract_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
  autentique_document_id TEXT,
  event_type TEXT NOT NULL,
  signer_email TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contract_events_contract_idx ON public.contract_events(contract_id);
CREATE INDEX contract_events_doc_idx ON public.contract_events(autentique_document_id);

GRANT SELECT ON public.contract_events TO authenticated;
GRANT ALL ON public.contract_events TO service_role;

ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view events of their contracts"
ON public.contract_events FOR SELECT TO authenticated
USING (
  contract_id IS NULL OR EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_events.contract_id
      AND public.is_org_member(c.owner_id, auth.uid())
  )
);
-- ---------------------------------------------------------------------
-- FILE: 20260713184459_6a0b67a9-e80b-4ec1-a24f-54a9910ecc26.sql
-- ---------------------------------------------------------------------

-- ============ contract_templates ============
CREATE TABLE public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  created_by uuid,
  name text NOT NULL,
  description text,
  body_html text NOT NULL DEFAULT '',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_templates TO authenticated;
GRANT ALL ON public.contract_templates TO service_role;

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read templates"
ON public.contract_templates FOR SELECT TO authenticated
USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "org members can insert templates"
ON public.contract_templates FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND owner_id = public.get_org_owner(auth.uid()));

CREATE POLICY "org members can update templates"
ON public.contract_templates FOR UPDATE TO authenticated
USING (public.is_org_member(owner_id, auth.uid()))
WITH CHECK (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "owner can delete templates"
ON public.contract_templates FOR DELETE TO authenticated
USING (owner_id = auth.uid());

CREATE TRIGGER trg_contract_templates_updated_at
BEFORE UPDATE ON public.contract_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ contract_reminders ============
CREATE TABLE public.contract_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  channel text NOT NULL DEFAULT 'whatsapp',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, level)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_reminders TO authenticated;
GRANT ALL ON public.contract_reminders TO service_role;

ALTER TABLE public.contract_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read reminders"
ON public.contract_reminders FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.contracts c
  WHERE c.id = contract_id AND public.is_org_member(c.owner_id, auth.uid())
));

CREATE POLICY "service role manages reminders"
ON public.contract_reminders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ contracts: colunas novas ============
CREATE SEQUENCE IF NOT EXISTS public.contract_code_seq;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_agent_id uuid,
  ADD COLUMN IF NOT EXISTS values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS integrity_score integer,
  ADD COLUMN IF NOT EXISTS integrity_report jsonb;

CREATE OR REPLACE FUNCTION public.assign_contract_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.contract_code IS NULL OR NEW.contract_code = '' THEN
    NEW.contract_code := 'CTR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.contract_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contracts_assign_code ON public.contracts;
CREATE TRIGGER trg_contracts_assign_code
BEFORE INSERT ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.assign_contract_code();

-- ============ contract_events: dedupe_key ============
ALTER TABLE public.contract_events
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS contract_events_dedupe_key_uidx
  ON public.contract_events(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ============ permissão nova ============
ALTER TABLE public.user_permissions
  ADD COLUMN IF NOT EXISTS can_manage_contracts boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- FILE: 20260713192614_273abbe5-3bde-42d3-adbc-648ea623099c.sql
-- ---------------------------------------------------------------------
insert into public.knowledge_base (title, content, category, agent_keys, active)
select
  'Eduardo — Regras de atuação (Agente de Contratos)',
  E'# Eduardo — Agente de Contratos\n\n## Quem é\nEduardo é o agente responsável pela geração e auditoria de contratos do escritório. Ele atua internamente, apoiando o advogado/atendente humano — nunca conversa diretamente com o cliente final no WhatsApp.\n\n## O que Eduardo PODE fazer\n- Escolher o template de contrato mais adequado ao caso.\n- Preencher automaticamente as variáveis a partir dos dados do cliente, do caso e do agente responsável (nome, CPF, endereço, valor, data etc.).\n- Rodar a auditoria jurídica por IA (clareza, completude, riscos, adequação ao direito brasileiro) e devolver um score de 0 a 100.\n- Apontar cláusulas ausentes, variáveis não preenchidas e riscos.\n- Marcar o contrato como pronto (ready) quando score >= 80 e sem variáveis faltando.\n- Registrar eventos e lembretes automáticos após o envio.\n\n## O que Eduardo NÃO pode fazer\n- NÃO envia o contrato para o Autentique sozinho — o disparo é sempre feito por um humano clicando em "Enviar".\n- NÃO assina contratos em nome do escritório nem do cliente.\n- NÃO altera cláusulas do template sem que o advogado revise.\n- NÃO conversa com o cliente no WhatsApp/chat — quem fala com o cliente são Sofia, Marina, Rafael e Bruno.\n- NÃO promete prazos, valores ou resultados fora do que está no template ou nos dados do caso.\n- NÃO fornece parecer jurídico definitivo — apenas auditoria de forma.\n\n## Tom e linguagem\n- Formal, objetivo, técnico-jurídico brasileiro.\n- Sempre em português (BR).\n- Sem gírias, emojis ou linguagem informal.\n- Cita a cláusula/variável exata ao apontar problema.\n\n## Fluxo padrão\n1. Humano cria rascunho a partir de um template + cliente.\n2. Eduardo preenche variáveis automáticas e roda auditoria IA.\n3. Se score >= 80 e sem variáveis faltando -> status ready.\n4. Humano revisa e clica em "Enviar para Autentique".\n5. Cliente assina; webhook Autentique atualiza status.\n6. Lembretes automáticos 24h/48h/72h se pendente.',
  'agentes',
  ARRAY['contratos']::text[],
  true
where not exists (
  select 1 from public.knowledge_base
  where title = 'Eduardo — Regras de atuação (Agente de Contratos)'
);
-- ---------------------------------------------------------------------
-- FILE: 20260713202249_ca5bef7d-13cb-47fb-9cbd-645dae4c2fd8.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS source_pdf_path text;

CREATE POLICY "contract-templates owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "contract-templates owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "contract-templates owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "contract-templates owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- FILE: 20260714125457_2cbc0847-e817-4cab-9330-80f883ad239c.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.eduardo_contract_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  card_id uuid REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  draft_sent_at timestamptz,
  draft_message text,
  approved_at timestamptz,
  handed_off_at timestamptz,
  handoff_note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eduardo_reviews_contract ON public.eduardo_contract_reviews(contract_id);
CREATE INDEX idx_eduardo_reviews_owner ON public.eduardo_contract_reviews(owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.eduardo_contract_reviews TO authenticated;
GRANT ALL ON public.eduardo_contract_reviews TO service_role;

ALTER TABLE public.eduardo_contract_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eduardo_reviews_owner_all"
  ON public.eduardo_contract_reviews
  FOR ALL
  TO authenticated
  USING (owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid()))
  WITH CHECK (owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid()));

CREATE TRIGGER eduardo_reviews_updated_at
  BEFORE UPDATE ON public.eduardo_contract_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ---------------------------------------------------------------------
-- FILE: 20260831120000_clients_owner_id.sql
-- ---------------------------------------------------------------------
-- Fix multi-tenant leak: clients era global (RLS USING true)
-- Adiciona owner_id e corrige RLS para escopar por organização

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_owner_id ON public.clients(owner_id);

-- Backfill: atribui dono aos registros legados (primeiro usuário = master)
UPDATE public.clients SET owner_id = public.get_master_owner() WHERE owner_id IS NULL;

-- Recria RLS: remove políticas permissivas USING (true) e cria escopadas por org
DO $$ BEGIN
  DROP POLICY IF EXISTS "Authenticated can view clients" ON public.clients;
  DROP POLICY IF EXISTS "Authenticated can insert clients" ON public.clients;
  DROP POLICY IF EXISTS "Authenticated can update clients" ON public.clients;
  DROP POLICY IF EXISTS "Staff can delete clients" ON public.clients;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Leitura: dono ou membro da org do dono, ou legado sem owner (transição)
CREATE POLICY "clients org read" ON public.clients FOR SELECT TO authenticated
  USING (
    owner_id IS NULL
    OR owner_id = auth.uid()
    OR public.is_org_member(owner_id, auth.uid())
  );

-- Insert: só com owner_id da própria org
CREATE POLICY "clients org insert" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid())
  );

-- Update: dono ou membro
CREATE POLICY "clients org update" ON public.clients FOR UPDATE TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid() OR public.is_org_member(owner_id, auth.uid()))
  WITH CHECK (owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid()) OR owner_id IS NULL);

-- Delete: só dono
CREATE POLICY "clients owner delete" ON public.clients FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_org_member(owner_id, auth.uid()));

-- Opcional: garante que novos inserts via client-extract.server usem owner_id correto

-- ---------------------------------------------------------------------
-- FILE: 20260831130000_knowledge_base_rls.sql
-- ---------------------------------------------------------------------
-- Fix RLS knowledge_base: antes só admin (has_role) podia inserir, bloqueava dono/membros
DO $$ BEGIN
  DROP POLICY IF EXISTS "Staff can view knowledge" ON public.knowledge_base;
  DROP POLICY IF EXISTS "Admins manage knowledge" ON public.knowledge_base;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Leitura: qualquer membro da org ou admin/specialist
CREATE POLICY "kb org read" ON public.knowledge_base FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist') OR true);

-- Escrita: qualquer autenticado (owner/membro) pode inserir/atualizar
CREATE POLICY "kb org write" ON public.knowledge_base FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- FILE: 20260903213000_cleanup_messages_7d.sql
-- ---------------------------------------------------------------------
-- Cron job: deleta mensagens do CRM com mais de 7 dias
-- Roda todo dia às 3h da manhã (horário de Brasília)

SELECT cron.schedule(
  'cleanup-crm-messages-7d',
  '0 6 * * *',  -- 06:00 UTC = 03:00 BRT
  $$
    DELETE FROM crm_messages
    WHERE created_at < now() - interval '7 days';
  $$
);

-- ---------------------------------------------------------------------
-- FILE: 20260903223000_cleanup_lid_contacts.sql
-- ---------------------------------------------------------------------
-- Remove conversas com chat_id que parece LID (≥15 dígitos, sem ser telefone BR)
-- Telefones BR têm no máximo 13 dígitos (55 + DDD + 9 dígitos)

-- Primeiro: vê quantos registros afeta
SELECT chat_id, count(*) as msgs 
FROM crm_messages 
WHERE chat_id ~ '^\d{15,}$'
GROUP BY chat_id;

-- Deleta mensagens com chat_id LID
DELETE FROM crm_messages 
WHERE chat_id ~ '^\d{15,}$';

-- Deleta cards do kanban com contact_phone LID
DELETE FROM kanban_cards 
WHERE contact_phone ~ '^\d{15,}$';

-- Deleta flow_conversations com chat_id LID
DELETE FROM flow_conversations 
WHERE chat_id ~ '^\d{15,}$';

-- Deleta chat_assignments com chat_id LID
DELETE FROM chat_assignments 
WHERE chat_id ~ '^\d{15,}$';

-- Deleta crm_paused_chats com chat_id LID
DELETE FROM crm_paused_chats 
WHERE chat_id ~ '^\d{15,}$';

-- ---------------------------------------------------------------------
-- FILE: 20260911120000_search_training_chunks.sql
-- ---------------------------------------------------------------------
-- Busca trechos de treinamento por relevância de texto (sem embeddings).
-- Retorna os chunks mais relevantes para uma query, usando ts_rank com fuzzy matching.
CREATE OR REPLACE FUNCTION public.search_training_chunks(
  _user_id UUID,
  _query TEXT,
  _match_count INT DEFAULT 10
)
RETURNS TABLE (id UUID, document_id UUID, content TEXT, rank FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH terms AS (
    SELECT regexp_replace(lower(unnest(regexp_split_to_array(_query, '\s+'))), '[^a-z0-9à-ú]', '', 'g') AS term
  ),
  scored AS (
    SELECT kc.id, kc.document_id, kc.content,
           sum(
             CASE WHEN lower(kc.content) ILIKE '%' || t.term || '%' THEN 1.0 ELSE 0.0 END
           ) AS score
    FROM public.knowledge_chunks kc, terms t
    WHERE kc.user_id = _user_id
      AND t.term <> ''
      AND length(t.term) > 2
    GROUP BY kc.id, kc.document_id, kc.content
  )
  SELECT s.id, s.document_id, s.content, s.score AS rank
  FROM scored s
  WHERE s.score > 0
  ORDER BY s.score DESC
  LIMIT _match_count;
$$;

