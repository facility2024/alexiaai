
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
