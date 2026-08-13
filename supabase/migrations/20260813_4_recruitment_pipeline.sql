-- =============================================================
-- Recruitment pipeline completion: headcount approval gating job
-- postings, interview scheduling + feedback, and offer letters —
-- layered onto the existing job_postings/referrals tables (today's
-- uncommitted work) rather than rebuilding candidate intake.
-- Run after supabase_migration.sql + 20260812_hiring_referrals.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS headcount_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id      uuid REFERENCES outlets(id) ON DELETE SET NULL,
  designation    text NOT NULL,
  count          int  NOT NULL DEFAULT 1,
  justification  text NOT NULL DEFAULT '',
  budget_amount  numeric NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  requested_by   uuid REFERENCES profiles(id),
  approved_by    uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_headcount_requests_tenant ON headcount_requests(tenant_id, status);

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS headcount_request_id uuid REFERENCES headcount_requests(id) ON DELETE SET NULL;

ALTER TABLE headcount_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "headcount_requests: tenant members can select"
  ON headcount_requests FOR SELECT
  USING (tenant_id = my_tenant_id());
CREATE POLICY "headcount_requests: manager can insert"
  ON headcount_requests FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('manager','admin','superadmin') AND requested_by = auth.uid());
CREATE POLICY "headcount_requests: admin can update"
  ON headcount_requests FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));
CREATE POLICY "headcount_requests: admin can delete"
  ON headcount_requests FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));


-- ── Interview scheduling & feedback (against a referral/candidate row) ────
CREATE TABLE IF NOT EXISTS interviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  referral_id    uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  round_name     text NOT NULL DEFAULT 'Round 1',
  interviewer_id uuid REFERENCES profiles(id),
  scheduled_at   timestamptz,
  status         text NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Completed','Cancelled')),
  created_by     uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interviews_tenant   ON interviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_interviews_referral ON interviews(referral_id);
CREATE INDEX IF NOT EXISTS idx_interviews_interviewer ON interviews(interviewer_id, scheduled_at);

CREATE TABLE IF NOT EXISTS interview_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id   uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  interviewer_id uuid NOT NULL REFERENCES profiles(id),
  ratings        jsonb NOT NULL DEFAULT '{}', -- { "communication": 4, "technical": 3, "culture_fit": 5 }
  recommendation text NOT NULL DEFAULT 'Neutral' CHECK (recommendation IN ('Strong Yes','Yes','Neutral','No','Strong No')),
  comments       text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, interviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_interview_feedback_interview ON interview_feedback(interview_id);

ALTER TABLE interviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interviews: interviewer or admin/manager can select"
  ON interviews FOR SELECT
  USING (tenant_id = my_tenant_id() AND (interviewer_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "interviews: admin/manager can insert"
  ON interviews FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "interviews: interviewer or admin/manager can update"
  ON interviews FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (interviewer_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "interviews: admin/manager can delete"
  ON interviews FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "interview_feedback: interviewer or admin/manager can select"
  ON interview_feedback FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM interviews i WHERE i.id = interview_feedback.interview_id AND i.tenant_id = my_tenant_id()
      AND (i.interviewer_id = auth.uid() OR my_role() IN ('admin','manager','superadmin'))
  ));
CREATE POLICY "interview_feedback: interviewer can insert own"
  ON interview_feedback FOR INSERT
  WITH CHECK (
    interviewer_id = auth.uid()
    AND EXISTS (SELECT 1 FROM interviews i WHERE i.id = interview_feedback.interview_id AND i.tenant_id = my_tenant_id())
  );
CREATE POLICY "interview_feedback: interviewer can update own"
  ON interview_feedback FOR UPDATE
  USING (interviewer_id = auth.uid());


-- ── Offer letters ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS letter_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type       text NOT NULL DEFAULT 'Offer' CHECK (type IN ('Offer','Appointment')),
  name       text NOT NULL,
  body_html  text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_letter_templates_tenant ON letter_templates(tenant_id, type);

CREATE TABLE IF NOT EXISTS offer_letters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  referral_id    uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  template_id    uuid REFERENCES letter_templates(id),
  ctc_offered    numeric NOT NULL DEFAULT 0,
  joining_date   date,
  designation    text NOT NULL DEFAULT '',
  rendered_html  text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Sent','Accepted','Declined')),
  created_by     uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offer_letters_tenant   ON offer_letters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_offer_letters_referral ON offer_letters(referral_id);

ALTER TABLE letter_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_letters    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "letter_templates: admin/manager can select"
  ON letter_templates FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "letter_templates: admin can write"
  ON letter_templates FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "offer_letters: admin/manager can select"
  ON offer_letters FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "offer_letters: admin/manager can write"
  ON offer_letters FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
