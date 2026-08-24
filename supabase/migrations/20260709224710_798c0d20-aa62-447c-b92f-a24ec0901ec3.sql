CREATE OR REPLACE FUNCTION public.sync_approved_invite_for_current_user()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_email text := lower(trim(COALESCE(auth.jwt()->>'email', '')));
  current_name text := COALESCE(NULLIF(auth.jwt()->'user_metadata'->>'full_name', ''), NULLIF(auth.jwt()->'user_metadata'->>'name', ''), current_email);
  req record;
  inv record;
  member_limit integer;
  active_count integer;
  already_active boolean := false;
BEGIN
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_authenticated');
  END IF;

  IF current_email = '' OR current_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'missing_email');
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (current_user_id, current_email, current_name)
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    updated_at = now();

  SELECT iar.*, i.role AS invite_role, i.permissions AS invite_permissions, i.sector_ids AS invite_sector_ids,
         i.revoked_at AS invite_revoked_at, i.expires_at AS invite_expires_at
  INTO req
  FROM public.invite_access_requests iar
  JOIN public.invites i ON i.id = iar.invite_id
  WHERE iar.status = 'approved'
    AND iar.email IS NOT NULL
    AND lower(iar.email) = current_email
    AND iar.owner_id <> current_user_id
  ORDER BY iar.created_at DESC
  LIMIT 1;

  IF req.id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'no_approved_request');
  END IF;

  IF req.invite_revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invite_revoked');
  END IF;

  IF req.invite_expires_at < now() THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invite_expired');
  END IF;

  SELECT COALESCE(max_members, 5)
  INTO member_limit
  FROM public.profiles
  WHERE id = req.owner_id;

  SELECT count(*)
  INTO active_count
  FROM public.org_members
  WHERE owner_id = req.owner_id
    AND active = true;

  SELECT EXISTS (
    SELECT 1
    FROM public.org_members
    WHERE owner_id = req.owner_id
      AND member_id = current_user_id
      AND active = true
  ) INTO already_active;

  IF COALESCE(already_active, false) = false AND active_count >= COALESCE(member_limit, 5) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'member_limit');
  END IF;

  PERFORM public.apply_invite_membership(
    req.owner_id,
    current_user_id,
    COALESCE(req.invite_role, 'agent'::public.app_role),
    COALESCE(req.invite_permissions, '{}'::jsonb),
    COALESCE(req.invite_sector_ids, '{}'::uuid[]),
    true
  );

  UPDATE public.invite_access_requests
  SET notes = 'Usuário entrou e foi liberado automaticamente pela web.'
  WHERE id = req.id;

  RETURN jsonb_build_object('released', true, 'owner_id', req.owner_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_approved_invite_for_current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_approved_invite_for_current_user() TO authenticated, service_role;