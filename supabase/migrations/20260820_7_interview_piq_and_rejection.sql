-- PI Round requires collecting a PIQ Form from the candidate (a named,
-- collected artifact -- unlike BGV/police verification, which are just
-- status checkpoints, this gets a real upload, mirroring the existing
-- referral-resumes pattern). Technical Interview rejections need a logged
-- reason, matching the SOP's "recruiter must note the rejection reason".

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS piq_form_path text NOT NULL DEFAULT '';
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS rejection_reason text NOT NULL DEFAULT '';

ALTER TABLE interviews DROP CONSTRAINT IF EXISTS interviews_status_check;
ALTER TABLE interviews ADD CONSTRAINT interviews_status_check
  CHECK (status IN ('Scheduled', 'Completed', 'Cancelled', 'Rejected'));

ALTER TABLE interviews DROP CONSTRAINT IF EXISTS interviews_rejection_reason_check;
ALTER TABLE interviews ADD CONSTRAINT interviews_rejection_reason_check
  CHECK (status <> 'Rejected' OR rejection_reason <> '');

INSERT INTO storage.buckets (id, name, public)
VALUES ('piq-forms', 'piq-forms', false)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {tenant_id}/{timestamp}-{filename}. Uploader is always
-- HR/recruiter (admin/manager), never the candidate -- no per-uploader-
-- ownership branch needed, unlike referral-resumes.
DROP POLICY IF EXISTS "piq-forms: admin/manager can upload" ON storage.objects;
CREATE POLICY "piq-forms: admin/manager can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'piq-forms'
    AND (storage.foldername(name))[1] = (select my_tenant_id())::text
    AND (select my_role()) IN ('admin','manager','superadmin')
  );

DROP POLICY IF EXISTS "piq-forms: admin/manager can read" ON storage.objects;
CREATE POLICY "piq-forms: admin/manager can read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'piq-forms'
    AND (storage.foldername(name))[1] = (select my_tenant_id())::text
    AND (select my_role()) IN ('admin','manager','superadmin')
  );
