-- Migration to support temporary password visibility and other requested features
-- 1. Add columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS temp_password text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weekly_holiday text DEFAULT 'Sunday';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shift_start text; -- Employee-specific override
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shift_end text;   -- Employee-specific override

-- 2. Add geofencing to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS geofence_lat numeric;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS geofence_lng numeric;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS geofence_radius int DEFAULT 500; -- in meters
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS half_day_min_hours numeric DEFAULT 4;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS full_day_min_hours numeric DEFAULT 8;

-- 3. Leave Requests Table
CREATE TABLE IF NOT EXISTS leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_type      text NOT NULL CHECK (leave_type IN ('Casual','Sick','Vacation','Other')),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by     uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leaves: admin sees tenant" ON leave_requests FOR SELECT USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "leaves: employee sees own" ON leave_requests FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY "leaves: employee can insert own" ON leave_requests FOR INSERT WITH CHECK (profile_id = auth.uid());
CREATE POLICY "leaves: admin can update tenant" ON leave_requests FOR UPDATE USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

-- 4. Update insert_employee_profile to store temp_password
CREATE OR REPLACE FUNCTION insert_employee_profile(
  p_user_id     uuid,
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text DEFAULT '',
  p_department  text DEFAULT '',
  p_designation text DEFAULT '',
  p_ctc         numeric DEFAULT 0,
  p_join_date   date DEFAULT NULL,
  p_bank_acc    text DEFAULT '',
  p_pan         text DEFAULT '',
  p_aadhar      text DEFAULT '',
  p_temp_password text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Verify the caller is an admin/manager and get their tenant
  SELECT tenant_id INTO v_tenant_id
  FROM profiles
  WHERE id = auth.uid() AND role IN ('admin', 'manager', 'superadmin');

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Only admins and managers can create employees';
  END IF;

  INSERT INTO profiles (
    id, tenant_id,
    first_name, last_name, email, phone,
    department, designation, ctc, join_date,
    bank_acc, pan, aadhar,
    role, status, must_change_password,
    temp_password
  ) VALUES (
    p_user_id, v_tenant_id,
    p_first_name, p_last_name, p_email, COALESCE(p_phone,''),
    COALESCE(p_department,''), COALESCE(p_designation,''),
    COALESCE(p_ctc, 0), p_join_date,
    COALESCE(p_bank_acc,''), COALESCE(p_pan,''), COALESCE(p_aadhar,''),
    'employee', 'Active', true,
    p_temp_password
  );
END;
$$;

-- 5. Clear temp_password when must_change_password is cleared
CREATE OR REPLACE FUNCTION clear_must_change_password()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET    must_change_password = false,
         temp_password = NULL
  WHERE  id = auth.uid();
END;
$$;
