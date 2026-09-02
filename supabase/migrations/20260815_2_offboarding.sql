-- =============================================================
-- Offboarding: mirrors 20260815_1_onboarding.sql's shape exactly (checklist
-- library + per-employee process + tasks), for the exit lifecycle instead of
-- the new-hire lifecycle.
-- Run after supabase_migration.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS offboarding_checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'General',
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offboarding_checklist_items_tenant ON offboarding_checklist_items(tenant_id);

CREATE TABLE IF NOT EXISTS offboarding_processes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress','Completed','Cancelled')),
  reason            text NOT NULL DEFAULT '',
  exit_date         date NOT NULL DEFAULT current_date,
  last_working_day  date,
  notes             text NOT NULL DEFAULT '',
  created_by        uuid REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offboarding_processes_tenant  ON offboarding_processes(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_offboarding_processes_profile ON offboarding_processes(profile_id);

CREATE TABLE IF NOT EXISTS offboarding_process_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id)               ON DELETE CASCADE,
  process_id    uuid NOT NULL REFERENCES offboarding_processes(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_offboarding_process_tasks_process  ON offboarding_process_tasks(process_id);
CREATE INDEX IF NOT EXISTS idx_offboarding_process_tasks_assignee ON offboarding_process_tasks(assigned_to);

ALTER TABLE offboarding_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE offboarding_processes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE offboarding_process_tasks   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offboarding_checklist_items: tenant members can select" ON offboarding_checklist_items FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "offboarding_checklist_items: admin can write" ON offboarding_checklist_items FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "offboarding_processes: own or admin/manager can select" ON offboarding_processes FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "offboarding_processes: admin/manager can insert" ON offboarding_processes FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "offboarding_processes: admin/manager can update" ON offboarding_processes FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "offboarding_process_tasks: own or admin/manager can select" ON offboarding_process_tasks FOR SELECT
  USING (tenant_id = my_tenant_id() AND (assigned_to = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "offboarding_process_tasks: own or admin/manager can insert" ON offboarding_process_tasks FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND (assigned_to = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "offboarding_process_tasks: own or admin/manager can update" ON offboarding_process_tasks FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (assigned_to = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "offboarding_process_tasks: admin/manager can delete" ON offboarding_process_tasks FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
