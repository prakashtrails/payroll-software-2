-- Hiring: HR posts job openings with a JD; any tenant member can refer a
-- candidate against an open one. No pipeline/kanban — a flat status field on
-- the referral is enough for HR to track outcome without a full ATS board.

CREATE TABLE IF NOT EXISTS job_postings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title               text NOT NULL,
  department          text NOT NULL DEFAULT '',
  location            text NOT NULL DEFAULT '',
  employment_type     text NOT NULL DEFAULT 'Full-time' CHECK (employment_type IN ('Full-time','Part-time','Contract','Internship')),
  experience_required text NOT NULL DEFAULT '',
  openings            int  NOT NULL DEFAULT 1,
  description         text NOT NULL,
  responsibilities    text NOT NULL DEFAULT '',
  requirements        text NOT NULL DEFAULT '',
  referral_bonus      numeric NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','On Hold','Closed')),
  closing_date        date,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_postings_tenant ON job_postings(tenant_id, status);

CREATE TABLE IF NOT EXISTS referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_posting_id  uuid NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  referred_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  candidate_name  text NOT NULL,
  candidate_email text NOT NULL DEFAULT '',
  candidate_phone text NOT NULL DEFAULT '',
  resume_url      text NOT NULL DEFAULT '',
  relationship    text NOT NULL DEFAULT '',
  notes           text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted','Under Review','Shortlisted','Hired','Not Selected')),
  hr_notes        text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_tenant     ON referrals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_posting     ON referrals(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_by ON referrals(referred_by);

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals    ENABLE ROW LEVEL SECURITY;

-- ---- job_postings ----
CREATE POLICY "job_postings: tenant members see open, admin sees all"
  ON job_postings FOR SELECT
  USING (tenant_id = (select my_tenant_id()) AND (status = 'Open' OR (select my_role()) = 'admin'));

CREATE POLICY "job_postings: admin can manage"
  ON job_postings FOR ALL
  USING (tenant_id = (select my_tenant_id()) AND (select my_role()) = 'admin')
  WITH CHECK (tenant_id = (select my_tenant_id()) AND (select my_role()) = 'admin');

-- ---- referrals ----
CREATE POLICY "referrals: own or admin/manager can select"
  ON referrals FOR SELECT
  USING (tenant_id = (select my_tenant_id()) AND (referred_by = (select auth.uid()) OR (select my_role()) IN ('admin','manager')));

CREATE POLICY "referrals: tenant member can insert own"
  ON referrals FOR INSERT
  WITH CHECK (tenant_id = (select my_tenant_id()) AND referred_by = (select auth.uid()));

CREATE POLICY "referrals: admin/manager can update"
  ON referrals FOR UPDATE
  USING (tenant_id = (select my_tenant_id()) AND (select my_role()) IN ('admin','manager'))
  WITH CHECK (tenant_id = (select my_tenant_id()) AND (select my_role()) IN ('admin','manager'));

CREATE POLICY "referrals: admin can delete"
  ON referrals FOR DELETE
  USING (tenant_id = (select my_tenant_id()) AND (select my_role()) = 'admin');
