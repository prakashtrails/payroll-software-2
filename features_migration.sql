-- =============================================================
-- PayrollPro — Feature Integration Migration
-- =============================================================

-- 1. Create Shifts Table
CREATE TABLE IF NOT EXISTS shifts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  start_time   text NOT NULL DEFAULT '09:00',
  end_time     text NOT NULL DEFAULT '18:00',
  total_hours  numeric NOT NULL DEFAULT 9,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shifts: tenant members can read" ON shifts FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "shifts: admin can write" ON shifts FOR ALL USING (tenant_id = my_tenant_id() AND my_role() IN ('admin', 'manager'));

-- 2. Update Profiles Table
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS temp_password text,
  ADD COLUMN IF NOT EXISTS weekly_holiday text DEFAULT 'Sunday',
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;

-- 3. Update Tenants Table for Attendance Settings and Geo-fencing
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS min_half_day_hours numeric DEFAULT 4,
  ADD COLUMN IF NOT EXISTS min_full_day_hours numeric DEFAULT 8,
  ADD COLUMN IF NOT EXISTS geofence_lat numeric,
  ADD COLUMN IF NOT EXISTS geofence_lng numeric,
  ADD COLUMN IF NOT EXISTS geofence_radius numeric DEFAULT 100; -- in meters

-- 4. Update Attendance Table for Location Tracking
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS punch_in_lat numeric,
  ADD COLUMN IF NOT EXISTS punch_in_lng numeric,
  ADD COLUMN IF NOT EXISTS punch_out_lat numeric,
  ADD COLUMN IF NOT EXISTS punch_out_lng numeric;

-- 5. Helper Function to get shifts for current tenant
CREATE OR REPLACE FUNCTION get_tenant_shifts()
RETURNS SETOF shifts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM shifts WHERE tenant_id = my_tenant_id();
$$;

-- 6. Update insert_employee_profile to handle temp_password
-- We need to drop and recreate it because we are adding columns
DROP FUNCTION IF EXISTS insert_employee_profile(uuid,uuid,text,text,text,text,text,text,numeric,date,text,text,text,text);
CREATE OR REPLACE FUNCTION insert_employee_profile(
  p_user_id       uuid,
  p_tenant_id     uuid,
  p_first_name    text,
  p_last_name     text,
  p_email         text,
  p_phone         text DEFAULT '',
  p_department    text DEFAULT '',
  p_designation   text DEFAULT '',
  p_ctc           numeric DEFAULT 0,
  p_join_date     date DEFAULT NULL,
  p_bank_acc      text DEFAULT '',
  p_pan           text DEFAULT '',
  p_aadhar        text DEFAULT '',
  p_temp_password text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (
    id, tenant_id,
    first_name, last_name, email, phone,
    department, designation, ctc, join_date,
    bank_acc, pan, aadhar, temp_password,
    role, status, must_change_password
  ) VALUES (
    p_user_id, p_tenant_id,
    p_first_name, p_last_name, p_email, COALESCE(p_phone,''),
    COALESCE(p_department,''), COALESCE(p_designation,''),
    COALESCE(p_ctc, 0), p_join_date,
    COALESCE(p_bank_acc,''), COALESCE(p_pan,''), COALESCE(p_aadhar,''), p_temp_password,
    'employee', 'Active', true
  );
END;
$$;
