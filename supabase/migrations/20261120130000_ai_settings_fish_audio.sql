-- Fish Audio no painel (Configurações → WhatsApp): chave da API, id da voz
-- (reference_id) e toggle de resposta em áudio. Colunas em ai_settings
-- (linha agent_key='whatsapp' gerenciada pelo painel).
-- Aplicar no SQL Editor do Supabase (padrão deste projeto).

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS fish_audio_key text,
  ADD COLUMN IF NOT EXISTS fish_audio_voice_id text,
  ADD COLUMN IF NOT EXISTS fish_audio_enabled boolean;
