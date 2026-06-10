-- Weekly Off Comp Off system for employees with CTC >= 30,000
-- These employees do not receive overtime pay. Instead, if they miss their
-- weekly off for an entire month (all WO days worked, zero comp off leaves
-- taken), they earn 1 comp off credited to their balance (valid 1 year).
-- Partial compensation: if some WOs missed but insufficient leaves taken,
-- unused comp offs expire at month end with no carry-over.

-- Add configurable weekly off day to tenants (0=Sunday … 6=Saturday)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS weekly_off_day SMALLINT NOT NULL DEFAULT 0
  CONSTRAINT chk_weekly_off_day CHECK (weekly_off_day BETWEEN 0 AND 6);

-- Add comp off balance to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS comp_off_balance INTEGER NOT NULL DEFAULT 0
  CONSTRAINT chk_comp_off_balance CHECK (comp_off_balance >= 0);

-- Monthly settlement log per employee
CREATE TABLE IF NOT EXISTS weekly_off_settlements (
  id                   UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID      NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id           UUID      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month                SMALLINT  NOT NULL CHECK (month  BETWEEN 1 AND 12),
  year                 SMALLINT  NOT NULL,
  weekly_offs_in_month SMALLINT  NOT NULL DEFAULT 0,
  weekly_offs_worked   SMALLINT  NOT NULL DEFAULT 0,
  comp_leaves_used     SMALLINT  NOT NULL DEFAULT 0,
  -- 'none'     : employee didn't miss any WO this month
  -- 'balanced' : leaves taken were enough to offset missed WOs
  -- 'credited' : worked all WOs with no comp leaves → +1 comp off (1-year validity)
  -- 'expired'  : partial miss with insufficient leaves → unused comp offs expire
  settlement_type      TEXT      NOT NULL CHECK (settlement_type IN ('none','balanced','credited','expired')),
  comp_offs_credited   SMALLINT  NOT NULL DEFAULT 0,
  settled_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ,
  UNIQUE (profile_id, month, year)
);

ALTER TABLE weekly_off_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view settlements"
  ON weekly_off_settlements FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Admins can manage settlements"
  ON weekly_off_settlements FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles
    WHERE id = auth.uid() AND role IN ('admin','manager')
  ));
