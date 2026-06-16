-- ============================================================
-- Probation period + Promotion history
-- 2026-06-15
-- ============================================================

-- 1. Probation fields on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS probation_months       INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS probation_earned_leaves INT  NOT NULL DEFAULT 0;

-- 2. Promotion / salary-increment history table
CREATE TABLE IF NOT EXISTS employee_promotions (
  id                UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID    NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id        UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  effective_date    DATE    NOT NULL,
  old_designation   TEXT,
  new_designation   TEXT,
  old_ctc           NUMERIC(12,2),
  new_ctc           NUMERIC(12,2),
  increment_amount  NUMERIC(12,2) GENERATED ALWAYS AS (new_ctc - COALESCE(old_ctc, 0)) STORED,
  notes             TEXT,
  created_by        UUID    REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE employee_promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ep_tenant_select" ON employee_promotions FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "ep_admin_insert" ON employee_promotions FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
  ));
