-- =============================================================
-- Raniwala HR feedback batch (25 Sep 2026). Six independent changes, each
-- idempotent. The web app and the mobile app share this schema, so every
-- rule below is enforced here (not just in one client) where possible.
--
--   1. (Policy ack source + download log -- already applied by the app
--      team; see note in section 1.)
--   2. profiles.overtime_applicable -- payroll only auto-calculates overtime
--      for employees HR has ticked. Existing employees of every OTHER tenant
--      are backfilled to true so their payroll is unchanged; Raniwala's
--      start unticked (HR ticks the ones who get OT).
--   3. Single-punch day => 'Mispunch' (not Late/Present), opt-in per tenant
--      via tenants.mark_single_punch_mispunch (on for Raniwala only).
--   4. Upper-case user data (name, designation, department, division,
--      location) for tenants with tenants.uppercase_user_data (Raniwala),
--      enforced by trigger so web, app, imports and edge functions all agree.
--   5. Raniwala leave types: only Earned Leave is requestable. Marriage and
--      Misfortune leave are deactivated (not deleted) -- HR grants those as
--      extra Earned Leave days from the Leave Balances page instead, with
--      the reason recorded on the ledger note.
-- =============================================================


-- ── 1. Policy acknowledgement source + downloads ──────────────────────────
-- Already applied by the app team on 2026-09-25 as migration
-- "policy_ack_source_and_downloads" (CrewCore repo:
-- supabase/policy_ack_downloads_migration.sql): policy_acknowledgements.source
-- (NOT NULL DEFAULT 'web') + device, and policy_downloads (one row per
-- download, self-or-HR select). Nothing to do here -- kept as a note so the
-- web code's assumptions are documented in this repo.


-- ── 2. Overtime applicability per employee ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'overtime_applicable'
  ) THEN
    ALTER TABLE profiles ADD COLUMN overtime_applicable boolean NOT NULL DEFAULT false;
    -- First run only: keep every non-Raniwala employee's existing payroll
    -- behaviour (auto-OT for everyone under the salary threshold).
    UPDATE profiles p SET overtime_applicable = true
    FROM tenants t
    WHERE t.id = p.tenant_id AND t.company_name NOT ILIKE '%Raniwala%';
  END IF;
END $$;


-- ── 3 & 4. Tenant flags ───────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mark_single_punch_mispunch boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS uppercase_user_data        boolean NOT NULL DEFAULT false;


-- ── 3. Mispunch ───────────────────────────────────────────────────────────
-- The recompute trigger (latest: 20260918_3_first_last_punch_hours.sql) is
-- re-declared verbatim with ONE addition: a row explicitly set to
-- 'Mispunch' keeps that status while it still has <= 1 punch. Without this
-- the nightly sweep's own UPDATE below would be recomputed straight back to
-- 'Absent' by this BEFORE UPDATE trigger. Once a second punch lands (late
-- ESSL sync, or a regularization), normal recompute resumes.
CREATE OR REPLACE FUNCTION trg_recompute_attendance_from_punches()
RETURNS trigger LANGUAGE plpgsql AS $$
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
$$;

-- Marks every single-punch day on p_date as 'Mispunch' for opted-in
-- tenants. Only touches punch-derived statuses -- never Leave, Comp Off,
-- Travel, Show Visit, WFH etc.
CREATE OR REPLACE FUNCTION mark_mispunches(p_date date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE attendance a
  SET status = 'Mispunch'
  FROM tenants t
  WHERE t.id = a.tenant_id
    AND t.mark_single_punch_mispunch
    AND a.date = p_date
    AND a.status IN ('Present','Late','Half Day','Absent')
    AND (SELECT count(*) FROM punches pu WHERE pu.attendance_id = a.id) = 1;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION mark_mispunches(date) FROM PUBLIC;

-- Nightly sweep (latest: 20260914_1_leave_approval_marks_attendance.sql),
-- re-declared verbatim plus a mark_mispunches() call at the end -- it
-- already runs once per day just after the day closes (20:30 UTC = 02:00
-- IST), which is exactly when "only one punch today" becomes final.
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

  PERFORM mark_mispunches(p_date);
  RETURN v_count;
END;
$$;


-- ── 4. Upper-case user data ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_profiles_uppercase_user_data()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants t WHERE t.id = NEW.tenant_id AND t.uppercase_user_data) THEN
    NEW.first_name      := upper(NEW.first_name);
    NEW.middle_name     := upper(NEW.middle_name);
    NEW.last_name       := upper(NEW.last_name);
    NEW.designation     := upper(NEW.designation);
    NEW.department      := upper(NEW.department);
    NEW.division        := upper(NEW.division);
    NEW.outlet_location := upper(NEW.outlet_location);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_uppercase_user_data ON profiles;
CREATE TRIGGER profiles_uppercase_user_data
  BEFORE INSERT OR UPDATE OF first_name, middle_name, last_name, designation, department, division, outlet_location, tenant_id
  ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profiles_uppercase_user_data();


-- ── Raniwala-specific switches + one-time backfills ───────────────────────
DO $$
DECLARE
  v_tenant uuid;
  v_n      int;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  UPDATE tenants SET mark_single_punch_mispunch = true, uppercase_user_data = true WHERE id = v_tenant;

  -- 4. Existing rows: only those not already upper-case (trigger does the work).
  UPDATE profiles SET first_name = first_name
  WHERE tenant_id = v_tenant
    AND (first_name      IS DISTINCT FROM upper(first_name)
      OR middle_name     IS DISTINCT FROM upper(middle_name)
      OR last_name       IS DISTINCT FROM upper(last_name)
      OR designation     IS DISTINCT FROM upper(designation)
      OR department      IS DISTINCT FROM upper(department)
      OR division        IS DISTINCT FROM upper(division)
      OR outlet_location IS DISTINCT FROM upper(outlet_location));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Upper-cased % Raniwala profile(s)', v_n;

  -- 3. Past days are NOT re-marked here (428 Raniwala days in Sep 2026 would
  --    turn unpaid) -- that's the separate, opt-in
  --    20260925_4_raniwala_mispunch_backfill_sept.sql. From the day this runs,
  --    the nightly sweep marks new single-punch days on its own.

  -- 5. Only Earned Leave stays requestable.
  UPDATE leave_types SET is_active = false
  WHERE tenant_id = v_tenant AND name IN ('Marriage Leave', 'Misfortune (Bereavement) Leave', 'Misfortune Leave');
END $$;
