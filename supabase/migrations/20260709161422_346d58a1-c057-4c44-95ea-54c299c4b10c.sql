
-- Função que retorna o "dono principal" do sistema (admin mais antigo)
CREATE OR REPLACE FUNCTION public.get_master_owner()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'admin'
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

-- Novo trigger: cria profile e adiciona como pendente na equipe do admin principal
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  master_id uuid;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);

  master_id := public.get_master_owner();

  -- Se existe um dono principal e o novo user não é ele próprio, adiciona como pendente
  IF master_id IS NOT NULL AND master_id <> NEW.id THEN
    INSERT INTO public.org_members (owner_id, member_id, role, active)
    VALUES (master_id, NEW.id, 'agent', false)
    ON CONFLICT (owner_id, member_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: usuários já existentes que ainda não fazem parte de nenhuma equipe
INSERT INTO public.org_members (owner_id, member_id, role, active)
SELECT public.get_master_owner(), p.id, 'agent', false
FROM public.profiles p
WHERE public.get_master_owner() IS NOT NULL
  AND p.id <> public.get_master_owner()
  AND NOT EXISTS (
    SELECT 1 FROM public.org_members om WHERE om.member_id = p.id
  )
ON CONFLICT (owner_id, member_id) DO NOTHING;
