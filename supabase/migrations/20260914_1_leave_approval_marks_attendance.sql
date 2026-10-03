-- =============================================================
-- Fix: approving a leave request never touched the `attendance` table.
--
-- Problem: record_leave_deduction() (20260813_1_leave_ledger.sql) only ever
-- wrote a `leave_ledger` row to track the employee's balance. Nothing ever
-- inserted/updated an `attendance` row with status = 'Leave' for the days
-- covered by an approved leave request. Meanwhile:
--   - the nightly sweep (mark_attendance_from_punches,
--     20260813_2_attendance_automation.sql) inserts an 'Absent' row for
--     every active employee that has no attendance row yet for a past date
--     -- with no idea a leave was approved for that date;
--   - the employee's own calendar/summary (MyAttendancePage.jsx) and the
--     admin/manager team views (AttendancePage.jsx,
--     fetchTodayAttendanceSummary) all key purely off attendance.status,
--     treating "no row" as Absent.
-- Net effect: an approved leave shows up as an absence everywhere that
-- reads the attendance table, even though the leave itself is correctly
-- Approved in leave_requests / My Leaves.
--
-- Fix: record_leave_deduction() now also upserts an attendance row with
-- status = 'Leave' for every calendar day in [start_date, end_date] as part
-- of approving the request (self-approval, manager approval, and admin
-- approval all funnel through this one function already -- see
-- src/services/leaveService.js requestLeave()/updateLeaveStatus()). This:
--   - immediately reflects on the calendar/summary the moment a leave is
--     approved, not just after the nightly sweep runs;
--   - naturally blocks the nightly sweep from later overwriting that day
--     with 'Absent', since a row already exists (NOT EXISTS check);
--   - overwrites a pre-existing 'Absent' row (e.g. the sweep already ran
--     before a late approval) with 'Leave', which is the desired outcome.
-- Comp Off is included too -- it's still a day off -- so the attendance
-- upsert runs before the existing Comp-Off early-return that only skips
-- the *ledger* deduction (Comp Off balance is tracked separately via
-- adjust_comp_off_balance, not leave_ledger).
-- =============================================================

CREATE OR REPLACE FUNCTION record_leave_deduction(p_leave_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req    RECORD;
  v_type   uuid;
  v_days   numeric;
  v_day    date;
BEGIN
  SELECT * INTO v_req FROM leave_requests WHERE id = p_leave_request_id;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF v_req.status <> 'Approved' THEN RAISE EXCEPTION 'Leave request is not Approved'; END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_req.tenant_id AND role IN ('admin','manager','superadmin'))
    OR (auth.uid() = v_req.profile_id AND v_req.required_approver_role = 'self')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Mark every day of the approved leave as 'Leave' on the attendance
  -- calendar. Idempotent by nature of the upsert -- safe to re-run.
  FOR v_day IN SELECT generate_series(v_req.start_date, v_req.end_date, interval '1 day')::date LOOP
    INSERT INTO attendance (tenant_id, profile_id, date, status, total_hours, location)
    VALUES (v_req.tenant_id, v_req.profile_id, v_day, 'Leave', 0, 'Office')
    ON CONFLICT (profile_id, date) DO UPDATE SET status = 'Leave', total_hours = 0;
  END LOOP;

  IF v_req.leave_type = 'Comp Off' THEN RETURN; END IF; -- balance handled by adjust_comp_off_balance instead

  -- Idempotent — a second call for the same request is a no-op.
  IF EXISTS (SELECT 1 FROM leave_ledger WHERE leave_request_id = p_leave_request_id) THEN RETURN; END IF;

  SELECT id INTO v_type FROM leave_types WHERE tenant_id = v_req.tenant_id AND name = v_req.leave_type LIMIT 1;
  IF v_type IS NULL THEN RETURN; END IF; -- no matching configured leave type — nothing to ledger

  v_days := (v_req.end_date - v_req.start_date) + 1;

  INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, effective_date, leave_request_id, created_by)
  VALUES (v_req.tenant_id, v_req.profile_id, v_type, 'Deduction', -v_days, v_req.start_date, p_leave_request_id, auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION record_leave_deduction(uuid) TO authenticated;


-- ── Nightly sweep: never stomp a day that already has an approved-leave
-- attendance row. The NOT EXISTS check already covers this once the fix
-- above has run for a request, but if the sweep and an approval ever land
-- on the same day in the same transaction window, prefer the leave. ──
CREATE OR REPLACE FUNCTION mark_attendance_from_punches(p_date date DEFAULT CURRENT_DATE - 1)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int := 0;
  v_emp   RECORD;
BEGIN
  FOR v_emp IN
    SELECT p.id, p.tenant_id
    FROM profiles p
    WHERE p.status = 'Active'
      AND p.role IN ('employee','admin','manager')
      AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.profile_id = p.id AND a.date = p_date)
      AND NOT EXISTS (
        SELECT 1 FROM leave_requests lr
        WHERE lr.profile_id = p.id AND lr.status = 'Approved'
          AND p_date BETWEEN lr.start_date AND lr.end_date
      )
  LOOP
    INSERT INTO attendance (tenant_id, profile_id, date, status, total_hours, location, auto_marked)
    VALUES (v_emp.tenant_id, v_emp.id, p_date, 'Absent', 0, 'Office', true)
    ON CONFLICT (profile_id, date) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;


-- ── One-time backfill: fix attendance for leave requests approved before
-- this migration, which never got their days marked 'Leave' and may
-- currently show as 'Absent' (from the nightly sweep) or be missing a row
-- entirely (still counted absent client-side). Skips days outside a
-- sane 2-year window purely to bound the backfill's runtime. ──
DO $$
DECLARE
  v_req RECORD;
  v_day date;
BEGIN
  FOR v_req IN
    SELECT tenant_id, profile_id, start_date, end_date
    FROM leave_requests
    WHERE status = 'Approved'
      AND start_date >= CURRENT_DATE - INTERVAL '2 years'
  LOOP
    FOR v_day IN SELECT generate_series(v_req.start_date, v_req.end_date, interval '1 day')::date LOOP
      INSERT INTO attendance (tenant_id, profile_id, date, status, total_hours, location)
      VALUES (v_req.tenant_id, v_req.profile_id, v_day, 'Leave', 0, 'Office')
      ON CONFLICT (profile_id, date) DO UPDATE SET status = 'Leave', total_hours = 0;
    END LOOP;
  END LOOP;
END $$;
