-- =============================================================
-- Platform capabilities: configurable per-tenant approval chains
-- (opt-in override of the hard-coded self/manager/admin leave tiers),
-- plus a consolidated note on this build's audit posture and the
-- pg_cron jobs it scheduled.
-- =============================================================

-- Not a generic workflow engine — deliberately small: an ordered list of
-- roles per entity type, which approvalService.js consults as an OPTIONAL
-- override. The existing request_quotas self/manager/admin auto-approval
-- tiers (requestQuotaService.js) keep working unchanged when no chain is
-- configured for a tenant — this only kicks in where an admin has opted in.
CREATE TABLE IF NOT EXISTS approval_chains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL, -- 'leave_requests' | 'wfh_requests' | 'special_requests' | 'expense_claims' | 'travel_requests'
  steps       jsonb NOT NULL DEFAULT '[]', -- [{ "role": "manager", "order": 1 }, { "role": "admin", "order": 2 }]
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_approval_chains_tenant ON approval_chains(tenant_id);

ALTER TABLE approval_chains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approval_chains: tenant members can select"
  ON approval_chains FOR SELECT
  USING (tenant_id = my_tenant_id());
CREATE POLICY "approval_chains: admin can write"
  ON approval_chains FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));


-- =============================================================
-- Audit posture (documentation, no schema change here) —
--
-- This build's new tables follow the same append-only pattern as the
-- existing attendance_audit_log: leave_ledger, fnf_settlements, and
-- payroll_gl_entries all have SELECT policies for admin/manager but NO
-- client-facing INSERT/UPDATE/DELETE policy — every row is written by a
-- SECURITY DEFINER RPC (record_leave_deduction, compute_fnf_settlement,
-- process_payroll_by_country, ...) that authorizes the caller itself. That
-- gives an immutable, attributable history without building Frappe's full
-- submit/cancel/amend document lifecycle.
--
-- pg_cron jobs scheduled across this build (visible via `SELECT * FROM
-- cron.job` on a project where the extension is available):
--   leave-monthly-accrual            → run_monthly_leave_accrual()          (1st of month, 01:00 UTC)
--   leave-yearly-carry-forward       → run_yearly_leave_carry_forward()     (Apr 1, 02:00 UTC)
--   attendance-nightly-absent-sweep  → mark_attendance_from_punches(...)    (daily, 20:30 UTC)
-- =============================================================
