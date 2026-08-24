
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS source_pdf_path text;

CREATE POLICY "contract-templates owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "contract-templates owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "contract-templates owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "contract-templates owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'contract-templates' AND (storage.foldername(name))[1] = auth.uid()::text);
