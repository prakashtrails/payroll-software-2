-- =============================================================
-- 1) Regularize window: today + the 2 previous days (e.g. on 25 Sep an
--    employee can still request 23, 24 and 25 Sep). Was today + yesterday.
--
-- 2) Applying an APPROVED regularize request to attendance now happens in
--    the DB (trigger on regularize_requests), not in client JS.
--
--    Why: the website applied it via regularizeAttendance() from the
--    browser. For a self-approved (auto-approved) request that runs as the
--    employee, and:
--      - "punches: admin/manager can delete" RLS silently deleted 0 old
--        punches, so the corrected in/out were ADDED next to the old ones;
--      - recompute_attendance_from_punches (employee branch) recomputed
--        hours from the OLD punches before the new ones were written --
--        a single-punch Mispunch day came out as Absent / 0h;
--      - a day with no attendance row hit the geofence insert check with
--        null lat/lng.
--    And the mobile app (separate codebase, same DB) would have had to
--    re-implement all of it. With the trigger, any client -- web, app, or a
--    direct REST call -- only has to insert the request (self tier) or flip
--    status to 'Approved' (manager/admin); the attendance row, punches,
--    hours and status follow automatically and identically.
--
--    The apply sets a transaction-local flag app.regularize_apply = 'on'
--    which the recompute and geofence triggers honour, so the corrected
--    values are written as-is (same as an admin's manual correction).
-- =============================================================

-- ── 1) window ───────────────────────────────────────────────────────────
ALTER TABLE tenants ALTER COLUMN regularize_window_days SET DEFAULT 3;
UPDATE tenants SET regularize_window_days = 3 WHERE regularize_window_days = 2;

CREATE OR REPLACE FUNCTION enforce_regularize_request_window()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_window integer;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    SELECT COALESCE(regularize_window_days, 3) INTO v_window
      FROM tenants WHERE id = NEW.tenant_id;
    v_window := COALESCE(v_window, 3);

    IF NEW.date > v_today THEN
      RAISE EXCEPTION 'Cannot request regularization for a future date.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.date < v_today - (v_window - 1) THEN
      RAISE EXCEPTION '%', CASE
          WHEN v_window = 1 THEN 'Regularization can only be requested for today.'
          WHEN v_window = 2 THEN 'Regularization can only be requested for today or yesterday.'
          ELSE format('Regularization can only be requested for today and the previous %s days.', v_window - 1) END
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2a) let the apply bypass the employee recompute + geofence checks ──
CREATE OR REPLACE FUNCTION public.trg_recompute_attendance_from_punches()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total numeric := 0;
  v_half  numeric;
  v_full  numeric;
  v_first text;
  v_last  text;
  v_outlet_id uuid;
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

  -- approved regularize request being applied by apply_approved_regularize_request()
  IF current_setting('app.regularize_apply', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Mispunch'
     AND (SELECT count(*) FROM punches WHERE attendance_id = NEW.id) <= 1 THEN
    RETURN NEW;
  END IF;

  SELECT min(punch_time), max(punch_time) INTO v_first, v_last
  FROM punches WHERE attendance_id = NEW.id;

  IF v_first IS NOT NULL AND v_last IS NOT NULL THEN
    v_total := (
      (EXTRACT(EPOCH FROM (v_last::time - v_first::time))::numeric % 86400 + 86400) % 86400
    ) / 3600.0;
  END IF;

  SELECT p.outlet_id INTO v_outlet_id FROM profiles p WHERE p.id = NEW.profile_id;

  SELECT
    COALESCE(o.min_half_day_hours, t.min_half_day_hours, 4),
    COALESCE(o.min_full_day_hours, t.min_full_day_hours, 8)
  INTO v_half, v_full
  FROM tenants t
  LEFT JOIN outlets o ON o.id = v_outlet_id
  WHERE t.id = NEW.tenant_id;

  NEW.total_hours := GREATEST(round(v_total * 100) / 100, 0);
  NEW.status := CASE
    WHEN NEW.total_hours >= v_full THEN 'Present'
    WHEN NEW.total_hours >= v_half THEN 'Half Day'
    ELSE 'Absent'
  END;

  IF OLD.status = 'Late' AND NEW.status = 'Present' THEN
    NEW.status := 'Late';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_geofence_on_attendance_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_wfh    boolean;
  v_exists boolean;
BEGIN
  -- An approved regularize request creating a missed day's row is not a
  -- live clock-in -- there is no location to check.
  IF current_setting('app.regularize_apply', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Only the employee's own live self-service clock-in (authenticated
  -- session, inserting their own profile_id) is checked here.
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    -- clockIn() upserts with ON CONFLICT (profile_id, date) DO NOTHING to stay
    -- idempotent against double-taps/retries. A BEFORE INSERT trigger still
    -- fires on that proposed (soon to be discarded) row, so skip the check
    -- when today's row already exists.
    SELECT EXISTS (
      SELECT 1 FROM attendance WHERE profile_id = NEW.profile_id AND date = NEW.date
    ) INTO v_exists;
    IF v_exists THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM wfh_requests
      WHERE profile_id = NEW.profile_id AND status = 'Approved'
        AND from_date <= NEW.date AND to_date >= NEW.date
    ) INTO v_wfh;

    IF NOT v_wfh AND NOT profile_punch_is_inside_geofence(NEW.profile_id, NEW.punch_in_lat, NEW.punch_in_lng) THEN
      RAISE EXCEPTION 'You are outside all of your allowed clock-in locations. Move inside one of them and try again.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2b) the apply itself ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_approved_regularize_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_att_id    uuid;
  v_old_stat  text;
  v_old_hours numeric;
  v_half      numeric;
  v_full      numeric;
  v_hours     numeric := 0;
  v_status    text;
  v_existed   boolean;
