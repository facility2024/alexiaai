ALTER TABLE public.ai_personality DROP CONSTRAINT IF EXISTS ai_personality_user_id_key;
ALTER TABLE public.ai_personality ADD COLUMN IF NOT EXISTS agent_key TEXT NOT NULL DEFAULT 'whatsapp';
UPDATE public.ai_personality SET agent_key = 'whatsapp' WHERE agent_key IS NULL OR agent_key = '';
CREATE UNIQUE INDEX IF NOT EXISTS ai_personality_user_agent_uidx ON public.ai_personality (user_id, agent_key);