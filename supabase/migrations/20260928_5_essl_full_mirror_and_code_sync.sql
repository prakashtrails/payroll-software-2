-- =============================================================
-- ESSL: full mirror of the punch-machine feed + instant sync on EMP code
-- (28 Sep 2026, Raniwala request).
--
-- Before this, essl-web-poll asked Raniwala's ESSL Web API for ONE day per
-- 2-minute cycle and forwarded changed rows to essl-punch. Any day a cycle
-- missed (API down, cold start, a reader syncing late -- DELHI often shows
-- up hours later) was never looked at again, and a code with no CrewCore
-- employee was dropped on the floor (only reported as "unmapped"). Result:
-- gaps like Akash Bairwa (ESSL 197) having punches on the machine that
-- never reached CrewCore.
--
-- Now:
--   1. essl_employee_master / essl_daily_punches keep a copy of EVERYTHING
--      the feed returns -- every code, mapped or not, every day it still
--      holds (~13 months, ~70k short rows). It is the machine's record, shown
--      as-is on the ESSL Records page and in the Add Employee lookup.
--   2. essl_ingest_daily() is the only writer: it upserts a batch, keeps only
--      rows that actually changed, and applies those to attendance in the same
--      transaction (so a failed apply is retried next cycle, never lost).
--   3. essl_apply_to_attendance() turns mirror rows into attendance/punches
--      for mapped employees, from tenants.essl_attendance_from onwards, with
--      the same rules essl-punch uses. It never touches a regularized day,
--      and never changes a Leave / Comp Off / WFH / other non-punch status
--      (machine punches are still added to those days).
--   4. Setting or changing profiles.essl_employee_code (web, app, import --
--      any path) applies that code's whole mirror immediately, in the same
--      save.
--
-- Raniwala EMP CODE == ESSL code (see feedback_raniwala_match_by_employee_code).
-- The mirror stores the feed's first-in / last-out per day plus its punch
-- count -- that is all the feed exposes; there is no per-scan list.
-- =============================================================


-- ── 1. Tenant cutoff: attendance is only written from this date ───────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS essl_attendance_from date;
COMMENT ON COLUMN tenants.essl_attendance_from IS
  'ESSL mirror rows on/after this date are applied to attendance. NULL = mirror only, never applied.';


-- ── 2. Mirror tables ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS essl_employee_master (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  essl_employee_code text NOT NULL,
  name               text,
  department         text,
  location           text,
  shift              text,
  left_on            date,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, essl_employee_code)
);

CREATE TABLE IF NOT EXISTS essl_daily_punches (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  essl_employee_code text NOT NULL,
  date               date NOT NULL,
  first_in           text,          -- 'HH:MM', same format as punches.punch_time
  last_out           text,
  punch_count        smallint NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, essl_employee_code, date)
);
CREATE INDEX IF NOT EXISTS essl_daily_punches_tenant_date_idx ON essl_daily_punches (tenant_id, date);

ALTER TABLE essl_employee_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE essl_daily_punches   ENABLE ROW LEVEL SECURITY;

-- Read-only for HR; only the SECURITY DEFINER ingest functions write.
DROP POLICY IF EXISTS "essl_employee_master: tenant hr read" ON essl_employee_master;
CREATE POLICY "essl_employee_master: tenant hr read" ON essl_employee_master FOR SELECT
  USING ((tenant_id = my_tenant_id() AND my_role() IN ('admin','manager')) OR my_role() = 'superadmin');

DROP POLICY IF EXISTS "essl_daily_punches: tenant hr read" ON essl_daily_punches;
CREATE POLICY "essl_daily_punches: tenant hr read" ON essl_daily_punches FOR SELECT
  USING ((tenant_id = my_tenant_id() AND my_role() IN ('admin','manager')) OR my_role() = 'superadmin');

