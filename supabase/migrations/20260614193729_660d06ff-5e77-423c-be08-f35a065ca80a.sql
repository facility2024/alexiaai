
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
