-- =============================================================
-- Performance Management: KRAs, 1:1 Meetings, Feedback, PIP, Reviews
-- Run this after supabase_migration.sql (relies on my_tenant_id(), my_role())
-- =============================================================

-- ── manager/reporting-line link ───────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES profiles(id);

-- ── KRAs (Key Result Areas) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS kras (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id       uuid REFERENCES profiles(id) ON DELETE CASCADE, -- NULL = company-wide KRA
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  scope            text NOT NULL DEFAULT 'individual' CHECK (scope IN ('individual','company')),
  weight           numeric NOT NULL DEFAULT 0,
  period_start     date,
  period_end       date,
  progress_percent numeric NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed','Archived')),
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kras_tenant ON kras(tenant_id, profile_id);

CREATE TABLE IF NOT EXISTS kra_kpis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kra_id     uuid REFERENCES kras(id) ON DELETE CASCADE,
  title      text NOT NULL,
  target     text NOT NULL DEFAULT '',
  achieved   text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kra_kpis_kra ON kra_kpis(kra_id);

ALTER TABLE kras ENABLE ROW LEVEL SECURITY;
ALTER TABLE kra_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kras: select own, company-wide, or admin/manager"
  ON kras FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id IS NULL OR profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));

CREATE POLICY "kras: admin/manager can insert"
  ON kras FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "kras: admin/manager can update"
  ON kras FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "kras: owner can update own progress"
  ON kras FOR UPDATE
  USING (tenant_id = my_tenant_id() AND profile_id = auth.uid());

CREATE POLICY "kras: admin/manager can delete"
  ON kras FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "kra_kpis: select via parent kra"
  ON kra_kpis FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM kras k WHERE k.id = kra_kpis.kra_id
      AND k.tenant_id = my_tenant_id()
      AND (k.profile_id IS NULL OR k.profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin'))
  ));

CREATE POLICY "kra_kpis: admin/manager can insert"
  ON kra_kpis FOR INSERT
  WITH CHECK (
    my_role() IN ('admin','manager','superadmin')
    AND EXISTS (SELECT 1 FROM kras k WHERE k.id = kra_kpis.kra_id AND k.tenant_id = my_tenant_id())
  );

CREATE POLICY "kra_kpis: admin/manager can update"
  ON kra_kpis FOR UPDATE
  USING (
    my_role() IN ('admin','manager','superadmin')
    AND EXISTS (SELECT 1 FROM kras k WHERE k.id = kra_kpis.kra_id AND k.tenant_id = my_tenant_id())
  );

CREATE POLICY "kra_kpis: admin/manager can delete"
  ON kra_kpis FOR DELETE
  USING (
    my_role() IN ('admin','manager','superadmin')
    AND EXISTS (SELECT 1 FROM kras k WHERE k.id = kra_kpis.kra_id AND k.tenant_id = my_tenant_id())
  );

-- ── Agenda templates & 1:1 meetings ───────────────────────────
CREATE TABLE IF NOT EXISTS agenda_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id),
  title      text NOT NULL,
  content    text NOT NULL DEFAULT '',
  is_shared  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_templates_tenant ON agenda_templates(tenant_id);

CREATE TABLE IF NOT EXISTS one_on_ones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenants(id) ON DELETE CASCADE,
  organizer_id       uuid REFERENCES profiles(id) ON DELETE CASCADE,
  participant_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  title              text NOT NULL DEFAULT '1:1 Meeting',
  agenda_template_id uuid REFERENCES agenda_templates(id),
  agenda_content     text NOT NULL DEFAULT '',
  meeting_date       date NOT NULL,
  start_time         time,
  end_time           time,
  location           text NOT NULL DEFAULT '',
  status             text NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Completed','Cancelled')),
  summary            text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_one_on_ones_tenant ON one_on_ones(tenant_id, meeting_date DESC);

ALTER TABLE agenda_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE one_on_ones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agenda_templates: select own or shared"
  ON agenda_templates FOR SELECT
  USING (tenant_id = my_tenant_id() AND (is_shared OR created_by = auth.uid() OR my_role() IN ('admin','superadmin')));

CREATE POLICY "agenda_templates: tenant member can insert own"
  ON agenda_templates FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND created_by = auth.uid());

CREATE POLICY "agenda_templates: owner or admin can update"
  ON agenda_templates FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (created_by = auth.uid() OR my_role() IN ('admin','superadmin')));

CREATE POLICY "agenda_templates: owner or admin can delete"
  ON agenda_templates FOR DELETE
  USING (tenant_id = my_tenant_id() AND (created_by = auth.uid() OR my_role() IN ('admin','superadmin')));

CREATE POLICY "one_on_ones: participants or admin can select"
  ON one_on_ones FOR SELECT
  USING (tenant_id = my_tenant_id() AND (organizer_id = auth.uid() OR participant_id = auth.uid() OR my_role() IN ('admin','superadmin')));

