-- Turns on the real-time weekly-off comp-off grant (added in
-- 20260917_1_realtime_comp_off_grant.sql, wired into supabase/functions/
-- essl-punch/index.ts and attendanceService.js clockIn()) for Raniwala
-- Jewellers: any employee who punches in on their weekly off now earns one
-- comp-off credit immediately (profiles.comp_off_balance +1 via
-- adjust_comp_off_balance), instead of waiting for the month-end settlement
-- run in PayrollPage.jsx (which is skipped automatically once this flag is
-- on, per its own guard on tenant.auto_comp_off_on_weekly_off_worked).
--
-- This applies to every Raniwala employee regardless of CTC — the
-- HIGH_SALARY_THRESHOLD gate that normally limits who can request Comp Off
-- on the My Leaves page is bypassed for Raniwala specifically in
-- src/pages/employee/MyLeavesPage.jsx (isRaniwalaTenant check).

DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  UPDATE tenants SET auto_comp_off_on_weekly_off_worked = true WHERE id = v_tenant;
END $$;
