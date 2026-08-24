
DROP POLICY IF EXISTS "Staff can view all cases" ON public.cases;
DROP POLICY IF EXISTS "Staff can update cases" ON public.cases;

CREATE POLICY "Authenticated can view cases" ON public.cases
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert cases" ON public.cases
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update cases" ON public.cases
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Staff can delete cases" ON public.cases
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'specialist'::app_role));