CREATE POLICY "one_on_ones: organizer can insert"
  ON one_on_ones FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND organizer_id = auth.uid());

CREATE POLICY "one_on_ones: participants or admin can update"
  ON one_on_ones FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (organizer_id = auth.uid() OR participant_id = auth.uid() OR my_role() IN ('admin','superadmin')));

CREATE POLICY "one_on_ones: organizer or admin can delete"
  ON one_on_ones FOR DELETE
  USING (tenant_id = my_tenant_id() AND (organizer_id = auth.uid() OR my_role() IN ('admin','superadmin')));

-- ── Feedback (praise, feedback, and feedback requests) ────────
CREATE TABLE IF NOT EXISTS feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES profiles(id) NOT NULL,
  from_profile_id uuid REFERENCES profiles(id),
  to_profile_id   uuid REFERENCES profiles(id) NOT NULL,
  requested_from  uuid REFERENCES profiles(id),
  type            text NOT NULL DEFAULT 'feedback' CHECK (type IN ('praise','feedback','request')),
  message         text NOT NULL DEFAULT '',
  visibility      text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  status          text NOT NULL DEFAULT 'Completed' CHECK (status IN ('Pending','Completed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_tenant ON feedback(tenant_id, to_profile_id, created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feedback: involved parties or admin can select"
  ON feedback FOR SELECT
  USING (tenant_id = my_tenant_id() AND (
    created_by = auth.uid() OR from_profile_id = auth.uid() OR to_profile_id = auth.uid()
    OR requested_from = auth.uid() OR my_role() IN ('admin','superadmin')
  ));

CREATE POLICY "feedback: tenant member can insert own"
  ON feedback FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND created_by = auth.uid());

CREATE POLICY "feedback: requester or requested party can update"
  ON feedback FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (requested_from = auth.uid() OR created_by = auth.uid() OR my_role() IN ('admin','superadmin')));

CREATE POLICY "feedback: admin can delete"
  ON feedback FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

-- ── Performance Improvement Plans ─────────────────────────────
CREATE TABLE IF NOT EXISTS pips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id    uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  manager_id    uuid REFERENCES profiles(id),
  created_by    uuid REFERENCES profiles(id),
  reason        text NOT NULL,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'In Process' CHECK (status IN ('In Process','Completed')),
  outcome       text CHECK (outcome IN ('Passed','Extended','Exited')),
  outcome_notes text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pips_tenant ON pips(tenant_id, profile_id);

CREATE TABLE IF NOT EXISTS pip_goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id      uuid REFERENCES pips(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  target_date date,
  status      text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Achieved','Missed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pip_goals_pip ON pip_goals(pip_id);

CREATE TABLE IF NOT EXISTS pip_checkins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id     uuid REFERENCES pips(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES profiles(id),
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pip_checkins_pip ON pip_checkins(pip_id);

ALTER TABLE pips ENABLE ROW LEVEL SECURITY;
ALTER TABLE pip_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pip_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pips: own, managing, or admin/manager can select"
  ON pips FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR manager_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));

CREATE POLICY "pips: admin/manager can insert"
  ON pips FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "pips: admin/manager can update"
  ON pips FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "pips: admin can delete"
  ON pips FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "pip_goals: select via parent pip"
  ON pip_goals FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM pips pp WHERE pp.id = pip_goals.pip_id AND pp.tenant_id = my_tenant_id()
      AND (pp.profile_id = auth.uid() OR pp.manager_id = auth.uid() OR my_role() IN ('admin','manager','superadmin'))
  ));

CREATE POLICY "pip_goals: admin/manager can insert"
  ON pip_goals FOR INSERT
  WITH CHECK (
    my_role() IN ('admin','manager','superadmin')
    AND EXISTS (SELECT 1 FROM pips pp WHERE pp.id = pip_goals.pip_id AND pp.tenant_id = my_tenant_id())
  );

CREATE POLICY "pip_goals: admin/manager can update"
  ON pip_goals FOR UPDATE
  USING (
    my_role() IN ('admin','manager','superadmin')
    AND EXISTS (SELECT 1 FROM pips pp WHERE pp.id = pip_goals.pip_id AND pp.tenant_id = my_tenant_id())
  );

CREATE POLICY "pip_goals: admin/manager can delete"
  ON pip_goals FOR DELETE
  USING (
    my_role() IN ('admin','manager','superadmin')
    AND EXISTS (SELECT 1 FROM pips pp WHERE pp.id = pip_goals.pip_id AND pp.tenant_id = my_tenant_id())
  );

CREATE POLICY "pip_checkins: select via parent pip"
  ON pip_checkins FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM pips pp WHERE pp.id = pip_checkins.pip_id AND pp.tenant_id = my_tenant_id()
      AND (pp.profile_id = auth.uid() OR pp.manager_id = auth.uid() OR my_role() IN ('admin','manager','superadmin'))
  ));