-- One row per code for the ESSL Records list (the page never pulls the
-- ~70k daily rows; it fetches one code's days when HR opens it).
-- security_invoker so the table RLS above applies to whoever reads it.
CREATE OR REPLACE VIEW essl_code_summary WITH (security_invoker = true) AS
SELECT tenant_id, essl_employee_code,
       count(*)                                                        AS days_punched,
       min(date)                                                       AS first_date,
       max(date)                                                       AS last_date,
       count(*) FILTER (WHERE date >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date) AS days_this_month
FROM essl_daily_punches
GROUP BY tenant_id, essl_employee_code;
GRANT SELECT ON essl_code_summary TO authenticated;

-- Carry over what the old poll already recorded, so nothing is lost before
-- the new poll's first full pull. (essl_web_poll_state is Raniwala-only and
-- is dropped by a later cleanup once the new poll is confirmed live.)
DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found -- aborting, nothing changed';
  END IF;

  IF to_regclass('public.essl_web_poll_state') IS NOT NULL THEN
    INSERT INTO essl_daily_punches (tenant_id, essl_employee_code, date, first_in, last_out, punch_count)
    SELECT v_tenant, s.essl_employee_code, s.date, s.last_in, s.last_out,
           (s.last_in IS NOT NULL)::int + (s.last_out IS NOT NULL)::int
    FROM essl_web_poll_state s
    ON CONFLICT DO NOTHING;
  END IF;

  -- Go-live date on CrewCore. Earlier months never ran on CrewCore and are
  -- kept as machine record only (decided with HR, 28 Sep 2026).
  UPDATE tenants SET essl_attendance_from = DATE '2026-08-18' WHERE id = v_tenant;
END $$;


