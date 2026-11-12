-- Painel de licenças SaaS: tabela company_licenses, flag is_platform_admin
-- e extensão do handle_new_user para convidados de empresa não caírem no
-- workspace do master owner (isolamento total do painel oficial).

-- 1) Flag do administrador da plataforma (gestor de licenças). O acesso ao
--    painel de licenças e às funções de gestão exige esta flag.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- Protege a flag: só service role (server functions) pode alterá-la.
CREATE OR REPLACE FUNCTION public.protect_platform_admin_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
     AND auth.jwt() IS NOT NULL
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'is_platform_admin so pode ser alterado pelo servico';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_platform_admin_flag ON public.profiles;
CREATE TRIGGER protect_platform_admin_flag
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_platform_admin_flag();

-- Conta principal = admin mais antigo (mesmo critério de get_master_owner()).
UPDATE public.profiles
SET is_platform_admin = true
WHERE id = public.get_master_owner()
  AND is_platform_admin = false;

-- 2) Licenças de empresa (tenant SaaS). Cada linha = uma empresa criada pelo
--    admin principal. owner_user_id fica nulo até o convidado concluir o
--    cadastro pelo link de convite de empresa.
CREATE TABLE IF NOT EXISTS public.company_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  invited_email text NOT NULL,
  owner_user_id uuid NULL REFERENCES auth.users (id),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NULL, -- null = sem prazo
  features jsonb NOT NULL DEFAULT '{}'::jsonb, -- chaves de src/lib/access.ts (PermKey)
  max_members integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  invite_token uuid NOT NULL DEFAULT gen_random_uuid(),
  invite_slug text UNIQUE,
  invite_used_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS company_licenses_owner_uidx
  ON public.company_licenses (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_licenses_email_idx
  ON public.company_licenses (lower(invited_email));

-- RLS: dono e membros da empresa leem a própria licença; escrita só via
-- service role (server functions com supabaseAdmin).
ALTER TABLE public.company_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company licenses org read" ON public.company_licenses;
CREATE POLICY "company licenses org read"
  ON public.company_licenses FOR SELECT
  USING (owner_user_id IS NOT NULL AND public.is_org_member(owner_user_id, auth.uid()));

REVOKE ALL ON public.company_licenses FROM PUBLIC, anon;
GRANT SELECT ON public.company_licenses TO authenticated;

-- 3) handle_new_user: convite de empresa vence o fluxo normal. O novo usuário
--    vira admin do PRÓPRIO workspace (forceOwner via user_roles) e nunca cai
--    no fallback do master owner.
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
  matched_license record;
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

  -- Convite de empresa (licença SaaS): prioridade máxima — dono de empresa
  -- não pode receber membership de convite comum nem cair no master owner.
  SELECT * INTO matched_license
  FROM public.company_licenses
  WHERE invited_email IS NOT NULL
    AND lower(invited_email) = lower(NEW.email)
    AND owner_user_id IS NULL
    AND status = 'active'
    AND invite_used_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF matched_license.id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    UPDATE public.company_licenses
    SET owner_user_id = NEW.id,
        invite_used_at = now(),
        updated_at = now()
    WHERE id = matched_license.id;

    RETURN NEW;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
