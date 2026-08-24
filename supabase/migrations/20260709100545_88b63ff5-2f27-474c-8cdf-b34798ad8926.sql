ALTER TABLE public.invites ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS invites_slug_key ON public.invites (slug) WHERE slug IS NOT NULL;