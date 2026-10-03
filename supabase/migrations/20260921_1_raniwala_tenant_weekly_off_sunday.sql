-- Bug: every Raniwala employee, at every outlet, was shown as "Weekend" on
-- Monday — not just Delhi Experience Centre, whose written policy is the
-- only outlet actually off on Monday (20260917_2_raniwala_timing_attendance_
-- policy.sql already set outlets.weekly_off_days = ARRAY[1] for Delhi and
-- ARRAY[0] for Office/Factory Staff).
--
-- Root cause had two parts:
--   1. Several front-end pages (Attendance, My Attendance, Employee
--      Calendar) called isTenantWeeklyOff(date, tenant) without passing the
--      employee's outlet, so the outlet-level override in outlets.
--      weekly_off_days was never consulted — every employee fell back to
--      the tenant-wide tenants.weekly_off_days. Fixed in application code
--      (now passes each employee's own outlet through).
--   2. tenants.weekly_off_days for Raniwala itself held Monday (ARRAY[1])
--      instead of the correct Sunday-only default (ARRAY[0]) that Office,
--      Factory, and Gurgaon (still "yet to plan" per the policy doc, so it
--      falls back to this tenant default) should use. With bug #1 fixed,
--      that wrong tenant-wide value would otherwise now surface as every
--      non-Delhi outlet being off Sunday AND Monday, or Monday only,
--      instead of Sunday only.
--
-- This migration corrects part 2: resets Raniwala's tenant-wide weekly off
-- back to Sunday. Delhi's own outlet-level override (Monday) is untouched
-- and continues to take precedence for that outlet only.
DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  UPDATE tenants SET
    weekly_off_days = ARRAY[0]::smallint[],
    weekly_off_day = 0
  WHERE id = v_tenant;
END $$;
