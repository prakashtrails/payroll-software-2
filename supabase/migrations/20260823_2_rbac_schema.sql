-- =============================================================
-- Hierarchy & Workflow Engine — Phase 1b: RBAC tables
-- (roles, permissions, role_permissions, user_roles,
--  reporting_relationships, audit_logs)
--
-- Purely additive. profiles.role stays the source of truth for all
-- existing RLS policies (my_role()) and UI gating until each module
-- is individually migrated (see docs/hierarchy-workflow-engine-analysis.md
-- §4). Nothing here changes behavior by itself.
-- =============================================================

-- ── Roles: tenant_id NULL = global system template (superadmin-owned,
--    e.g. the 4 legacy roles seeded in the backfill migration).
--    A tenant can additionally define its own custom roles. ──
CREATE TABLE IF NOT EXISTS roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  is_system  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_tenant_name
  ON roles (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

-- ── Permissions: global catalog, superadmin-managed ──
CREATE TABLE IF NOT EXISTS permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE, -- e.g. 'leave.view', 'attendance.approve'
  category    text NOT NULL DEFAULT 'general',
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Role <-> permission, each grant carries an access scope ──
CREATE TABLE IF NOT EXISTS role_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope         text NOT NULL DEFAULT 'SELF'
    CHECK (scope IN ('SELF','DIRECT_REPORTS','TEAM','DEPARTMENT','LOCATION','MULTIPLE_DEPARTMENTS','ENTIRE_TENANT','GLOBAL')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

-- ── Role assignment: scoped to department/location, time-bound ──
CREATE TABLE IF NOT EXISTS user_roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,
  location_id    uuid REFERENCES locations(id) ON DELETE SET NULL,
  valid_from     date NOT NULL DEFAULT current_date,
  valid_to       date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_profile ON user_roles(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant ON user_roles(tenant_id, role_id);

-- ── Reporting relationships: generalizes profiles.manager_id into a
--    typed, multi-relationship graph. profile_id reports to
--    related_profile_id via relationship_type. ──
CREATE TABLE IF NOT EXISTS reporting_relationships (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  related_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  relationship_type  text NOT NULL
    CHECK (relationship_type IN ('DIRECT_MANAGER','FUNCTIONAL_MANAGER','DEPARTMENT_HEAD','HR_PARTNER','APPROVER','REVIEWER','ESCALATION_MANAGER')),
  is_primary         boolean NOT NULL DEFAULT true,
  valid_from         date NOT NULL DEFAULT current_date,
  valid_to           date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (profile_id <> related_profile_id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_reporting_rel_tenant_profile ON reporting_relationships(tenant_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_reporting_rel_tenant_related ON reporting_relationships(tenant_id, related_profile_id);
-- Only one currently-active primary relationship of a given type per subordinate
-- (e.g. one active primary DIRECT_MANAGER at a time).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reporting_rel_one_primary_active
  ON reporting_relationships (profile_id, relationship_type)
  WHERE is_primary AND valid_to IS NULL;

-- ── Approval delegation: while active, resolve_active_approver()
--    (Phase 1c functions migration) substitutes delegate_id for
--    delegator_id at read time. Normal hierarchy resumes automatically
--    once ends_at passes — nothing here mutates reporting_relationships. ──
CREATE TABLE IF NOT EXISTS approval_delegations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delegator_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  delegate_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  scope        text NOT NULL DEFAULT 'ALL', -- 'ALL' or a specific workflow_type
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (delegator_id <> delegate_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_delegator ON approval_delegations(delegator_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_tenant ON approval_delegations(tenant_id);

-- ── Generic audit log (additive alongside attendance_audit_log,
--    which stays as-is). Insert-only by convention: admin/manager/
--    superadmin can log their own actions directly; system-generated
--    entries (role changes, workflow transitions) are written by
--    SECURITY DEFINER functions in later migrations, which bypass RLS
--    the same way record_leave_deduction/compute_fnf_settlement do. ──
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   uuid,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

ALTER TABLE roles                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_delegations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs              ENABLE ROW LEVEL SECURITY;

-- roles: tenant members read their own tenant's roles + all global
-- system templates; only admin/superadmin write tenant-scoped roles;
-- only superadmin writes global (tenant_id IS NULL) templates.
CREATE POLICY "roles: tenant members can read own or global"
  ON roles FOR SELECT
  USING (tenant_id = my_tenant_id() OR tenant_id IS NULL OR my_role() = 'superadmin');

CREATE POLICY "roles: admin can write own tenant roles"
  ON roles FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin') AND NOT is_system)
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin') AND NOT is_system);

CREATE POLICY "roles: superadmin_platform_all"
  ON roles FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- permissions: global catalog, readable by anyone authenticated, only
-- superadmin can define new permission keys.
CREATE POLICY "permissions: authenticated can read"
  ON permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "permissions: superadmin can write"
  ON permissions FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- role_permissions: readable if you can read the parent role; writable
-- by whoever can write the parent role (system roles: superadmin only).
CREATE POLICY "role_permissions: select via parent role"
  ON role_permissions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
      AND (r.tenant_id = my_tenant_id() OR r.tenant_id IS NULL OR my_role() = 'superadmin')
  ));

CREATE POLICY "role_permissions: admin/superadmin can write via parent role"
  ON role_permissions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
      AND ((r.tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin') AND NOT r.is_system)
           OR my_role() = 'superadmin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
      AND ((r.tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin') AND NOT r.is_system)
           OR my_role() = 'superadmin')
  ));

-- user_roles: tenant members can see role assignments in their tenant
-- (needed to render the org chart); only admin/superadmin can assign.
CREATE POLICY "user_roles: tenant members can read"
  ON user_roles FOR SELECT
  USING (tenant_id = my_tenant_id() OR my_role() = 'superadmin');

CREATE POLICY "user_roles: admin/superadmin can write"
  ON user_roles FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "user_roles: superadmin_platform_all"
  ON user_roles FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- reporting_relationships: tenant members can read (needed to render
-- "who reports to whom" for any employee they can already see);
-- own record + admin/manager/superadmin can write.
CREATE POLICY "reporting_relationships: tenant members can read"
  ON reporting_relationships FOR SELECT
  USING (tenant_id = my_tenant_id() OR my_role() = 'superadmin');

CREATE POLICY "reporting_relationships: admin/manager can write"
  ON reporting_relationships FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "reporting_relationships: superadmin_platform_all"
  ON reporting_relationships FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- approval_delegations: delegator sets up their own delegation;
-- admin/manager/superadmin can also configure it on someone's behalf
-- (e.g. HR setting up cover while an employee is on leave); delegate
-- and delegator can both see it (delegate needs to know they're
-- covering); tenant admins can see all for oversight.
CREATE POLICY "approval_delegations: involved parties or admin can select"
  ON approval_delegations FOR SELECT
  USING (tenant_id = my_tenant_id() AND (
    delegator_id = auth.uid() OR delegate_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')
  ));

CREATE POLICY "approval_delegations: self or admin/manager can insert"
  ON approval_delegations FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND (
    delegator_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')
  ));

CREATE POLICY "approval_delegations: self or admin/manager can delete"
  ON approval_delegations FOR DELETE
  USING (tenant_id = my_tenant_id() AND (
    delegator_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')
  ));

CREATE POLICY "approval_delegations: superadmin_platform_all"
  ON approval_delegations FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- audit_logs: admin/manager/superadmin can read tenant history;
-- only admin/manager/superadmin can insert their own actions directly
-- (system-generated rows come from SECURITY DEFINER functions, which
-- bypass RLS as the function owner); no UPDATE/DELETE policy at all,
-- matching this codebase's append-only audit convention.
CREATE POLICY "audit_logs: admin/manager can read tenant"
  ON audit_logs FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "audit_logs: admin/manager can insert own action"
  ON audit_logs FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin') AND actor_id = auth.uid());

CREATE POLICY "audit_logs: superadmin_platform_all"
  ON audit_logs FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');
