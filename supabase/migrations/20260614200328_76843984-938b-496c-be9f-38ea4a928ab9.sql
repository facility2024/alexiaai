ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS openai_key text,
  ADD COLUMN IF NOT EXISTS gemini_key text,
  ADD COLUMN IF NOT EXISTS inworld_key text;