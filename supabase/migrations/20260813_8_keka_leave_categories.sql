-- =============================================================
-- Keka-style leave categories: seeds three leave types (Emergency,
-- Planned, Unplanned) for every existing tenant, with an opening
-- allocation for every active employee, so the leave balance ledger
-- (20260813_1_leave_ledger.sql) has something real to show on day one
-- instead of every balance reading zero until an admin manually
-- allocates. Idempotent — safe to run more than once.
-- =============================================================

INSERT INTO leave_types (tenant_id, name, is_paid, carry_forward, max_carry_forward_days, accrual_frequency, accrual_days, annual_quota, encashable, max_continuous_days)
SELECT id, 'Planned Leave', true, true, 5, 'yearly', 12, 12, true, NULL FROM tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO leave_types (tenant_id, name, is_paid, carry_forward, max_carry_forward_days, accrual_frequency, accrual_days, annual_quota, encashable, max_continuous_days)
SELECT id, 'Emergency Leave', true, false, 0, 'yearly', 5, 5, false, 3 FROM tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO leave_types (tenant_id, name, is_paid, carry_forward, max_carry_forward_days, accrual_frequency, accrual_days, annual_quota, encashable, max_continuous_days)
SELECT id, 'Unplanned Leave', false, false, 0, 'none', 0, 6, false, NULL FROM tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Opening balance for every active employee, matching each type's annual_quota.
INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, note)
SELECT p.tenant_id, p.id, lt.id, 'Allocation', lt.annual_quota, 'Opening balance'
FROM profiles p
JOIN leave_types lt ON lt.tenant_id = p.tenant_id AND lt.name IN ('Planned Leave', 'Emergency Leave', 'Unplanned Leave')
WHERE p.status = 'Active' AND p.role IN ('employee', 'admin', 'manager')
  AND NOT EXISTS (
    SELECT 1 FROM leave_ledger l WHERE l.profile_id = p.id AND l.leave_type_id = lt.id AND l.entry_type = 'Allocation'
  );
