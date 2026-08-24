
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
