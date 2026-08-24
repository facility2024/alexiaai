
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