CREATE POLICY "pip_checkins: admin/manager can insert own"
  ON pip_checkins FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND my_role() IN ('admin','manager','superadmin')
    AND EXISTS (SELECT 1 FROM pips pp WHERE pp.id = pip_checkins.pip_id AND pp.tenant_id = my_tenant_id())
  );

-- ── Performance reviews ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_cycles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  status     text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_cycles_tenant ON review_cycles(tenant_id);

CREATE TABLE IF NOT EXISTS review_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  cycle_id      uuid REFERENCES review_cycles(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  order_index   int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_questions_cycle ON review_questions(cycle_id, order_index);

CREATE TABLE IF NOT EXISTS reviews (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES tenants(id) ON DELETE CASCADE,
  cycle_id             uuid REFERENCES review_cycles(id) ON DELETE CASCADE,
  profile_id           uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  reporting_manager_id uuid REFERENCES profiles(id),
  overall_rating       numeric,
  status               text NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started','In Progress','Completed')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id, profile_id);

CREATE TABLE IF NOT EXISTS review_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   uuid REFERENCES reviews(id) ON DELETE CASCADE,
  question_id uuid REFERENCES review_questions(id) ON DELETE CASCADE,
  answered_by uuid REFERENCES profiles(id),
  rating      numeric,
  comment     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, question_id, answered_by)
);
CREATE INDEX IF NOT EXISTS idx_review_answers_review ON review_answers(review_id);

CREATE TABLE IF NOT EXISTS review_kra_ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id     uuid REFERENCES reviews(id) ON DELETE CASCADE,
  kra_id        uuid REFERENCES kras(id) ON DELETE CASCADE,
  rated_by      uuid REFERENCES profiles(id),
  rating        numeric,
  feedback_text text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, kra_id, rated_by)
);
CREATE INDEX IF NOT EXISTS idx_review_kra_ratings_review ON review_kra_ratings(review_id);

ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_kra_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "review_cycles: tenant members can select"
  ON review_cycles FOR SELECT
  USING (tenant_id = my_tenant_id());

CREATE POLICY "review_cycles: admin can insert"
  ON review_cycles FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "review_cycles: admin can update"
  ON review_cycles FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "review_cycles: admin can delete"
  ON review_cycles FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "review_questions: tenant members can select"
  ON review_questions FOR SELECT
  USING (tenant_id = my_tenant_id());

CREATE POLICY "review_questions: admin can insert"
  ON review_questions FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "review_questions: admin can update"
  ON review_questions FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "review_questions: admin can delete"
  ON review_questions FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "reviews: reviewee, manager, or admin can select"
  ON reviews FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR reporting_manager_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));

CREATE POLICY "reviews: admin can insert"
  ON reviews FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "reviews: reviewee, manager, or admin can update"
  ON reviews FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR reporting_manager_id = auth.uid() OR my_role() IN ('admin','superadmin')));

CREATE POLICY "reviews: admin can delete"
  ON reviews FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "review_answers: select via parent review"
  ON review_answers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM reviews r WHERE r.id = review_answers.review_id AND r.tenant_id = my_tenant_id()
      AND (r.profile_id = auth.uid() OR r.reporting_manager_id = auth.uid() OR my_role() IN ('admin','manager','superadmin'))
  ));

CREATE POLICY "review_answers: reviewee, manager, or admin can insert own answer"
  ON review_answers FOR INSERT
  WITH CHECK (
    answered_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM reviews r WHERE r.id = review_answers.review_id AND r.tenant_id = my_tenant_id()
        AND (r.profile_id = auth.uid() OR r.reporting_manager_id = auth.uid() OR my_role() IN ('admin','superadmin'))
    )
  );

CREATE POLICY "review_answers: author or admin can update"
  ON review_answers FOR UPDATE
  USING (answered_by = auth.uid() OR my_role() IN ('admin','superadmin'));

CREATE POLICY "review_kra_ratings: select via parent review"
  ON review_kra_ratings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM reviews r WHERE r.id = review_kra_ratings.review_id AND r.tenant_id = my_tenant_id()
      AND (r.profile_id = auth.uid() OR r.reporting_manager_id = auth.uid() OR my_role() IN ('admin','manager','superadmin'))
  ));

CREATE POLICY "review_kra_ratings: manager or admin can insert"
  ON review_kra_ratings FOR INSERT
  WITH CHECK (
    rated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM reviews r WHERE r.id = review_kra_ratings.review_id AND r.tenant_id = my_tenant_id()
        AND (r.reporting_manager_id = auth.uid() OR my_role() IN ('admin','superadmin'))
    )
  );

CREATE POLICY "review_kra_ratings: rater or admin can update"
  ON review_kra_ratings FOR UPDATE
  USING (rated_by = auth.uid() OR my_role() IN ('admin','superadmin'));