BEGIN
  IF NEW.status <> 'Approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Approved' THEN RETURN NEW; END IF;
  IF NEW.clock_in_time IS NULL OR NEW.clock_out_time IS NULL THEN RETURN NEW; END IF;

  PERFORM set_config('app.regularize_apply', 'on', true);

  SELECT
    COALESCE(o.min_half_day_hours, t.min_half_day_hours, 4),
    COALESCE(o.min_full_day_hours, t.min_full_day_hours, 8)
  INTO v_half, v_full
  FROM tenants t
  LEFT JOIN profiles p ON p.id = NEW.profile_id
  LEFT JOIN outlets  o ON o.id = p.outlet_id
  WHERE t.id = NEW.tenant_id;

  v_hours := round((
    (EXTRACT(EPOCH FROM (NEW.clock_out_time - NEW.clock_in_time))::numeric % 86400 + 86400) % 86400
  ) / 3600.0, 2);
  v_status := CASE
    WHEN v_hours >= v_full THEN 'Present'
    WHEN v_hours >= v_half THEN 'Half Day'
    ELSE 'Absent'
  END;

  SELECT id, status, total_hours INTO v_att_id, v_old_stat, v_old_hours
    FROM attendance WHERE profile_id = NEW.profile_id AND date = NEW.date;
  v_existed := v_att_id IS NOT NULL;

  IF v_att_id IS NULL THEN
    INSERT INTO attendance (tenant_id, profile_id, date, status, total_hours, location)
    VALUES (NEW.tenant_id, NEW.profile_id, NEW.date, v_status, v_hours, 'Office (Regularized)')
    ON CONFLICT (profile_id, date) DO NOTHING
    RETURNING id INTO v_att_id;
    IF v_att_id IS NULL THEN
      SELECT id INTO v_att_id FROM attendance WHERE profile_id = NEW.profile_id AND date = NEW.date;
    END IF;
  END IF;

  DELETE FROM punches WHERE attendance_id = v_att_id;
  INSERT INTO punches (attendance_id, punch_time, punch_type, source) VALUES
    (v_att_id, to_char(NEW.clock_in_time,  'HH24:MI'), 'in',  'manual'),  -- punch_time is text 'HH:MM', like clockIn()
    (v_att_id, to_char(NEW.clock_out_time, 'HH24:MI'), 'out', 'manual');

  UPDATE attendance
     SET status = v_status, total_hours = v_hours, location = 'Office (Regularized)'
   WHERE id = v_att_id;

  INSERT INTO attendance_audit_log
    (tenant_id, attendance_id, profile_id, changed_by, date, action,
     old_status, new_status, old_hours, new_hours, reason)
  VALUES
    (NEW.tenant_id, v_att_id, NEW.profile_id, COALESCE(NEW.reviewed_by, auth.uid(), NEW.profile_id), NEW.date,
     CASE WHEN v_existed THEN 'update' ELSE 'create' END,
     v_old_stat, v_status, v_old_hours, v_hours, NEW.reason);

  PERFORM set_config('app.regularize_apply', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_approved_regularize_request ON regularize_requests;
CREATE TRIGGER trg_apply_approved_regularize_request
  AFTER INSERT OR UPDATE OF status ON regularize_requests
  FOR EACH ROW
  EXECUTE FUNCTION apply_approved_regularize_request();
