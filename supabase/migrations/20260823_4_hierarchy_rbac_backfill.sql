-- =============================================================
-- Hierarchy & Workflow Engine — Phase 1d: backfill
--
-- Seeds default hierarchy levels + global system roles + a starter
-- permission catalog + role_permissions reproducing today's RLS-implied
-- access, then backfills reporting_relationships and user_roles from
-- existing profiles.manager_id / profiles.role. Fully idempotent
-- (safe to re-run) and additive: no existing row in profiles,
-- request_quotas, approval_chains, etc. is touched or removed.
-- =============================================================

-- ── 1. Default hierarchy levels per tenant (spec §2 default template) ──
INSERT INTO hierarchy_levels (tenant_id, name, rank)
SELECT t.id, lvl.name, lvl.rank
FROM tenants t
CROSS JOIN (VALUES
  ('HR / Company Admin', 1),
  ('HOD / Department Head', 2),
  ('Manager / Team Lead', 3),
  ('Employee', 4)
) AS lvl(name, rank)
WHERE NOT EXISTS (
  SELECT 1 FROM hierarchy_levels hl WHERE hl.tenant_id = t.id AND hl.rank = lvl.rank
);

-- ── 2. Global system roles, one per existing legacy role string ──
INSERT INTO roles (tenant_id, name, is_system)
SELECT NULL, r.name, true
FROM (VALUES ('superadmin'), ('admin'), ('manager'), ('employee')) AS r(name)
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = r.name);

-- ── 3. Starter permission catalog (summarizes today's RLS-implied
--    access per module; expand per-module as each is migrated to the
--    workflow engine in later phases) ──
INSERT INTO permissions (key, category, description) VALUES
  ('profile.view.self',            'Employee',  'View own profile'),
  ('profile.edit.self',            'Employee',  'Edit allowed own profile fields'),
  ('attendance.punch',             'Employee',  'Punch in / punch out'),
  ('attendance.view.self',         'Employee',  'View own attendance'),
  ('leave.apply',                  'Employee',  'Apply for leave'),
  ('leave.view.self',              'Employee',  'View own leave status'),
  ('requests.submit',              'Employee',  'Submit special/regularize/WFH/expense requests'),
  ('payslip.view.self',            'Employee',  'View own payslips if enabled'),

  ('team.view',                    'Manager',   'View direct reports'),
  ('team.attendance.view',         'Manager',   'View team attendance / punch records'),
  ('team.leave.view',              'Manager',   'View team leave'),
  ('team.leave.approve',           'Manager',   'Approve/reject team leave and requests'),
  ('team.requests.view',           'Manager',   'View team requests'),
  ('team.reports.view',            'Manager',   'View team reports'),

  ('department.view',              'HOD',       'View entire department'),
  ('department.attendance.view',   'HOD',       'View department attendance'),
  ('department.employees.view',    'HOD',       'View department employees'),
  ('department.requests.approve',  'HOD',       'Approve department requests'),
  ('department.reports.view',      'HOD',       'Department reports / analytics'),

  ('employees.manage',             'HR',        'Employee management (create/update/offboard)'),
  ('departments.manage',           'HR',        'Department management'),
  ('attendance.manage',            'HR',        'Attendance management'),
  ('leave.manage',                 'HR',        'Leave management'),
  ('shifts.manage',                'HR',        'Shift management'),
  ('onboarding.manage',            'HR',        'Employee onboarding'),
  ('offboarding.manage',           'HR',        'Employee offboarding'),
  ('transfers.manage',             'HR',        'Employee transfers'),
  ('org.reports.view',             'HR',        'Organization reports'),
  ('workflows.configure',          'HR',        'Approval configuration where permitted'),

  ('tenant.settings.manage',       'Tenant Admin', 'Organization settings'),
  ('tenant.roles.manage',          'Tenant Admin', 'Roles & permissions configuration'),
  ('tenant.hierarchy.manage',      'Tenant Admin', 'Hierarchy / org structure configuration'),
  ('tenant.workflows.manage',      'Tenant Admin', 'Workflow configuration'),
  ('tenant.integrations.manage',   'Tenant Admin', 'Integrations'),

  ('platform.tenants.manage',      'Super Admin', 'Create/configure/suspend tenants'),
  ('platform.hierarchy.configure', 'Super Admin', 'Configure tenant hierarchy'),
  ('platform.workflows.configure', 'Super Admin', 'Configure global workflow templates'),
  ('platform.permissions.configure','Super Admin','Configure global permission templates'),
  ('platform.audit.view',          'Super Admin', 'Audit tenant activity')
ON CONFLICT (key) DO NOTHING;

