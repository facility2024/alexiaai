
-- Restringir SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Storage policies para bucket case-documents
CREATE POLICY "Staff can read case documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'case-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'))
  );

CREATE POLICY "Staff can upload case documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'case-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'))
  );

CREATE POLICY "Staff can delete case documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'case-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist'))
  );
