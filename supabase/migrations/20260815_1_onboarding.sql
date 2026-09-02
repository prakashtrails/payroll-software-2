-- =============================================================
-- Onboarding: a reusable checklist-item library an admin curates once,
-- plus a per-new-hire process that copies the library into editable tasks.
-- Run after supabase_migration.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS onboarding_checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'General',
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_items_tenant ON onboarding_checklist_items(tenant_id);

CREATE TABLE IF NOT EXISTS onboarding_processes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress','Completed','Cancelled')),
  start_date  date NOT NULL DEFAULT current_date,
  target_date date,
  notes       text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_processes_tenant  ON onboarding_processes(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_processes_profile ON onboarding_processes(profile_id);

CREATE TABLE IF NOT EXISTS onboarding_process_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id)              ON DELETE CASCADE,
  process_id    uuid NOT NULL REFERENCES onboarding_processes(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  category      text NOT NULL DEFAULT 'General',
  due_date      date,
  status        text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Done')),
  assigned_to   uuid REFERENCES profiles(id),
  completed_at  timestamptz,
  sort_order    int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_process_tasks_process  ON onboarding_process_tasks(process_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_process_tasks_assignee ON onboarding_process_tasks(assigned_to);

ALTER TABLE onboarding_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_processes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_process_tasks   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_checklist_items: tenant members can select" ON onboarding_checklist_items FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "onboarding_checklist_items: admin can write" ON onboarding_checklist_items FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "onboarding_processes: own or admin/manager can select" ON onboarding_processes FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "onboarding_processes: admin/manager can insert" ON onboarding_processes FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "onboarding_processes: admin/manager can update" ON onboarding_processes FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "onboarding_process_tasks: own or admin/manager can select" ON onboarding_process_tasks FOR SELECT
  USING (tenant_id = my_tenant_id() AND (assigned_to = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "onboarding_process_tasks: own or admin/manager can insert" ON onboarding_process_tasks FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND (assigned_to = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "onboarding_process_tasks: own or admin/manager can update" ON onboarding_process_tasks FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (assigned_to = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "onboarding_process_tasks: admin/manager can delete" ON onboarding_process_tasks FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
