-- ============================================================
-- Work From Home requests
-- Employee picks a date range + reason; stays Pending until a
-- manager/admin approves it. Only once Approved does the employee
-- dashboard's geofence check get bypassed for those dates — this is a
-- security-relevant bypass, so unlike the self-approval tier used for
-- attendance regularization, WFH always needs a human reviewer.
-- ============================================================

CREATE TABLE IF NOT EXISTS wfh_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfh_requests_date_range_chk CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_wfh_requests_tenant ON wfh_requests(tenant_id, profile_id);
-- Backs the employee dashboard's "am I approved for WFH today" lookup on every load.
CREATE INDEX IF NOT EXISTS idx_wfh_requests_approved_range ON wfh_requests(profile_id, from_date, to_date) WHERE status = 'Approved';

ALTER TABLE wfh_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wfh_requests: own or admin/manager can select"
  ON wfh_requests FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));

-- status = 'Pending' is enforced here (not just the column default) so an employee
-- can't self-approve their own geofence bypass by inserting with status='Approved'.
CREATE POLICY "wfh_requests: employee can insert own pending"
  ON wfh_requests FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND profile_id = auth.uid() AND status = 'Pending');

CREATE POLICY "wfh_requests: admin/manager can update"
  ON wfh_requests FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "wfh_requests: employee can cancel own pending"
  ON wfh_requests FOR DELETE
  USING (tenant_id = my_tenant_id() AND profile_id = auth.uid() AND status = 'Pending');

CREATE POLICY "wfh_requests: admin can delete"
  ON wfh_requests FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));
