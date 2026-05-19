-- Add leave_allocation column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS leave_allocation numeric DEFAULT 0;

-- Update the insert_employee_profile RPC to accept and use p_leave_allocation
DROP FUNCTION IF EXISTS insert_employee_profile(uuid,uuid,text,text,text,text,text,text,numeric,date,text,text,text,text);
DROP FUNCTION IF EXISTS insert_employee_profile(uuid,uuid,text,text,text,text,text,text,numeric,date,text,text,text,text,numeric);

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
  p_temp_password text DEFAULT NULL,
  p_leave_allocation numeric DEFAULT 0
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
    leave_allocation,
    role, status, must_change_password
  ) VALUES (
    p_user_id, p_tenant_id,
    p_first_name, p_last_name, p_email, COALESCE(p_phone,''),
    COALESCE(p_department,''), COALESCE(p_designation,''),
    COALESCE(p_ctc, 0), p_join_date,
    COALESCE(p_bank_acc,''), COALESCE(p_pan,''), COALESCE(p_aadhar,''), p_temp_password,
    p_leave_allocation,
    'employee', 'Active', true
  );
END;
$$;

-- Tell PostgREST to reload the schema cache so the new column is immediately available
NOTIFY pgrst, 'reload schema';
