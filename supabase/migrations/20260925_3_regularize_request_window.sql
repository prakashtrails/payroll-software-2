-- =============================================================
-- Regularize request window: an employee may only request regularization
-- for today or the recent past, not any date ever.
--
-- tenants.regularize_window_days = how many days, counting today, an
-- employee can still raise a request for. Default 2 = today + yesterday, so
-- a biometric punch-in forgotten yesterday can still be corrected today.
--
-- Enforced here (not only in the web/app JS) because the website and the
-- mobile app are separate codebases writing the same regularize_requests
-- table -- a rule in the DB applies to both, and to direct REST calls.
-- "Today" is Asia/Kolkata, matching the birthday/celebration RPCs.
--
-- Scoped to auth.uid() = NEW.profile_id (an employee's own request), same as
-- trg_enforce_regularize_request_approval_tier, so admin-entered rows and
-- service-role writes are untouched. Admin/HR direct regularization
-- (regularizeAttendance on the attendance table) is not limited.
--
-- Both clients insert the request row BEFORE applying a self-approved
-- attendance change, so a rejection here leaves attendance untouched.
-- =============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS regularize_window_days integer NOT NULL DEFAULT 2;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_regularize_window_days_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_regularize_window_days_check CHECK (regularize_window_days BETWEEN 1 AND 366);

CREATE OR REPLACE FUNCTION enforce_regularize_request_window()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_window integer;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    SELECT COALESCE(regularize_window_days, 2) INTO v_window
      FROM tenants WHERE id = NEW.tenant_id;
    v_window := COALESCE(v_window, 2);

    IF NEW.date > v_today THEN
      RAISE EXCEPTION 'Cannot request regularization for a future date.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.date < v_today - (v_window - 1) THEN
      RAISE EXCEPTION '%', CASE
          WHEN v_window = 1 THEN 'Regularization can only be requested for today.'
          WHEN v_window = 2 THEN 'Regularization can only be requested for today or yesterday.'
          ELSE format('Regularization can only be requested for the last %s days.', v_window) END
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_regularize_request_window ON regularize_requests;
CREATE TRIGGER trg_enforce_regularize_request_window
  BEFORE INSERT ON regularize_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_regularize_request_window();
