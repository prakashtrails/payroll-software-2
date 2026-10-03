-- PMS replacement — persistent schema for the new Performance workspace.
--
-- Additive only: creates new pms_* tables. The legacy kras / kra_kpis /
-- kra_checkins / review_* tables are untouched because the mobile app still
-- reads and writes them.
--
-- Access model: every pms_* table has RLS enabled, NO policies, and no table
-- privileges for anon/authenticated. All reads go through pms_workspace() and
-- all writes through the pms_* RPCs in 20260928_2_pms_rpc.sql (SECURITY
-- DEFINER, tenant + role + hierarchy + workflow-state checks). A direct
-- PostgREST request to any pms_* table is therefore denied.
--
-- Months are FY-relative: 0 = April … 11 = March of fy+1.

-- ─── Tenant policy + cycle questionnaire ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pms_settings (
  tenant_id       uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  fy              int     NOT NULL CHECK (fy BETWEEN 2000 AND 2100),
  kpi_weight      numeric NOT NULL DEFAULT 70  CHECK (kpi_weight BETWEEN 0 AND 100),
  cap             numeric NOT NULL DEFAULT 120 CHECK (cap BETWEEN 100 AND 200),
  deadline        date,
  reminders       boolean NOT NULL DEFAULT true,
  cycle_questions jsonb   NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cycle_questions) = 'array'),
  row_version     int     NOT NULL DEFAULT 1,
  updated_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Goals / alignment tree ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pms_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fy            int  NOT NULL,
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  scope         text NOT NULL CHECK (scope IN ('Company','Department','Team','Individual')),
  department    text CHECK (length(department) <= 120),
  team          text CHECK (length(team) <= 120),
  owner_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  parent_id     uuid REFERENCES public.pms_goals(id) ON DELETE RESTRICT,
  annual_target numeric CHECK (annual_target IS NULL OR annual_target > 0),
  unit          text CHECK (length(unit) <= 40),
  allocation    text NOT NULL DEFAULT 'Aligned' CHECK (allocation IN ('Aligned','Allocated')),
  row_version   int  NOT NULL DEFAULT 1,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (scope = 'Company' OR parent_id IS NOT NULL),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (allocation = 'Aligned' OR (annual_target IS NOT NULL AND unit IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pms_goals_tenant_fy_idx ON public.pms_goals (tenant_id, fy);
CREATE INDEX IF NOT EXISTS pms_goals_parent_idx    ON public.pms_goals (parent_id);

-- ─── KPIs (employee and organisational scorecards) ───────────────────────
-- owner_type 'Employee' ⇒ owner_id is the profile UUID as text and
-- employee_id is set; otherwise owner_id is the unit name ('Company', a
-- department or a team name), matching profiles.department text.
CREATE TABLE IF NOT EXISTS public.pms_kpis (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fy               int  NOT NULL,
  owner_type       text NOT NULL CHECK (owner_type IN ('Employee','Company','Department','Team')),
  owner_id         text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 120),
  employee_id      uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id          uuid NOT NULL REFERENCES public.pms_goals(id) ON DELETE RESTRICT,
  kra              text NOT NULL CHECK (length(btrim(kra)) BETWEEN 1 AND 120),
  kra_weight       numeric NOT NULL CHECK (kra_weight > 0 AND kra_weight <= 100),
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  weight           numeric NOT NULL CHECK (weight > 0 AND weight <= 100),
  kind             text NOT NULL DEFAULT 'Volume'
                   CHECK (kind IN ('Volume','Rate','Weighted average','Snapshot','Milestone','Rubric','Zero incidents')),
  unit             text NOT NULL DEFAULT '' CHECK (length(unit) <= 40),
  target           numeric,
  targets          numeric[] CHECK (targets IS NULL OR cardinality(targets) = 12),
  direction        text NOT NULL DEFAULT 'Higher' CHECK (direction IN ('Higher','Lower')),
  frequency        text NOT NULL DEFAULT 'Monthly' CHECK (frequency IN ('Monthly','Quarterly','Annual')),
  aggregation      text NOT NULL DEFAULT 'Sum' CHECK (aggregation IN ('Sum','Average')),
  data_source      text NOT NULL DEFAULT 'Manual' CHECK (data_source IN ('Manual','Imported report reference')),
  submitter_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approver_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  milestones       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(milestones) = 'array'),
  shared_source_id uuid REFERENCES public.pms_kpis(id) ON DELETE RESTRICT,
  row_version      int  NOT NULL DEFAULT 1,
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type = 'Employee') = (employee_id IS NOT NULL)),
  CHECK (owner_type <> 'Employee' OR owner_id = employee_id::text),
  CHECK (shared_source_id IS NULL OR owner_type = 'Employee')
);
CREATE INDEX IF NOT EXISTS pms_kpis_tenant_fy_idx ON public.pms_kpis (tenant_id, fy);
CREATE INDEX IF NOT EXISTS pms_kpis_owner_idx     ON public.pms_kpis (tenant_id, fy, owner_type, owner_id);
CREATE INDEX IF NOT EXISTS pms_kpis_goal_idx      ON public.pms_kpis (goal_id);
CREATE INDEX IF NOT EXISTS pms_kpis_shared_idx    ON public.pms_kpis (shared_source_id) WHERE shared_source_id IS NOT NULL;

