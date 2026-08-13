-- =============================================================
-- Training & Skills: designation-level expected skills, per-employee
-- skill map, and training programs/events/enrollments.
-- Run after supabase_migration.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS skills (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  category   text NOT NULL DEFAULT 'General',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_skills_tenant ON skills(tenant_id);

CREATE TABLE IF NOT EXISTS designation_skills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  designation    text NOT NULL,
  skill_id       uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  expected_level int  NOT NULL DEFAULT 3 CHECK (expected_level BETWEEN 1 AND 5),
  UNIQUE (tenant_id, designation, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_designation_skills_tenant ON designation_skills(tenant_id, designation);

CREATE TABLE IF NOT EXISTS employee_skills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id     uuid NOT NULL REFERENCES skills(id)   ON DELETE CASCADE,
  level        int  NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  assessed_by  uuid REFERENCES profiles(id),
  assessed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_skills_profile ON employee_skills(profile_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_tenant  ON employee_skills(tenant_id);

ALTER TABLE skills             ENABLE ROW LEVEL SECURITY;
ALTER TABLE designation_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_skills    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "skills: tenant members can select" ON skills FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "skills: admin can write" ON skills FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "designation_skills: tenant members can select" ON designation_skills FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "designation_skills: admin can write" ON designation_skills FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "employee_skills: own or admin/manager can select" ON employee_skills FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "employee_skills: admin/manager can write" ON employee_skills FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));


-- ── Training programs / events / enrollments ──────────────────────────────
CREATE TABLE IF NOT EXISTS training_programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_programs_tenant ON training_programs(tenant_id);

CREATE TABLE IF NOT EXISTS training_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  program_id  uuid NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
  event_date  date NOT NULL,
  trainer     text NOT NULL DEFAULT '',
  location    text NOT NULL DEFAULT '',
  capacity    int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_events_tenant  ON training_events(tenant_id, event_date);
CREATE INDEX IF NOT EXISTS idx_training_events_program ON training_events(program_id);

CREATE TABLE IF NOT EXISTS training_enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id)         ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES training_events(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES profiles(id)        ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'Enrolled' CHECK (status IN ('Enrolled','Attended','No Show','Cancelled')),
  feedback_rating int CHECK (feedback_rating BETWEEN 1 AND 5),
  feedback_notes  text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_event   ON training_enrollments(event_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_profile ON training_enrollments(profile_id);

ALTER TABLE training_programs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "training_programs: tenant members can select" ON training_programs FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "training_programs: admin can write" ON training_programs FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "training_events: tenant members can select" ON training_events FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "training_events: admin can write" ON training_events FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "training_enrollments: own or admin/manager can select" ON training_enrollments FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "training_enrollments: tenant member can insert own" ON training_enrollments FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "training_enrollments: own or admin/manager can update" ON training_enrollments FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "training_enrollments: admin/manager can delete" ON training_enrollments FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
