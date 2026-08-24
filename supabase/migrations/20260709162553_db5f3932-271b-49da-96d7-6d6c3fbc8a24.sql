CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_owner_id uuid;
  matched_invite record;
  invite_permissions jsonb;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);

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
    INSERT INTO public.org_members (owner_id, member_id, role, active)
    VALUES (target_owner_id, NEW.id, COALESCE(matched_invite.role, 'agent'::public.app_role), false)
    ON CONFLICT (owner_id, member_id) DO UPDATE SET
      role = EXCLUDED.role,
      active = false,
      updated_at = now();

    IF matched_invite.id IS NOT NULL THEN
      invite_permissions := COALESCE(matched_invite.permissions, '{}'::jsonb);

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
        target_owner_id,
        NEW.id,
        COALESCE((invite_permissions->>'can_view_all_chats')::boolean, false),
        COALESCE((invite_permissions->>'can_edit_kanban')::boolean, true),
        COALESCE((invite_permissions->>'can_manage_clients')::boolean, true),
        COALESCE((invite_permissions->>'can_manage_cases')::boolean, true),
        COALESCE((invite_permissions->>'can_send_billing')::boolean, false),
        COALESCE((invite_permissions->>'can_configure_ai')::boolean, false),
        COALESCE((invite_permissions->>'can_access_knowledge')::boolean, true),
        COALESCE((invite_permissions->>'can_manage_sectors')::boolean, false),
        COALESCE((invite_permissions->>'can_export')::boolean, false)
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

      IF matched_invite.sector_ids IS NOT NULL THEN
        INSERT INTO public.sector_members (sector_id, user_id, is_lead)
        SELECT unnest(matched_invite.sector_ids), NEW.id, false
        ON CONFLICT (sector_id, user_id) DO NOTHING;
      END IF;

      UPDATE public.invites
      SET used_at = now(), used_by = NEW.id
      WHERE id = matched_invite.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;