-- ── 3. Apply mirror -> attendance ─────────────────────────────────────────
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
  -- Same guard as the other SECURITY DEFINER backfills: service role / the
  -- profiles trigger run with auth.uid() NULL or as the tenant's own HR.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
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
REVOKE ALL ON FUNCTION essl_apply_to_attendance(uuid, text[], date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION essl_apply_to_attendance(uuid, text[], date, date, boolean) TO authenticated, service_role;


-- ── 4. Ingest (called by essl-web-poll with the service role) ─────────────
-- p_rows: [{ "u": "197", "d": "2026-09-27", "i": "09:38", "o": "19:49", "n": 2 }, ...]
-- (the feed's own row shape, passed through untouched).
CREATE OR REPLACE FUNCTION essl_ingest_daily(p_tenant_id uuid, p_rows jsonb, p_notify boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_codes   text[];
  v_from    date;
  v_to      date;
  v_changed int;
  v_applied int := 0;
  v_unmapped text[];
BEGIN
  WITH src AS (
    SELECT DISTINCT ON (x.u, x.d)
           trim(x.u) AS code, x.d::date AS date,
           NULLIF(trim(x.i), '') AS first_in, NULLIF(trim(x.o), '') AS last_out,
           COALESCE(x.n, 0)::smallint AS n
    FROM jsonb_to_recordset(p_rows) AS x(u text, d text, i text, o text, n int)
    WHERE NULLIF(trim(x.u), '') IS NOT NULL AND x.d IS NOT NULL
    ORDER BY x.u, x.d
  ), up AS (
    INSERT INTO essl_daily_punches AS t (tenant_id, essl_employee_code, date, first_in, last_out, punch_count, updated_at)
    SELECT p_tenant_id, code, date, first_in, last_out, n, now() FROM src
    ON CONFLICT (tenant_id, essl_employee_code, date) DO UPDATE
      SET first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out,
          punch_count = EXCLUDED.punch_count, updated_at = now()
      WHERE (t.first_in, t.last_out, t.punch_count)
            IS DISTINCT FROM (EXCLUDED.first_in, EXCLUDED.last_out, EXCLUDED.punch_count)
    RETURNING essl_employee_code, date
  )
  SELECT array_agg(DISTINCT essl_employee_code), min(date), max(date), count(*)
    INTO v_codes, v_from, v_to, v_changed
  FROM up;

  IF v_changed > 0 THEN
    v_applied := essl_apply_to_attendance(p_tenant_id, v_codes, v_from, v_to, p_notify);

    SELECT array_agg(c ORDER BY c) INTO v_unmapped
    FROM unnest(v_codes) c
    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.tenant_id = p_tenant_id AND p.essl_employee_code = c);
  END IF;

  RETURN jsonb_build_object('changed', v_changed, 'applied', v_applied, 'unmapped', COALESCE(to_jsonb(v_unmapped), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION essl_ingest_daily(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION essl_ingest_daily(uuid, jsonb, boolean) TO service_role;

-- p_rows: the feed's employees[] -- { u, n, dp, l, sh, left }.
CREATE OR REPLACE FUNCTION essl_ingest_master(p_tenant_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH src AS (
    SELECT DISTINCT ON (trim(x.u))
           trim(x.u) AS code,
           NULLIF(upper(trim(x.n)), '')  AS name,
           NULLIF(upper(trim(x.dp)), '') AS department,
           NULLIF(upper(trim(x.l)), '')  AS location,
           NULLIF(upper(trim(x.sh)), '') AS shift,
           CASE WHEN x."left" ~ '^\d{4}-\d{2}-\d{2}$' THEN x."left"::date END AS left_on
    FROM jsonb_to_recordset(p_rows) AS x(u text, n text, dp text, l text, sh text, "left" text)
    WHERE NULLIF(trim(x.u), '') IS NOT NULL
  ), up AS (
    INSERT INTO essl_employee_master AS t (tenant_id, essl_employee_code, name, department, location, shift, left_on)
    SELECT p_tenant_id, code, name, department, location, shift, left_on FROM src
    ON CONFLICT (tenant_id, essl_employee_code) DO UPDATE
      SET name = EXCLUDED.name, department = EXCLUDED.department, location = EXCLUDED.location,
          shift = EXCLUDED.shift, left_on = EXCLUDED.left_on, updated_at = now()
      WHERE (t.name, t.department, t.location, t.shift, t.left_on)
            IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.department, EXCLUDED.location, EXCLUDED.shift, EXCLUDED.left_on)
    RETURNING 1
  )
  SELECT count(*)::int FROM up;
$$;
REVOKE ALL ON FUNCTION essl_ingest_master(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION essl_ingest_master(uuid, jsonb) TO service_role;


-- ── 5. Setting an EMP / ESSL code syncs that employee immediately ──────────
CREATE OR REPLACE FUNCTION trg_profiles_essl_code_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.essl_employee_code IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.essl_employee_code IS DISTINCT FROM OLD.essl_employee_code) THEN
    PERFORM essl_apply_to_attendance(NEW.tenant_id, ARRAY[NEW.essl_employee_code]);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profiles_essl_code_sync ON profiles;
CREATE TRIGGER profiles_essl_code_sync
  AFTER INSERT OR UPDATE OF essl_employee_code ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profiles_essl_code_sync();


-- ── 6. Codes in capitals too ─────────────────────────────────────────────
-- 20260925_2's upper-case trigger, re-declared with EMP code and ESSL code
-- added (trimmed + upper-cased) for tenants with uppercase_user_data.
CREATE OR REPLACE FUNCTION trg_profiles_uppercase_user_data()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants t WHERE t.id = NEW.tenant_id AND t.uppercase_user_data) THEN
    NEW.first_name         := upper(NEW.first_name);
    NEW.middle_name        := upper(NEW.middle_name);
    NEW.last_name          := upper(NEW.last_name);
    NEW.designation        := upper(NEW.designation);
    NEW.department         := upper(NEW.department);
    NEW.division           := upper(NEW.division);
    NEW.outlet_location    := upper(NEW.outlet_location);
    NEW.employee_id        := NULLIF(upper(trim(NEW.employee_id)), '');
    NEW.essl_employee_code := NULLIF(upper(trim(NEW.essl_employee_code)), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_uppercase_user_data ON profiles;
CREATE TRIGGER profiles_uppercase_user_data
  BEFORE INSERT OR UPDATE OF first_name, middle_name, last_name, designation, department, division,
                             outlet_location, employee_id, essl_employee_code, tenant_id
  ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profiles_uppercase_user_data();
