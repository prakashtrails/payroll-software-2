-- Toggle Services: lets a superadmin enable/disable individual CrewCore
-- features per company, and optionally override that per outlet within a
-- company. Additive only, same idiom as 20260725_super_admin_platform.sql —
-- every policy name is new, nothing here assumes or replaces existing policies.

-- ---- 1. features: registry of everything that's toggleable ----
CREATE TABLE IF NOT EXISTS features (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  category    text NOT NULL,
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "features: authenticated select" ON features;
CREATE POLICY "features: authenticated select"
  ON features FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "features: superadmin manage" ON features;
CREATE POLICY "features: superadmin manage"
  ON features FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- ---- 2. company_feature_toggles: the actual on/off state ----
-- outlet_id NULL = company-wide; a non-null outlet_id overrides the
-- company-wide row for that one outlet only. No row at all for a given
-- (tenant, feature) means "enabled" — the default, so every existing tenant
-- keeps 100% of today's functionality with zero rows in this table.
CREATE TABLE IF NOT EXISTS company_feature_toggles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id   uuid REFERENCES outlets(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES features(key) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_cft_tenant_id ON company_feature_toggles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cft_outlet_id ON company_feature_toggles(outlet_id);

-- At most one company-wide row per (tenant, feature)...
CREATE UNIQUE INDEX IF NOT EXISTS idx_cft_company_wide
  ON company_feature_toggles(tenant_id, feature_key)
  WHERE outlet_id IS NULL;

-- ...and at most one row per (tenant, outlet, feature).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cft_outlet_scoped
  ON company_feature_toggles(tenant_id, outlet_id, feature_key)
  WHERE outlet_id IS NOT NULL;

ALTER TABLE company_feature_toggles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_feature_toggles: tenant select own" ON company_feature_toggles;
CREATE POLICY "company_feature_toggles: tenant select own"
  ON company_feature_toggles FOR SELECT
  USING (tenant_id = my_tenant_id() OR my_role() = 'superadmin');

DROP POLICY IF EXISTS "company_feature_toggles: superadmin manage" ON company_feature_toggles;
CREATE POLICY "company_feature_toggles: superadmin manage"
  ON company_feature_toggles FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- ---- 3. Seed the registry ----
-- Dashboard/Home, "Me", and Settings are deliberately absent — they stay
-- always-on so a company never loses its landing page or the ability to fix
-- its own configuration. ON CONFLICT DO UPDATE keeps labels in sync if this
-- migration is edited and re-run.
INSERT INTO features (key, name, category, description, sort_order) VALUES
  ('employees',              'Employees',              'General',     'Employee directory, profiles, and records management.', 10),
  ('attendance',              'Attendance',              'General',     'Daily attendance, punches, and attendance overview.', 20),
  ('shift_roster',            'Shift Roster',            'General',     'Assigning employees to shifts and roster planning.', 30),
  ('employee_calendar',       'Employee Calendar',       'General',     'Calendar view of leave, holidays, and attendance.', 40),
  ('master_report',           'Master Report',           'General',     'Consolidated cross-module reporting.', 50),
  ('helpdesk',                'Helpdesk',                'General',     'Internal support ticketing for employees.', 60),
  ('announcements',           'Announcements',           'General',     'Company-wide announcements and notices.', 70),
  ('policies',                'Policies',                'General',     'Company policy documents.', 80),
  ('training',                'Training & Skills',       'General',     'Training programs and skill tracking.', 90),
  ('grievances',               'Grievances',              'General',     'Employee grievance submission and resolution.', 100),
  ('outlets_multi_branch',    'Outlets / Multi-Branch',  'General',     'Multi-outlet overview, combined and group dashboards.', 110),

  ('leave_requests',          'Leave Requests',          'Requests',    'Employee leave request submission and approval.', 200),
  ('regularize_attendance',   'Regularize Attendance',   'Requests',    'Requests to correct missed or incorrect punches.', 210),
  ('wfh_requests',            'Work From Home',          'Requests',    'Work-from-home request submission and approval.', 220),
  ('special_requests',        'Special Requests',        'Requests',    'Miscellaneous employee requests.', 230),
  ('expense_claims',          'Expense Claims',          'Requests',    'Expense claim submission and reimbursement.', 240),
  ('travel_requests',         'Travel Requests',         'Requests',    'Business travel request and approval.', 250),
  ('leave_setup',             'Leave Setup',              'Requests',    'Leave type and leave balance configuration.', 260),
  ('tax_declaration',         'Tax Declaration',          'Requests',    'Employee income tax declaration.', 270),

  ('hiring',                  'Job Postings',             'Hiring',      'Open job postings and candidate pipeline.', 300),
  ('headcount_requests',      'Headcount Requests',       'Hiring',      'Requests to open new headcount.', 310),
  ('interviews',              'Interviews',                'Hiring',      'Interview scheduling and feedback.', 320),
  ('offer_letters',           'Offer Letters',             'Hiring',      'Offer letter generation and tracking.', 330),
  ('refer',                   'Refer a Candidate',         'Hiring',      'Employee referral submissions.', 340),

  ('performance_kras',        'KRAs',                      'Performance', 'Key result area goal tracking.', 400),
  ('performance_one_on_ones', '1:1 Meetings',              'Performance', 'One-on-one meeting scheduling and notes.', 410),
  ('performance_feedback',    'Feedback',                  'Performance', 'Peer and manager feedback.', 420),
  ('performance_pip',         'PIP',                       'Performance', 'Performance improvement plans.', 430),
  ('performance_reviews',     'Reviews',                   'Performance', 'Formal performance review cycles.', 440),

  ('salary_structure',        'Salary Structure',          'Payroll',     'Employee salary component structure.', 500),
  ('run_payroll',             'Run Payroll',                'Payroll',     'Monthly payroll processing.', 510),
  ('payslips',                'Payslips',                   'Payroll',     'Payslip generation and access.', 520),
  ('advances_loans',          'Advances & Loans',           'Payroll',     'Employee salary advances and loans.', 530),
  ('salary_additions',        'One-Off Pay Items',          'Payroll',     'One-time additions or deductions to pay.', 540),
  ('tax_slabs',                'Income Tax Slabs',           'Payroll',     'Income tax slab configuration.', 550),

  ('approval_chains',         'Approval Chains',            'System',      'Multi-step approval workflow configuration.', 600)
ON CONFLICT (key) DO UPDATE
  SET name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      sort_order = excluded.sort_order;