-- ─── Monthly measurement inputs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pms_kpi_updates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kpi_id        uuid NOT NULL REFERENCES public.pms_kpis(id) ON DELETE CASCADE,
  month         smallint NOT NULL CHECK (month BETWEEN 0 AND 11),
  applicability text NOT NULL DEFAULT 'Measured' CHECK (applicability IN ('Measured','N/A')),
  actual        numeric,
  numerator     numeric,
  denominator   numeric,
  completed     text[] NOT NULL DEFAULT '{}',
  note          text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  status        text NOT NULL CHECK (status IN ('Submitted','Confirmed','Returned')),
  reason        text CHECK (length(reason) <= 2000),
  submitted_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  UNIQUE (kpi_id, month)
);
CREATE INDEX IF NOT EXISTS pms_kpi_updates_tenant_idx ON public.pms_kpi_updates (tenant_id, status);

-- ─── Scorecard approval workflow ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pms_scorecards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fy             int  NOT NULL,
  owner_type     text NOT NULL CHECK (owner_type IN ('Employee','Company','Department','Team')),
  owner_id       text NOT NULL,
  status         text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Pending approval','Locked')),
  revision       int  NOT NULL DEFAULT 1 CHECK (revision >= 1),
  approver_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_request jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fy, owner_type, owner_id)
);

-- Deep snapshot captured by the server at each approval.
CREATE TABLE IF NOT EXISTS public.pms_scorecard_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scorecard_id uuid NOT NULL REFERENCES public.pms_scorecards(id) ON DELETE CASCADE,
  revision     int  NOT NULL,
  snapshot     jsonb NOT NULL,
  approved_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scorecard_id, revision)
);

-- ─── Cycle appraisals (self + manager + HR release) ──────────────────────
CREATE TABLE IF NOT EXISTS public.pms_cycle_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fy                int  NOT NULL,
  period            text NOT NULL CHECK (period IN ('Q1','Q2','Q3','Q4','FY')),
  employee_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'Not started'
                    CHECK (status IN ('Not started','Self submitted','Manager submitted','Released')),
  questions         jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  self_answers      jsonb,
  manager_answers   jsonb,
  manager_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  released_policy   jsonb,
  released_snapshot jsonb,
  released_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  released_at       timestamptz,
  launched_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fy, period, employee_id)
);

-- ─── Independent review template library ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pms_review_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  family      uuid NOT NULL,
  version     int  NOT NULL CHECK (version >= 1),
  status      text NOT NULL CHECK (status IN ('Draft','Published','Archived')),
  type        text NOT NULL CHECK (type IN ('Self','Manager','Peer','Upward','Interdepartmental','360','Project','Custom')),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  scored      boolean NOT NULL DEFAULT false,
  questions   jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, family, version)
);

-- ─── Independent review campaigns + reviewer assignments ─────────────────
CREATE TABLE IF NOT EXISTS public.pms_review_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  template_id   uuid REFERENCES public.pms_review_templates(id) ON DELETE SET NULL,
  template      jsonb NOT NULL,           -- frozen copy of the published version
  subject       jsonb NOT NULL,           -- {type,id,name,department}
  recipient_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  visibility    text NOT NULL CHECK (visibility IN ('Named','Confidential')),
  status        text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Active','Released','Cancelled')),
  cancel_reason text,
  released_at   timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS pms_review_campaigns_tenant_idx ON public.pms_review_campaigns (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.pms_review_assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id          uuid NOT NULL REFERENCES public.pms_review_campaigns(id) ON DELETE CASCADE,
  reviewer_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role                 text NOT NULL,
  status               text NOT NULL DEFAULT 'Not started'
                       CHECK (status IN ('Not started','In progress','Submitted','Returned')),
  answers              jsonb NOT NULL DEFAULT '{}'::jsonb,
  score                numeric,
  submitted_at         timestamptz,
  reason               text,
  previous_submissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS pms_review_assignments_reviewer_idx ON public.pms_review_assignments (reviewer_id);

-- ─── Append-only audit trail ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pms_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  actor_id    uuid,              -- no FK: a SET NULL cascade would be an UPDATE, which the log forbids
  revision    int,
  reason      text,
  detail      jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pms_audit_log_entity_idx ON public.pms_audit_log (entity_type, entity_id);

CREATE OR REPLACE FUNCTION public.pms_audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Rows vanish only through tenant/profile cascade deletes, never edits.
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'pms_audit_log is append-only';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS pms_audit_log_no_update ON public.pms_audit_log;
CREATE TRIGGER pms_audit_log_no_update BEFORE UPDATE ON public.pms_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.pms_audit_log_immutable();

-- ─── Lock the tables down: RPC-only access ───────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pms_settings','pms_goals','pms_kpis','pms_kpi_updates','pms_scorecards',
    'pms_scorecard_versions','pms_cycle_reviews','pms_review_templates','pms_review_campaigns',
    'pms_review_assignments','pms_audit_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
