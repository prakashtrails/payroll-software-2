-- =============================================================
-- Project Tracking: tenant-visible projects, their member rosters, and
-- tasks assignable to individual employees.
-- Run after supabase_migration.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On Hold','Completed','Cancelled')),
  start_date  date,
  end_date    date,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id, status);

CREATE TABLE IF NOT EXISTS project_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_on_project text NOT NULL DEFAULT 'Member',
  added_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_profile ON project_members(profile_id);

CREATE TABLE IF NOT EXISTS project_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  assigned_to uuid REFERENCES profiles(id),
  status      text NOT NULL DEFAULT 'To Do' CHECK (status IN ('To Do','In Progress','Done')),
  due_date    date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project  ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee ON project_tasks(assigned_to);

ALTER TABLE projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects: tenant members can select" ON projects FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "projects: admin/manager can write" ON projects FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "project_members: tenant members can select" ON project_members FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "project_members: admin/manager can write" ON project_members FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "project_tasks: tenant members can select" ON project_tasks FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "project_tasks: admin/manager can insert" ON project_tasks FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "project_tasks: own or admin/manager can update" ON project_tasks FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (assigned_to = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "project_tasks: admin/manager can delete" ON project_tasks FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
