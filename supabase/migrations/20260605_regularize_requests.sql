-- Employee-initiated attendance regularization requests
CREATE TABLE IF NOT EXISTS regularize_requests (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid        REFERENCES tenants(id)  ON DELETE CASCADE NOT NULL,
  profile_id     uuid        REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date           date        NOT NULL,
  clock_in_time  time,
  clock_out_time time,
  reason         text        NOT NULL,
  status         text        NOT NULL DEFAULT 'Pending'
                             CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by    uuid        REFERENCES profiles(id),
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_req_tenant  ON regularize_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reg_req_profile ON regularize_requests(profile_id);

ALTER TABLE regularize_requests ENABLE ROW LEVEL SECURITY;

-- Employees can submit requests for themselves
CREATE POLICY "employee_insert_own" ON regularize_requests
  FOR INSERT WITH CHECK (profile_id = auth.uid());

-- Employees can view their own requests
CREATE POLICY "employee_select_own" ON regularize_requests
  FOR SELECT USING (profile_id = auth.uid());

-- Admins and managers can view all requests in their tenant
CREATE POLICY "admin_manager_select_tenant" ON regularize_requests
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager', 'superadmin')
    )
  );

-- Admins and managers can update (approve/reject) requests in their tenant
CREATE POLICY "admin_manager_update_tenant" ON regularize_requests
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager', 'superadmin')
    )
  );
