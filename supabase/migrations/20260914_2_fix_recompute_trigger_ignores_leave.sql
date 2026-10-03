-- =============================================================
-- Root-cause fix for approved leave still showing as Absent/Present.
--
-- trg_recompute_attendance_from_punches (BEFORE UPDATE ON attendance) is a
-- trigger that exists in the live database but was never captured in this
-- repo's tracked migrations. It unconditionally recalculates NEW.status
-- from that row's punches on every UPDATE (present/half-day/absent based
-- on total_hours vs the tenant's thresholds), for any role other than
-- admin/manager/superadmin.
--
-- This silently overwrote the 'Leave' status written by
-- 20260914_1_leave_approval_marks_attendance.sql's fix: the moment that
-- fix's INSERT ... ON CONFLICT (profile_id, date) DO UPDATE hit an
-- *existing* attendance row (already there from the nightly absent sweep,
-- a punch, etc.), Postgres runs it as an UPDATE, firing this trigger,
-- which recomputed status from the (nonexistent) punches on a leave day
-- and reverted it straight back to 'Absent'. A fresh INSERT with no
-- existing row was unaffected (this trigger only fires BEFORE UPDATE, not
-- BEFORE INSERT) -- which is why the bug was inconsistent depending on
-- whether a row already existed for that date.
--
-- Fix: short-circuit the recompute whenever the day falls inside an
-- Approved leave_requests row for that profile -- force status to 'Leave'
-- and skip the punch-based calculation entirely. This applies before the
-- existing admin/manager/superadmin bypass so it can't be second-guessed
-- by a role check, and it applies regardless of *who/what* issued the
-- UPDATE (the approval flow's upsert, a manual admin edit, a regularize
-- request, etc.) -- an approved leave should always win.
-- =============================================================

CREATE OR REPLACE FUNCTION trg_recompute_attendance_from_punches()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_total numeric := 0;
  v_half  numeric;
  v_full  numeric;
  v_ins   text[];
  v_outs  text[];
  i       int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM leave_requests lr
    WHERE lr.profile_id = NEW.profile_id
      AND lr.status = 'Approved'
      AND NEW.date BETWEEN lr.start_date AND lr.end_date
  ) THEN
    NEW.status := 'Leave';
    RETURN NEW;
  END IF;

  IF my_role() IN ('admin','manager','superadmin') THEN
    RETURN NEW; -- trust manual admin corrections
  END IF;

  SELECT array_agg(punch_time ORDER BY punch_time) INTO v_ins
    FROM punches WHERE attendance_id = NEW.id AND punch_type = 'in';
  SELECT array_agg(punch_time ORDER BY punch_time) INTO v_outs
    FROM punches WHERE attendance_id = NEW.id AND punch_type = 'out';

  IF v_ins IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_ins, 1) LOOP
      IF v_outs IS NOT NULL AND i <= array_length(v_outs, 1) THEN
        -- Overnight shift (e.g. in 22:00, out 06:00 next day) makes a naive
        -- time-time subtraction negative; wrap past midnight instead of
        -- letting GREATEST(...,0) below silently zero the whole shift. Keeps
        -- this in sync with lib/helpers.ts diffHours, which wraps the same way.
        v_total := v_total + (
          (EXTRACT(EPOCH FROM (v_outs[i]::time - v_ins[i]::time))::numeric % 86400 + 86400) % 86400
        ) / 3600.0;
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(min_half_day_hours, 4), COALESCE(min_full_day_hours, 8)
    INTO v_half, v_full FROM tenants WHERE id = NEW.tenant_id;

  NEW.total_hours := GREATEST(round(v_total * 100) / 100, 0);
  -- Boundary matches the client's own convention (services/attendanceService.ts
  -- clockOut/applyRegularization both use >=), so this trigger's recompute
  -- can't silently downgrade a status the client just computed for the same hours.
  NEW.status := CASE
    WHEN NEW.total_hours >= v_full THEN 'Present'
    WHEN NEW.total_hours >= v_half THEN 'Half Day'
    ELSE 'Absent'
  END;
  RETURN NEW;
END;
$$;


-- ── Re-run the backfill now that the trigger can no longer fight it ──────
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
