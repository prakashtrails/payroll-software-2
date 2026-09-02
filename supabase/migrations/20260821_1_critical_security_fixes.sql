-- =============================================================
-- Critical security fixes from the 2026-08-21 backend audit.
-- Every change here is additive/tightening only: no table is dropped, no
-- existing row is modified, and every policy this touches is DROP POLICY IF
-- EXISTS + CREATE POLICY (same pattern as every prior RLS migration in this
-- repo), so it's safe to re-run and safe to roll back by re-applying the
-- previous definition from 20260810_rls_wrap_functions.sql /
-- 20260816_2_unlimited_leave_and_balance_detail.sql.
--
-- Companion code fix (not in this file): supabase/functions/create-employee-user
-- got a target-role allowlist and had its cross-tenant profile-hijack path
-- removed — redeploy that function alongside this migration.
-- =============================================================

-- ---------------------------------------------------------------
-- 1) leave_balances_detail was created (20260816_2) without
--    security_invoker, so it runs as its `postgres` owner and bypasses
--    leave_ledger's RLS entirely -- inheriting PostgREST's default anon
--    SELECT grant. Same bug already fixed on the sibling `leave_balances`
--    view; this migration was never extended to cover this one.
--    Net effect before this fix: any unauthenticated request (anon key
--    only, no login) could read every tenant's leave balances.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW leave_balances_detail
WITH (security_invoker = on) AS
  SELECT
    tenant_id, profile_id, leave_type_id,
    SUM(days) AS balance,
    SUM(CASE WHEN days > 0 THEN days ELSE 0 END) AS allocated,
    SUM(CASE WHEN days < 0 THEN -days ELSE 0 END) AS used
  FROM leave_ledger
  GROUP BY tenant_id, profile_id, leave_type_id;

-- ---------------------------------------------------------------
-- 2) profiles: admin/manager can update tenant -- WITH CHECK only ever
--    blocked setting role='superadmin'. It never blocked a `manager`
--    setting role='admin', so any manager could self-serve promote a
--    tenant peer to admin through the ordinary Employees page (a direct
--    `profiles` UPDATE, not the create-employee-user edge function, so the
--    function's own role guard never even runs).
--    Fix: a caller may only assign a role at or below their own level.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "profiles: admin/manager can update tenant" ON profiles;
CREATE POLICY "profiles: admin/manager can update tenant" ON profiles
  FOR UPDATE
  USING (
    (tenant_id = (select my_tenant_id()))
    AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))
  )
  WITH CHECK (
    (tenant_id = (select my_tenant_id()))
    AND (
      (select my_role()) = 'superadmin'::text
      OR ((select my_role()) = 'admin'::text AND role = ANY (ARRAY['employee'::text, 'manager'::text, 'admin'::text]))
      OR ((select my_role()) = 'manager'::text AND role = ANY (ARRAY['employee'::text, 'manager'::text]))
    )
  );

-- ---------------------------------------------------------------
-- 3) punches: employee can insert own -- no restriction on `source`, so an
--    employee's own self-service punch (via the normal clock-in/out flow,
--    which always uses the 'app' default) could instead be inserted
--    claiming source='device' or 'manual', impersonating a biometric or
--    admin-entered record. essl-punch and manual-entry paths both write via
--    the service-role client, which bypasses RLS entirely, so restricting
--    this policy to source='app' only affects employee-initiated inserts.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "punches: employee can insert own" ON punches;
CREATE POLICY "punches: employee can insert own" ON punches
  FOR INSERT
  WITH CHECK (
    (source = 'app'::text)
    AND (attendance_id IN (
      SELECT attendance.id FROM attendance WHERE attendance.profile_id = (select auth.uid())
    ))
  );

-- ---------------------------------------------------------------
-- 4) attendance: employee can update own -- USING only checks row
--    ownership (profile_id = auth.uid()); there was no column-level
--    restriction, so an employee's own clock-out/self-regularize UPDATE
--    call (which legitimately only ever touches total_hours/status/
--    location/punch_out_lat/punch_out_lng/out_of_geofence -- see
--    clockOut() and the self-tier path through regularizeAttendance() in
--    src/services/attendanceService.js) could instead be replaced with a
--    raw REST PATCH rewriting tenant_id, profile_id, or date.
--    RLS policies can restrict which ROWS are reachable but not which
--    COLUMNS change within an allowed row, so this needs a trigger rather
--    than a WITH CHECK clause. Admin/manager/superadmin are exempt --
--    saveManualAttendance()'s upsert-as-update path needs full column
--    access for corrections. `location` is deliberately NOT restricted:
--    it's a cosmetic label ("Office" / "Office (Regularized)"), not an
--    authorization boundary, and the self-regularize flow writes it as
--    the employee's own session.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION attendance_employee_update_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]) THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id    IS DISTINCT FROM OLD.tenant_id
  OR NEW.profile_id   IS DISTINCT FROM OLD.profile_id
  OR NEW.date         IS DISTINCT FROM OLD.date
  OR NEW.punch_in_lat IS DISTINCT FROM OLD.punch_in_lat
  OR NEW.punch_in_lng IS DISTINCT FROM OLD.punch_in_lng
  OR NEW.auto_marked  IS DISTINCT FROM OLD.auto_marked
  THEN
    RAISE EXCEPTION 'Not permitted to change this field on your own attendance record.';
  END IF;

  -- Mirrors clockOut()'s own rule: out_of_geofence may only ever flip
  -- false -> true, never back to false.
  IF OLD.out_of_geofence = true AND NEW.out_of_geofence = false THEN
    RAISE EXCEPTION 'Not permitted to change this field on your own attendance record.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_employee_update_guard ON attendance;
CREATE TRIGGER trg_attendance_employee_update_guard
  BEFORE UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION attendance_employee_update_guard();
