ALTER TABLE public.ai_settings 
  ADD COLUMN IF NOT EXISTS api_key text,
  ADD COLUMN IF NOT EXISTS base_url text;