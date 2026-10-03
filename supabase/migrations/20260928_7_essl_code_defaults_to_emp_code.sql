-- =============================================================
-- Raniwala: EMP code IS the ESSL punch-machine code (28 Sep 2026).
--
-- Akash Bairwa (EMP 197) and Subir Rajoyar (EMP 695) never synced because
-- their profiles had the EMP code filled in but the separate ESSL code left
-- blank, and the ESSL feed matches on profiles.essl_employee_code only.
--
-- For tenants with tenants.essl_code_is_emp_code, a profile saved with an
-- EMP code and no ESSL code now gets ESSL code := EMP code -- on every path
-- (web form, bulk import, mobile app, edge functions) since it's a trigger.
-- profiles_essl_code_sync (20260928_5, AFTER) then applies that code's
-- punches in the same save. Skipped when another profile already holds the
-- code, so the unique index never turns this into a failed save.
--
-- Existing rows are NOT backfilled here -- HR sets those from the Employees
-- page (any save of the row, or entering the code, triggers the sync).
-- =============================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS essl_code_is_emp_code boolean NOT NULL DEFAULT false;

UPDATE tenants SET essl_code_is_emp_code = true WHERE company_name ILIKE '%Raniwala%';

CREATE OR REPLACE FUNCTION trg_profiles_essl_code_from_emp_code()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_code text := NULLIF(upper(trim(NEW.employee_id)), '');
BEGIN
  IF NULLIF(trim(NEW.essl_employee_code), '') IS NULL
     AND v_code IS NOT NULL
     AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = NEW.tenant_id AND t.essl_code_is_emp_code)
     AND NOT EXISTS (
       SELECT 1 FROM profiles p
       WHERE p.tenant_id = NEW.tenant_id AND p.essl_employee_code = v_code AND p.id <> NEW.id
     ) THEN
    NEW.essl_employee_code := v_code;
  END IF;
  RETURN NEW;
END;
$$;

-- "profiles_essl_..." sorts before "profiles_uppercase_..." -- BEFORE
-- triggers fire in name order; the upper-case trigger then normalises both.
DROP TRIGGER IF EXISTS profiles_essl_code_from_emp_code ON profiles;
CREATE TRIGGER profiles_essl_code_from_emp_code
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profiles_essl_code_from_emp_code();


-- ── Sync trigger must see codes filled in by a BEFORE trigger ─────────────
-- "UPDATE OF essl_employee_code" only fires when the UPDATE statement itself
-- names that column, not when profiles_essl_code_from_emp_code sets it -- so
-- it now fires on every update; the function already exits unless the code
-- actually changed.
DROP TRIGGER IF EXISTS profiles_essl_code_sync ON profiles;
CREATE TRIGGER profiles_essl_code_sync
  AFTER INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profiles_essl_code_sync();

