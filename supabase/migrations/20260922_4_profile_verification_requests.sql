-- ============================================================
-- Profile Verification Requests (Bank / PAN / Aadhar)
--
-- Employees can self-edit their Bank/PAN/Aadhar details from the mobile
-- app, but a change never takes effect immediately — it's staged here as a
-- Pending request until HR or the reporting manager approves it, at which
-- point the new values are copied into `profiles` and a fresh verified
-- timestamp is stamped. Rejecting only changes this row; the prior value
-- and verified timestamp on `profiles` are left untouched either way.
--
-- Bank Details (bank_acc+bank_name+ifsc_code), PAN, and Aadhar are tracked
-- and approved independently (three separate field_groups), so editing one
-- never disturbs the verified status of the other two.
--
-- profiles UPDATE RLS already lets any admin/manager/superadmin update any
-- profile in their tenant (see 20260821_1_critical_security_fixes.sql), so
-- approval is a plain client-side update from an admin/manager session —
-- no SECURITY DEFINER RPC needed.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bank_verified_at   timestamptz,
  ADD COLUMN IF NOT EXISTS pan_verified_at    timestamptz,
  ADD COLUMN IF NOT EXISTS aadhar_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS profile_verification_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  field_group  text NOT NULL CHECK (field_group IN ('bank','pan','aadhar')),
  old_value    jsonb,               -- snapshot at submit time, for HR's old-vs-new diff
  new_value    jsonb NOT NULL,      -- {bank_acc,bank_name,ifsc_code} | {pan} | {aadhar}
  status       text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  reviewed_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pvr_tenant ON profile_verification_requests(tenant_id, profile_id);

-- One live Pending request per (employee, field_group) at a time — a second
-- edit to the same field group must wait for the first to be reviewed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pvr_one_pending_per_group
  ON profile_verification_requests(profile_id, field_group) WHERE status = 'Pending';

ALTER TABLE profile_verification_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pvr: own or admin/manager can select" ON profile_verification_requests;
CREATE POLICY "pvr: own or admin/manager can select"
  ON profile_verification_requests FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));

-- status = 'Pending' is enforced here (not just the column default) so an
-- employee can't self-approve their own bank/PAN/Aadhar change.
DROP POLICY IF EXISTS "pvr: employee can insert own pending" ON profile_verification_requests;
CREATE POLICY "pvr: employee can insert own pending"
  ON profile_verification_requests FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND profile_id = auth.uid() AND status = 'Pending');

DROP POLICY IF EXISTS "pvr: admin/manager can update" ON profile_verification_requests;
CREATE POLICY "pvr: admin/manager can update"
  ON profile_verification_requests FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

DROP POLICY IF EXISTS "pvr: employee can cancel own pending" ON profile_verification_requests;
CREATE POLICY "pvr: employee can cancel own pending"
  ON profile_verification_requests FOR DELETE
  USING (tenant_id = my_tenant_id() AND profile_id = auth.uid() AND status = 'Pending');

DROP POLICY IF EXISTS "pvr: admin can delete" ON profile_verification_requests;
CREATE POLICY "pvr: admin can delete"
  ON profile_verification_requests FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

-- New feature-toggle registry entry. No company_feature_toggles row means
-- enabled by default for every existing tenant — nothing regresses.
INSERT INTO features (key, name, category, description, sort_order) VALUES
  ('profile_verification', 'Profile Verification (Bank/PAN/Aadhar)', 'General',
   'Employee self-service edit of Bank/PAN/Aadhar (from the mobile app) with HR/manager approval.', 240)
ON CONFLICT (key) DO NOTHING;
