-- Batch of fixes from the full production audit (2026-07-14):
--
-- 1. adjust_comp_off_balance: atomic increment/decrement RPC, replacing the
--    read-then-write races in leaveService.js (updateLeaveStatus) and
--    compOffService.js (settleWeeklyOffForMonth) that could lose an update
--    under concurrent approvals.
-- 2. Indexes on special_requests / employee_promotions — both had none on
--    tenant_id/profile_id despite every RLS policy and query filtering on
--    exactly those columns.
-- 3. UNIQUE(profile_id, date) on attendance — required for the upsert-based
--    fix (in attendanceService.js: clockIn / saveManualAttendance /
--    regularizeAttendance) to a select-then-insert race that could create
--    duplicate attendance rows for the same employee/day. Verified zero
--    existing duplicate (profile_id, date) groups before adding this.

CREATE OR REPLACE FUNCTION adjust_comp_off_balance(p_profile_id uuid, p_delta numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_role   text;
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  SELECT role, tenant_id INTO v_caller_role, v_caller_tenant FROM profiles WHERE id = auth.uid();
  SELECT tenant_id INTO v_target_tenant FROM profiles WHERE id = p_profile_id;

  IF v_target_tenant IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF NOT (v_caller_role IN ('admin','manager','superadmin') AND v_caller_tenant = v_target_tenant) THEN
    RAISE EXCEPTION 'Not authorized to adjust this employee''s comp-off balance';
  END IF;

  UPDATE profiles
  SET comp_off_balance = GREATEST(0, COALESCE(comp_off_balance, 0) + p_delta)
  WHERE id = p_profile_id;
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_comp_off_balance(uuid, numeric) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_special_requests_tenant    ON special_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_special_requests_profile   ON special_requests(profile_id);
CREATE INDEX IF NOT EXISTS idx_employee_promotions_tenant  ON employee_promotions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_promotions_profile ON employee_promotions(profile_id);

ALTER TABLE attendance ADD CONSTRAINT attendance_profile_date_unique UNIQUE (profile_id, date);