-- ── Apply function: trust calls from that trigger ─────────────────────────
-- Re-declared from 20260928_5 with one change to the permission check.
CREATE OR REPLACE FUNCTION essl_apply_to_attendance(
  p_tenant_id uuid,
  p_codes     text[]  DEFAULT NULL,   -- NULL = every mapped code
  p_from      date    DEFAULT NULL,   -- clamped to tenants.essl_attendance_from
  p_to        date    DEFAULT NULL,
  p_notify    boolean DEFAULT false   -- clock-in/out notification for TODAY's new punches (live poll only)
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from      date;
  v_today     date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_tenant    RECORD;
  r           RECORD;
  v_att_id    uuid;
  v_old       text;
  v_first     text;
  v_last      text;
  v_n         int;
  v_new_ids   uuid[];
  v_shift     RECORD;
  v_outlet    RECORD;
  v_start     text;
  v_end       text;
  v_late_min  int;
  v_half      numeric;
  v_full      numeric;
  v_total     numeric;
  v_status    text;
  v_is_late   boolean;
  v_allow     boolean;
  v_el_flag   boolean;
  v_el_grace  boolean;
  v_month     date;
  v_applied   int := 0;
BEGIN
  -- Direct RPC callers must be the tenant's HR (or service role, uid NULL).
  -- Called from profiles_essl_code_sync (pg_trigger_depth() > 0) it is
  -- trusted: that trigger only passes the saved row's own tenant + code, and
  -- an employee's own profile save must not fail because their code was
  -- just filled in from their EMP code.
  IF auth.uid() IS NOT NULL AND pg_trigger_depth() = 0 AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid()
      AND (role = 'superadmin' OR (tenant_id = p_tenant_id AND role IN ('admin','manager')))
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  IF v_tenant.essl_attendance_from IS NULL THEN
    RETURN 0;
  END IF;
  v_from := GREATEST(COALESCE(p_from, v_tenant.essl_attendance_from), v_tenant.essl_attendance_from);

  -- trg_recompute_attendance_from_punches would overwrite the status set
  -- below (it knows nothing of Late on a new row, the monthly allowance, or
  -- Mispunch with 2 punches). Its existing bypass flag is reused -- it also
  -- skips the geofence insert check, which never applies to a machine punch.
  -- Leave override and comp-off-by-hours triggers still run as normal.
  PERFORM set_config('app.regularize_apply', 'on', true);

  FOR r IN
    SELECT d.essl_employee_code, d.date, d.first_in, d.last_out,
           p.id AS profile_id, p.shift_id, p.outlet_id,
           upper(COALESCE(m.location, 'Office')) AS location
    FROM essl_daily_punches d
    JOIN profiles p ON p.tenant_id = d.tenant_id AND p.essl_employee_code = d.essl_employee_code
    LEFT JOIN essl_employee_master m ON m.tenant_id = d.tenant_id AND m.essl_employee_code = d.essl_employee_code
    WHERE d.tenant_id = p_tenant_id
      AND (p_codes IS NULL OR d.essl_employee_code = ANY (p_codes))
      AND d.date >= v_from
      AND (p_to IS NULL OR d.date <= p_to)
      AND (d.first_in IS NOT NULL OR d.last_out IS NOT NULL)
    ORDER BY p.id, d.date            -- monthly counters below read earlier days
  LOOP
    BEGIN
    SELECT id, status INTO v_att_id, v_old
    FROM attendance WHERE profile_id = r.profile_id AND date = r.date;

    -- Regularized day: HR/employee's approved times are the truth. Leave it.
    IF v_att_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM punches WHERE attendance_id = v_att_id AND source = 'manual'
    ) THEN
      CONTINUE;
    END IF;

    IF v_att_id IS NULL THEN
      INSERT INTO attendance (tenant_id, profile_id, date, status, total_hours, location)
      VALUES (p_tenant_id, r.profile_id, r.date, 'Present', 0, r.location || ' (Device)')
      ON CONFLICT (profile_id, date) DO NOTHING
      RETURNING id INTO v_att_id;
      IF v_att_id IS NULL THEN
        SELECT id, status INTO v_att_id, v_old FROM attendance WHERE profile_id = r.profile_id AND date = r.date;
      END IF;
    END IF;

    WITH incoming(t, typ) AS (
      VALUES (r.first_in, 'in'), (r.last_out, 'out')
    ), ins AS (
      INSERT INTO punches (attendance_id, punch_time, punch_type, source)
      SELECT v_att_id, i.t, i.typ, 'device'
      FROM incoming i
      WHERE i.t IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM punches pu
          WHERE pu.attendance_id = v_att_id AND pu.punch_time = i.t
            AND pu.punch_type = i.typ AND pu.source = 'device')
      RETURNING id, punch_time, punch_type
    ), notes AS (
      INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
      SELECT p_tenant_id, r.profile_id, NULL,
             CASE WHEN ins.punch_type = 'in' THEN 'clock_in' ELSE 'clock_out' END,
             CASE WHEN ins.punch_type = 'in' THEN 'Clocked in' ELSE 'Clocked out' END,
             format('You clocked %s at %s (biometric device).', ins.punch_type, ins.punch_time),
             'attendance', v_att_id
      FROM ins
      WHERE p_notify AND r.date = v_today
      RETURNING 1
    )
    SELECT array_agg(id) INTO v_new_ids FROM ins;

    -- Nothing new and the row already existed: status is already settled.
    IF v_new_ids IS NULL AND v_old IS NOT NULL THEN
      CONTINUE;
    END IF;

    -- Keep every non-punch status as-is (punches were still added above).
    IF v_old IS NOT NULL AND v_old NOT IN ('Present','Late','Half Day','Absent','Mispunch') THEN
      v_applied := v_applied + 1;
      CONTINUE;
    END IF;

    SELECT min(punch_time), max(punch_time), count(*) INTO v_first, v_last, v_n
    FROM punches WHERE attendance_id = v_att_id;

    -- Same precedence as resolveAttendanceSettings() / essl-punch.
    SELECT s.start_time::text AS start_time, s.end_time::text AS end_time,
           s.early_departure_after, s.late_arrival_allowance_until
      INTO v_shift FROM shifts s WHERE s.id = r.shift_id;
    SELECT o.shift_start, o.shift_end, o.late_threshold, o.min_half_day_hours, o.min_full_day_hours
      INTO v_outlet FROM outlets o WHERE o.id = r.outlet_id;

    v_start    := COALESCE(v_shift.start_time, v_outlet.shift_start, v_tenant.shift_start, '10:30');
    v_end      := COALESCE(v_shift.end_time,   v_outlet.shift_end,   v_tenant.shift_end,   '18:00');
    v_late_min := COALESCE(v_outlet.late_threshold, v_tenant.late_threshold, 0);
    v_half     := COALESCE(v_outlet.min_half_day_hours, v_tenant.min_half_day_hours, 4);
    v_full     := COALESCE(v_outlet.min_full_day_hours, v_tenant.min_full_day_hours, 8);

    v_is_late := (EXTRACT(EPOCH FROM (v_first::time - substr(v_start, 1, 5)::time)) / 60) > v_late_min;
    v_allow := false; v_el_flag := false; v_el_grace := false;
    v_month := date_trunc('month', r.date)::date;

    IF v_n <= 1 THEN
      -- One punch. A past day is final -> Mispunch (tenant opt-in, same as
      -- the nightly mark_mispunches sweep); today it is just "clocked in".
      v_total := 0;
      IF r.date < v_today AND COALESCE(v_tenant.mark_single_punch_mispunch, false) THEN
        v_status := 'Mispunch';
      ELSE
        v_status := CASE WHEN v_is_late THEN 'Late' ELSE 'Present' END;
      END IF;
    ELSE
      -- First punch to last punch, either type (see 20260918_3).
      v_total := round(((EXTRACT(EPOCH FROM (v_last::time - v_first::time))::numeric % 86400 + 86400) % 86400) / 3600.0, 2);
      v_status := CASE WHEN v_total >= v_full THEN 'Present'
                       WHEN v_total >= v_half THEN 'Half Day'
                       ELSE 'Absent' END;
      IF v_status = 'Present' AND (v_is_late OR v_old = 'Late') THEN
        v_status := 'Late';
      END IF;

      -- Once-a-month allowance for an extreme early exit / late arrival
      -- (per-shift, opt-in); a repeat in the same month forces Half Day.
      IF v_status <> 'Absent' AND (
           (v_shift.early_departure_after IS NOT NULL AND v_last::time < v_shift.early_departure_after)
        OR (v_shift.late_arrival_allowance_until IS NOT NULL AND v_first::time > v_shift.late_arrival_allowance_until)
      ) THEN
        IF EXISTS (
          SELECT 1 FROM attendance a
          WHERE a.profile_id = r.profile_id AND a.id <> v_att_id AND a.monthly_allowance_used
            AND a.date >= v_month AND a.date <= r.date
        ) THEN
          v_status := 'Half Day';
        ELSE
          v_allow := true;
        END IF;
      END IF;

      -- Early Left / Late Arrival monthly counter (visibility only), same
      -- 90-minute rule as computeEarlyLateBreach().
      IF (EXTRACT(EPOCH FROM (v_first::time - substr(v_start, 1, 5)::time)) / 60) > 90
         OR (EXTRACT(EPOCH FROM (substr(v_end, 1, 5)::time - v_last::time)) / 60) > 90 THEN
        IF EXISTS (
          SELECT 1 FROM attendance a
          WHERE a.profile_id = r.profile_id AND (a.early_late_flag OR a.early_late_graced)
            AND a.date >= v_month AND a.date < r.date
        ) THEN
          v_el_flag := true;
        ELSE
          v_el_grace := true;
        END IF;
      END IF;
    END IF;

    UPDATE attendance
    SET status = v_status, total_hours = v_total,
        monthly_allowance_used = v_allow,
        early_late_flag = v_el_flag, early_late_graced = v_el_grace
        -- auto_marked is left as-is: attendance_employee_update_guard only
        -- lets admins change it, and nothing reads it once real punches exist.
    WHERE id = v_att_id;

    v_applied := v_applied + 1;

    EXCEPTION WHEN OTHERS THEN
      -- One bad day (e.g. punches_guard's 10-second cooldown if HR saves the
      -- code while a poll cycle is applying the same day) must not fail the
      -- whole batch. Poison this mirror row's count so the next ingest sees
      -- it as changed and retries just this day.
      RAISE WARNING 'essl apply skipped % % : %', r.essl_employee_code, r.date, SQLERRM;
      UPDATE essl_daily_punches SET punch_count = -1
      WHERE tenant_id = p_tenant_id AND essl_employee_code = r.essl_employee_code AND date = r.date;
    END;
  END LOOP;

  PERFORM set_config('app.regularize_apply', 'off', true);
  RETURN v_applied;
END;
$$;
