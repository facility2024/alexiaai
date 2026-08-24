CREATE POLICY "Staff can insert clients" ON public.clients FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'specialist'::app_role));

CREATE POLICY "Staff can delete clients" ON public.clients FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'specialist'::app_role));