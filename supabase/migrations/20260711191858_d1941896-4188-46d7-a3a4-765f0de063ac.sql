
DO $$ BEGIN
  DROP POLICY IF EXISTS "crm-media owner read" ON storage.objects;
  DROP POLICY IF EXISTS "crm-media owner insert" ON storage.objects;
  DROP POLICY IF EXISTS "crm-media owner update" ON storage.objects;
  DROP POLICY IF EXISTS "crm-media owner delete" ON storage.objects;
END $$;

CREATE POLICY "crm-media owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);
