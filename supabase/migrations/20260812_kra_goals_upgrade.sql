-- Keka-style "Goals" tracking, delivered as an upgrade to the existing KRA/KPI
-- feature rather than a parallel table — KRAs already have individual/company
-- scope, weight, period dates, an owner-editable progress %, and are already
-- tied into the review cycle via review_kra_ratings. What's missing versus
-- Keka's Goals is (a) numeric KPI targets instead of free text only, and
-- (b) a progress-history/check-in log, which this migration adds.

ALTER TABLE kra_kpis
  ADD COLUMN IF NOT EXISTS target_value  numeric,
  ADD COLUMN IF NOT EXISTS current_value numeric,
  ADD COLUMN IF NOT EXISTS unit          text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS kra_checkins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kra_id           uuid NOT NULL REFERENCES kras(id) ON DELETE CASCADE,
  author_id        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note             text NOT NULL,
  progress_percent numeric NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kra_checkins_kra ON kra_checkins(kra_id, created_at DESC);

ALTER TABLE kra_checkins ENABLE ROW LEVEL SECURITY;

-- Same visibility rule as kras itself, via the parent (wrapped-select form per
-- 20260810_rls_wrap_functions.sql convention).
CREATE POLICY "kra_checkins: select via parent kra"
  ON kra_checkins FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM kras k WHERE k.id = kra_checkins.kra_id AND k.tenant_id = (select my_tenant_id())
      AND (k.profile_id IS NULL OR k.profile_id = (select auth.uid()) OR (select my_role()) IN ('admin','manager','superadmin'))
  ));

-- Owner logs their own progress, or admin/manager logs on behalf of anyone —
-- mirrors kras' own "owner can update own progress" + "admin/manager can update" split.
CREATE POLICY "kra_checkins: owner or admin/manager can insert"
  ON kra_checkins FOR INSERT
  WITH CHECK (
    author_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM kras k WHERE k.id = kra_checkins.kra_id AND k.tenant_id = (select my_tenant_id())
        AND (k.profile_id = (select auth.uid()) OR (select my_role()) IN ('admin','manager','superadmin'))
    )
  );
-- No UPDATE/DELETE — an immutable log, same as pip_checkins.
