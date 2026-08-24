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