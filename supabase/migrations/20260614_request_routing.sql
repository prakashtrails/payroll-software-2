-- ============================================================
-- Tiered Approval Quota System
-- 2026-06-14
-- ============================================================
-- Flow:
--   Employee: 3 self-approvals/month (auto, no HR needed)
--   After 3  → routes to Manager (Lower HR): up to 5 approvals/employee/month
--   After 5  → routes to Admin (HR): unlimited
-- ============================================================

-- 1. Add routing metadata to all request tables
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS required_approver_role TEXT NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS approval_level TEXT;

ALTER TABLE special_requests
  ADD COLUMN IF NOT EXISTS required_approver_role TEXT NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS approval_level TEXT;

ALTER TABLE regularize_requests
  ADD COLUMN IF NOT EXISTS required_approver_role TEXT NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS approval_level TEXT;

-- 2. Monthly quota tracker (one row per employee per month)
CREATE TABLE IF NOT EXISTS request_quotas (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month                  SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year                   INT      NOT NULL CHECK (year > 2020),
  self_approved_count    INT      NOT NULL DEFAULT 0,
  manager_approved_count INT      NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, profile_id, month, year)
);

ALTER TABLE request_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rq_tenant_select" ON request_quotas FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "rq_tenant_insert" ON request_quotas FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "rq_tenant_update" ON request_quotas FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
