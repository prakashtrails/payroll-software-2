-- =============================================================
-- Attendance & shift automation: shift grace/threshold config,
-- geofence-out-of-range flagging (lat/lng capture already exists),
-- nightly auto-absent marking, and simple shift assignment planning.
-- Run after supabase_migration.sql + 20260805_outlet_attendance_settings.sql.
-- =============================================================

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS grace_minutes               int NOT NULL DEFAULT 10;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS early_exit_threshold_minutes int NOT NULL DEFAULT 10;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS auto_absent_after_hours      int NOT NULL DEFAULT 20; -- hours past midnight of the shift date before a no-punch day is swept as Absent

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_of_geofence boolean NOT NULL DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS auto_marked     boolean NOT NULL DEFAULT false; -- true when set by the nightly sweep rather than a punch/manual edit


-- ── Simple shift roster: profile × date → shift ───────────────────────────
CREATE TABLE IF NOT EXISTS shift_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shift_id    uuid NOT NULL REFERENCES shifts(id)   ON DELETE CASCADE,
  date        date NOT NULL,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, date)
);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_tenant_date ON shift_assignments(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_profile     ON shift_assignments(profile_id, date);

ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_assignments: own or admin/manager can select"
  ON shift_assignments FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "shift_assignments: admin/manager can write"
  ON shift_assignments FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));


-- ── Nightly auto-marking sweep ─────────────────────────────────────────────
-- For every active employee with no attendance row yet for a given date,
-- once far enough past that date that they're clearly not coming, insert an
-- Absent row. Employees who DID punch keep whatever status clockIn/clockOut
-- already computed (Late/Present/Half Day) — this only fills the gap for
-- employees who never punched at all.
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
  LOOP
    INSERT INTO attendance (tenant_id, profile_id, date, status, total_hours, location, auto_marked)
    VALUES (v_emp.tenant_id, v_emp.id, p_date, 'Absent', 0, 'Office', true)
    ON CONFLICT (profile_id, date) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION mark_attendance_from_punches(date) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'attendance-nightly-absent-sweep') THEN
    PERFORM cron.unschedule('attendance-nightly-absent-sweep');
  END IF;
  PERFORM cron.schedule('attendance-nightly-absent-sweep', '30 20 * * *', 'SELECT mark_attendance_from_punches(CURRENT_DATE);');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (extension may not be available on this plan): %', SQLERRM;
END $$;
