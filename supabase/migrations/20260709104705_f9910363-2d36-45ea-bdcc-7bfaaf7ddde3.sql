
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS max_members integer NOT NULL DEFAULT 5;

-- Permite que o próprio member leia seu registro (sidebar/guard precisa saber se está ativo)
DROP POLICY IF EXISTS "org_members self read" ON public.org_members;
CREATE POLICY "org_members self read" ON public.org_members
  FOR SELECT USING (member_id = auth.uid() OR owner_id = auth.uid());

-- Permite que o próprio member leia suas permissões
DROP POLICY IF EXISTS "user_permissions self read" ON public.user_permissions;
CREATE POLICY "user_permissions self read" ON public.user_permissions
  FOR SELECT USING (user_id = auth.uid() OR owner_id = auth.uid());
