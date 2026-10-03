-- =============================================================
-- Simpler, lower-risk fix for the same problem as
-- 20260914_2_fix_recompute_trigger_ignores_leave.sql: rather than editing
-- the existing (larger, harder-to-paste-safely) trg_recompute_attendance_from_punches
-- function, add a small separate trigger that runs AFTER it (Postgres fires
-- same-timing triggers in alphabetical order by trigger name; "zz_" sorts
-- after "recompute_attendance_from_punches" and "trg_...") and simply forces
-- the status back to 'Leave' whenever the row's date falls inside an
-- Approved leave_requests entry for that profile -- undoing whatever the
-- punch-based recompute just calculated.
-- Also fires BEFORE INSERT so a fresh attendance row inserted for a leave
-- day is correct from the start, independent of the application code.
-- =============================================================

CREATE OR REPLACE FUNCTION trg_leave_overrides_attendance_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM leave_requests lr
    WHERE lr.profile_id = NEW.profile_id
      AND lr.status = 'Approved'
      AND NEW.date BETWEEN lr.start_date AND lr.end_date
  ) THEN
    NEW.status := 'Leave';
    NEW.total_hours := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_leave_overrides_attendance_status ON attendance;
CREATE TRIGGER zz_leave_overrides_attendance_status
  BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION trg_leave_overrides_attendance_status();
