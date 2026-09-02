-- =============================================================
-- 1) Unlimited leave types (e.g. "Unpaid Leave") — an employee can take as
--    many of these as they need; the balance ring for it never depletes.
-- 2) leave_balances_detail — same ledger the "balance" view already sums,
--    but also splits out how many days were actually allocated/credited
--    (what HR "entered" for the employee via LeaveBalancesPage → Allocate,
--    plus any accrual/carry-forward) vs. how many have been used. The old
--    `leave_balances` view only ever exposed the net remaining number, so
--    the employee's own Leave page had no way to show "X of Y remaining" —
--    only "X left", with no ring to put it in. Run after 20260813_1.
-- =============================================================

ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS is_unlimited boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW leave_balances_detail AS
  SELECT
    tenant_id, profile_id, leave_type_id,
    SUM(days) AS balance,
    SUM(CASE WHEN days > 0 THEN days ELSE 0 END) AS allocated,
    SUM(CASE WHEN days < 0 THEN -days ELSE 0 END) AS used
  FROM leave_ledger
  GROUP BY tenant_id, profile_id, leave_type_id;

-- Give every existing tenant an "Unpaid Leave" type if they don't already
-- have one — new tenants get it from DEFAULT_LEAVE_TYPES (leaveLedgerService.js)
-- the first time they open Leave Types, so this backfill only matters for
-- tenants that were seeded before this migration.
INSERT INTO leave_types (tenant_id, name, is_paid, carry_forward, max_carry_forward_days, accrual_frequency, accrual_days, annual_quota, encashable, max_continuous_days, is_active, is_unlimited)
SELECT t.id, 'Unpaid Leave', false, false, 0, 'none', 0, 0, false, NULL, true, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types lt WHERE lt.tenant_id = t.id AND lt.name = 'Unpaid Leave'
);