-- ── 4. Grant permissions to the 4 system roles, reproducing today's
--    RLS-implied tiered access (employee < manager < admin < superadmin) ──
WITH role_ids AS (
  SELECT id, name FROM roles WHERE tenant_id IS NULL AND is_system
),
grants(role_name, perm_key, scope) AS (
  VALUES
    -- employee
    ('employee','profile.view.self','SELF'), ('employee','profile.edit.self','SELF'),
    ('employee','attendance.punch','SELF'),   ('employee','attendance.view.self','SELF'),
    ('employee','leave.apply','SELF'),        ('employee','leave.view.self','SELF'),
    ('employee','requests.submit','SELF'),    ('employee','payslip.view.self','SELF'),
    -- manager: everything employee has, plus team scope
    ('manager','profile.view.self','SELF'),   ('manager','profile.edit.self','SELF'),
    ('manager','attendance.punch','SELF'),    ('manager','attendance.view.self','SELF'),
    ('manager','leave.apply','SELF'),         ('manager','leave.view.self','SELF'),
    ('manager','requests.submit','SELF'),     ('manager','payslip.view.self','SELF'),
    ('manager','team.view','DIRECT_REPORTS'), ('manager','team.attendance.view','DIRECT_REPORTS'),
    ('manager','team.leave.view','DIRECT_REPORTS'), ('manager','team.leave.approve','DIRECT_REPORTS'),
    ('manager','team.requests.view','DIRECT_REPORTS'), ('manager','team.reports.view','DIRECT_REPORTS'),
    -- admin: HR/tenant-admin scope, entire tenant
    ('admin','profile.view.self','SELF'),     ('admin','profile.edit.self','SELF'),
    ('admin','attendance.punch','SELF'),      ('admin','attendance.view.self','SELF'),
    ('admin','leave.apply','SELF'),           ('admin','leave.view.self','SELF'),
    ('admin','requests.submit','SELF'),       ('admin','payslip.view.self','SELF'),
    ('admin','team.view','ENTIRE_TENANT'),    ('admin','team.attendance.view','ENTIRE_TENANT'),
    ('admin','team.leave.view','ENTIRE_TENANT'), ('admin','team.leave.approve','ENTIRE_TENANT'),
    ('admin','team.requests.view','ENTIRE_TENANT'), ('admin','team.reports.view','ENTIRE_TENANT'),
    ('admin','department.view','ENTIRE_TENANT'), ('admin','department.attendance.view','ENTIRE_TENANT'),
    ('admin','department.employees.view','ENTIRE_TENANT'), ('admin','department.requests.approve','ENTIRE_TENANT'),
    ('admin','department.reports.view','ENTIRE_TENANT'),
    ('admin','employees.manage','ENTIRE_TENANT'), ('admin','departments.manage','ENTIRE_TENANT'),
    ('admin','attendance.manage','ENTIRE_TENANT'), ('admin','leave.manage','ENTIRE_TENANT'),
    ('admin','shifts.manage','ENTIRE_TENANT'), ('admin','onboarding.manage','ENTIRE_TENANT'),
    ('admin','offboarding.manage','ENTIRE_TENANT'), ('admin','transfers.manage','ENTIRE_TENANT'),
    ('admin','org.reports.view','ENTIRE_TENANT'), ('admin','workflows.configure','ENTIRE_TENANT'),
    ('admin','tenant.settings.manage','ENTIRE_TENANT'), ('admin','tenant.roles.manage','ENTIRE_TENANT'),
    ('admin','tenant.hierarchy.manage','ENTIRE_TENANT'), ('admin','tenant.workflows.manage','ENTIRE_TENANT'),
    ('admin','tenant.integrations.manage','ENTIRE_TENANT'),
    -- superadmin: everything, global scope
    ('superadmin','platform.tenants.manage','GLOBAL'), ('superadmin','platform.hierarchy.configure','GLOBAL'),
    ('superadmin','platform.workflows.configure','GLOBAL'), ('superadmin','platform.permissions.configure','GLOBAL'),
    ('superadmin','platform.audit.view','GLOBAL'),
    ('superadmin','employees.manage','GLOBAL'), ('superadmin','departments.manage','GLOBAL'),
    ('superadmin','attendance.manage','GLOBAL'), ('superadmin','leave.manage','GLOBAL'),
    ('superadmin','tenant.settings.manage','GLOBAL'), ('superadmin','tenant.roles.manage','GLOBAL'),
    ('superadmin','tenant.hierarchy.manage','GLOBAL'), ('superadmin','tenant.workflows.manage','GLOBAL')
)
INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT ri.id, p.id, g.scope
FROM grants g
JOIN role_ids ri ON ri.name = g.role_name
JOIN permissions p ON p.key = g.perm_key
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 5. Backfill reporting_relationships (DIRECT_MANAGER) from the
--    existing profiles.manager_id used today by the performance module.
--    profiles.tenant_id is nullable (platform-level superadmin profiles
--    have no tenant — see analysis doc §1), and reporting_relationships.
--    tenant_id is NOT NULL, so those profiles are skipped here; they
--    have no place in a per-tenant reporting chain anyway. ──
INSERT INTO reporting_relationships (tenant_id, profile_id, related_profile_id, relationship_type, is_primary, valid_from)
SELECT p.tenant_id, p.id, p.manager_id, 'DIRECT_MANAGER', true, COALESCE(p.join_date, current_date)
FROM profiles p
WHERE p.manager_id IS NOT NULL
  AND p.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM reporting_relationships rr
    WHERE rr.profile_id = p.id AND rr.relationship_type = 'DIRECT_MANAGER' AND rr.valid_to IS NULL
  );

-- ── 6. Backfill user_roles: every profile gets the system role
--    matching their existing profiles.role string, department-scoped
--    by best-effort name match against the tenant's departments table
--    (profiles.department is free text — see analysis doc §2 gap).
--    Same tenant_id-nullable guard as step 5: a superadmin profile with
--    no tenant_id is a platform-level account, not a tenant role
--    assignment, so it's intentionally left out of user_roles — their
--    access keeps working via the existing my_role() = 'superadmin'
--    bypass policies untouched by this migration. ──
INSERT INTO user_roles (tenant_id, profile_id, role_id, department_id, valid_from)
SELECT p.tenant_id, p.id, r.id, d.id, COALESCE(p.join_date, current_date)
FROM profiles p
JOIN roles r ON r.tenant_id IS NULL AND r.is_system AND r.name = p.role
LEFT JOIN departments d ON d.tenant_id = p.tenant_id AND d.name = p.department
WHERE p.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.profile_id = p.id AND ur.role_id = r.id AND ur.valid_to IS NULL
  );
