
-- Media columns on crm_messages (binary payload metadata)
ALTER TABLE public.crm_messages
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime text,
  ADD COLUMN IF NOT EXISTS size bigint,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS filename text;

-- Storage policies for crm-media bucket (per-user folder: {user_id}/...)
CREATE POLICY "crm-media owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "crm-media owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'crm-media' AND auth.uid()::text = (storage.foldername(name))[1]);
