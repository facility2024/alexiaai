CREATE OR REPLACE FUNCTION public.apply_invite_membership(
  _owner_id uuid,
  _member_id uuid,
  _role public.app_role DEFAULT 'agent'::public.app_role,
  _permissions jsonb DEFAULT '{}'::jsonb,
  _sector_ids uuid[] DEFAULT '{}',
  _active boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _owner_id IS NULL OR _member_id IS NULL OR _owner_id = _member_id THEN
    RETURN;
  END IF;

  INSERT INTO public.org_members (owner_id, member_id, role, active)
  VALUES (_owner_id, _member_id, COALESCE(_role, 'agent'::public.app_role), COALESCE(_active, false))
  ON CONFLICT (owner_id, member_id) DO UPDATE SET
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    updated_at = now();

  INSERT INTO public.user_permissions (
    owner_id,
    user_id,
    can_view_all_chats,
    can_edit_kanban,
    can_manage_clients,
    can_manage_cases,
    can_send_billing,
    can_configure_ai,
    can_access_knowledge,
    can_manage_sectors,
    can_export
  ) VALUES (
    _owner_id,
    _member_id,
    COALESCE((_permissions->>'can_view_all_chats')::boolean, false),
    COALESCE((_permissions->>'can_edit_kanban')::boolean, true),
    COALESCE((_permissions->>'can_manage_clients')::boolean, true),
    COALESCE((_permissions->>'can_manage_cases')::boolean, true),
    COALESCE((_permissions->>'can_send_billing')::boolean, false),
    COALESCE((_permissions->>'can_configure_ai')::boolean, false),
    COALESCE((_permissions->>'can_access_knowledge')::boolean, true),
    COALESCE((_permissions->>'can_manage_sectors')::boolean, false),
    COALESCE((_permissions->>'can_export')::boolean, false)
  )
  ON CONFLICT (owner_id, user_id) DO UPDATE SET
    can_view_all_chats = EXCLUDED.can_view_all_chats,
    can_edit_kanban = EXCLUDED.can_edit_kanban,
    can_manage_clients = EXCLUDED.can_manage_clients,
    can_manage_cases = EXCLUDED.can_manage_cases,
    can_send_billing = EXCLUDED.can_send_billing,
    can_configure_ai = EXCLUDED.can_configure_ai,
    can_access_knowledge = EXCLUDED.can_access_knowledge,
    can_manage_sectors = EXCLUDED.can_manage_sectors,
    can_export = EXCLUDED.can_export,
    updated_at = now();

  IF _sector_ids IS NOT NULL AND array_length(_sector_ids, 1) IS NOT NULL THEN
    INSERT INTO public.sector_members (sector_id, user_id, is_lead)
    SELECT unnest(_sector_ids), _member_id, false
    ON CONFLICT (sector_id, user_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_member_id, COALESCE(_role, 'agent'::public.app_role))
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_invite_access_request(
  _request_id uuid,
  _email text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req record;
  inv record;
  target_profile record;
  final_email text;
  member_limit integer;
  active_count integer;
  already_active boolean;
  released boolean := false;
BEGIN
  SELECT * INTO req
  FROM public.invite_access_requests
  WHERE id = _request_id
  LIMIT 1;

  IF req.id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;

  IF req.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Você não pode aprovar esta solicitação';
  END IF;

  final_email := lower(trim(COALESCE(_email, req.email, '')));
  IF final_email = '' OR final_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido para aprovar';
  END IF;

  SELECT * INTO inv
  FROM public.invites
  WHERE id = req.invite_id
    AND owner_id = req.owner_id
  LIMIT 1;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'Convite original não encontrado';
  END IF;

  SELECT id, email, full_name INTO target_profile
  FROM public.profiles
  WHERE lower(email) = final_email
  ORDER BY created_at DESC
  LIMIT 1;

  IF target_profile.id IS NOT NULL THEN
    SELECT COALESCE(max_members, 5) INTO member_limit
    FROM public.profiles
    WHERE id = req.owner_id;

    SELECT count(*) INTO active_count
    FROM public.org_members
    WHERE owner_id = req.owner_id
      AND active = true;

    SELECT EXISTS (
      SELECT 1
      FROM public.org_members
      WHERE owner_id = req.owner_id
        AND member_id = target_profile.id
        AND active = true
    ) INTO already_active;

    IF COALESCE(already_active, false) = false AND active_count >= COALESCE(member_limit, 5) THEN
      RAISE EXCEPTION 'Limite de % membros ativos atingido. Aumente o limite antes de aprovar.', COALESCE(member_limit, 5);
    END IF;

    PERFORM public.apply_invite_membership(
      req.owner_id,
      target_profile.id,
      inv.role,
      COALESCE(inv.permissions, '{}'::jsonb),
      COALESCE(inv.sector_ids, '{}'::uuid[]),
      true
    );

    released := true;
  END IF;

  UPDATE public.invite_access_requests
  SET status = 'approved',
      email = final_email,
      notes = CASE
        WHEN released THEN 'Usuário liberado automaticamente pelo painel admin.'
        ELSE 'Aprovado; aguardando cadastro do usuário com este e-mail.'
      END
  WHERE id = req.id;

  RETURN jsonb_build_object(
    'ok', true,
    'email', final_email,
    'released', released,
    'user_id', target_profile.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_invite_access_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_invite_access_request(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_owner_id uuid;
  matched_invite record;
  matched_request record;
  invite_permissions jsonb;
  should_activate boolean := false;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);

  SELECT iar.*, i.role AS invite_role, i.permissions AS invite_permissions, i.sector_ids AS invite_sector_ids
  INTO matched_request
  FROM public.invite_access_requests iar
  JOIN public.invites i ON i.id = iar.invite_id
  WHERE iar.email IS NOT NULL
    AND lower(iar.email) = lower(NEW.email)
    AND iar.status IN ('pending', 'approved')
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  ORDER BY CASE WHEN iar.status = 'approved' THEN 0 ELSE 1 END, iar.created_at DESC
  LIMIT 1;

  IF matched_request.id IS NOT NULL THEN
    should_activate := matched_request.status = 'approved';
    PERFORM public.apply_invite_membership(
      matched_request.owner_id,
      NEW.id,
      COALESCE(matched_request.invite_role, 'agent'::public.app_role),
      COALESCE(matched_request.invite_permissions, '{}'::jsonb),
      COALESCE(matched_request.invite_sector_ids, '{}'::uuid[]),
      should_activate
    );

    IF should_activate THEN
      UPDATE public.invite_access_requests
      SET notes = 'Usuário cadastrado e liberado automaticamente.'
      WHERE id = matched_request.id;
    END IF;

    RETURN NEW;
  END IF;

  SELECT * INTO matched_invite
  FROM public.invites
  WHERE email IS NOT NULL
    AND lower(email) = lower(NEW.email)
    AND revoked_at IS NULL
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  target_owner_id := COALESCE(matched_invite.owner_id, public.get_master_owner());

  IF target_owner_id IS NOT NULL AND target_owner_id <> NEW.id THEN
    IF matched_invite.id IS NOT NULL THEN
      invite_permissions := COALESCE(matched_invite.permissions, '{}'::jsonb);

      PERFORM public.apply_invite_membership(
        target_owner_id,
        NEW.id,
        COALESCE(matched_invite.role, 'agent'::public.app_role),
        invite_permissions,
        COALESCE(matched_invite.sector_ids, '{}'::uuid[]),
        false
      );

      UPDATE public.invites
      SET used_at = now(), used_by = NEW.id
      WHERE id = matched_invite.id;
    ELSE
      PERFORM public.apply_invite_membership(
        target_owner_id,
        NEW.id,
        'agent'::public.app_role,
        '{}'::jsonb,
        '{}'::uuid[],
        false
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

WITH matched AS (
  SELECT DISTINCT ON (iar.id)
    iar.id AS request_id,
    iar.owner_id,
    p.id AS member_id,
    i.role,
    i.permissions,
    i.sector_ids
  FROM public.invite_access_requests iar
  JOIN public.invites i ON i.id = iar.invite_id
  JOIN public.profiles p ON lower(p.email) = lower(iar.email)
  WHERE iar.status = 'approved'
    AND iar.email IS NOT NULL
    AND p.id <> iar.owner_id
  ORDER BY iar.id, iar.created_at DESC
)
SELECT public.apply_invite_membership(owner_id, member_id, role, COALESCE(permissions, '{}'::jsonb), COALESCE(sector_ids, '{}'::uuid[]), true)
FROM matched;