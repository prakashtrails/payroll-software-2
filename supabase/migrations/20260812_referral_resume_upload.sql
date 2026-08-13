-- CV upload for candidate referrals. No general email infra exists in this
-- app (only OTP-specific SMTP) — "sending the CV to HR" means HR can see and
-- download it from the Refer page's All Referrals tab, gated by storage RLS,
-- same as every other "send to HR" feature built so far (helpdesk tickets etc).

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS resume_file_path text NOT NULL DEFAULT '';

INSERT INTO storage.buckets (id, name, public)
VALUES ('referral-resumes', 'referral-resumes', false)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {tenant_id}/{referred_by_profile_id}/{timestamp}-{filename}
-- — lets both policies below check tenant/ownership from the path alone,
-- without a subquery back to the referrals table.
CREATE POLICY "referral-resumes: tenant member can upload own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'referral-resumes'
    AND (storage.foldername(name))[1] = (select my_tenant_id())::text
    AND (storage.foldername(name))[2] = (select auth.uid())::text
  );

CREATE POLICY "referral-resumes: uploader or admin/manager can read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'referral-resumes'
    AND (storage.foldername(name))[1] = (select my_tenant_id())::text
    AND (
      (storage.foldername(name))[2] = (select auth.uid())::text
      OR (select my_role()) IN ('admin','manager','superadmin')
    )
  );
