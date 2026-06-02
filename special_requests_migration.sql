-- Special Requests: Overtime on Holidays & Late Arrival
CREATE TABLE IF NOT EXISTS special_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('Overtime', 'Late Arrival')),
  request_date DATE NOT NULL,
  reason TEXT,
  late_hours TEXT DEFAULT '0-10 min',
  overtime_hours NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  approved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE special_requests ENABLE ROW LEVEL SECURITY;

-- Employees see their own requests
CREATE POLICY "employee_see_own_special_requests" ON special_requests
  FOR SELECT USING (profile_id = auth.uid());

-- Employees can insert their own requests
CREATE POLICY "employee_insert_special_requests" ON special_requests
  FOR INSERT WITH CHECK (profile_id = auth.uid());

-- Admins/managers see all requests in their tenant
CREATE POLICY "admin_see_tenant_special_requests" ON special_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.tenant_id = special_requests.tenant_id
        AND profiles.role IN ('admin', 'manager', 'superadmin')
    )
  );

-- Admins/managers can update (approve/reject) requests
CREATE POLICY "admin_update_special_requests" ON special_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.tenant_id = special_requests.tenant_id
        AND profiles.role IN ('admin', 'manager', 'superadmin')
    )
  );
