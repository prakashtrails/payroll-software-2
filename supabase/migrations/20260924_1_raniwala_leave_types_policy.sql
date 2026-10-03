-- =============================================================
-- Raniwala Jewellers' written Holiday & Leave Policy
-- ("4. Holiday_Leave_Policy.pdf") applied onto the leave-type config
-- (leave_types / leave_ledger, 20260813_1_leave_ledger.sql). Scoped
-- entirely to Raniwala's tenant_id — every other tenant is untouched.
--
-- Every tenant (including Raniwala, until now) was seeded on day one
-- with three generic Keka-style types (20260813_8_keka_leave_categories.sql):
-- Planned Leave, Emergency Leave, Unplanned Leave. Raniwala's actual
-- written policy names three different types with different rules, so
-- this migration:
--   1. Deactivates the generic types for Raniwala only (is_active = false)
--      so they stop accruing/appearing on the leave-request form. Their
--      historical ledger entries are left untouched — nothing is deleted.
--   2. Creates Raniwala's three policy-defined types, self-correcting
--      (ON CONFLICT ... DO UPDATE) so re-running this migration always
--      brings the config back in line with the written policy:
--        - Earned Leave      : accrues 1.5 days/month, carry-forward
--                               capped at 30 days, encashable only at
--                               Full & Final Settlement (annual_quota 18
--                               is the full-year reference figure the
--                               policy quotes; actual balance is accrual-
--                               driven via the ledger, matching the doc's
--                               "1.5 days per month of service").
--        - Marriage Leave    : 2 days, no carry-forward, not encashable.
--        - Misfortune Leave  : 1 day (bereavement, immediate family only),
--                               no carry-forward, not encashable.
--
-- Annual/Festival Holidays (10-12 days/year per the same policy) is NOT
-- a leave type -- it's the company holiday calendar, already handled by
-- the outlets/holidays tables (20260917_4/_5_*.sql) and untouched here.
-- =============================================================

DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  UPDATE leave_types
    SET is_active = false
    WHERE tenant_id = v_tenant
      AND name IN ('Planned Leave', 'Emergency Leave', 'Unplanned Leave');

  INSERT INTO leave_types (tenant_id, name, is_paid, carry_forward, max_carry_forward_days, accrual_frequency, accrual_days, annual_quota, encashable, max_continuous_days, is_active)
  VALUES (v_tenant, 'Earned Leave', true, true, 30, 'monthly', 1.5, 18, true, NULL, true)
  ON CONFLICT (tenant_id, name) DO UPDATE SET
    is_paid = EXCLUDED.is_paid, carry_forward = EXCLUDED.carry_forward,
    max_carry_forward_days = EXCLUDED.max_carry_forward_days,
    accrual_frequency = EXCLUDED.accrual_frequency, accrual_days = EXCLUDED.accrual_days,
    annual_quota = EXCLUDED.annual_quota, encashable = EXCLUDED.encashable,
    max_continuous_days = EXCLUDED.max_continuous_days, is_active = true;

  INSERT INTO leave_types (tenant_id, name, is_paid, carry_forward, max_carry_forward_days, accrual_frequency, accrual_days, annual_quota, encashable, max_continuous_days, is_active)
  VALUES (v_tenant, 'Marriage Leave', true, false, 0, 'none', 0, 2, false, 2, true)
  ON CONFLICT (tenant_id, name) DO UPDATE SET
    is_paid = EXCLUDED.is_paid, carry_forward = EXCLUDED.carry_forward,
    max_carry_forward_days = EXCLUDED.max_carry_forward_days,
    accrual_frequency = EXCLUDED.accrual_frequency, accrual_days = EXCLUDED.accrual_days,
    annual_quota = EXCLUDED.annual_quota, encashable = EXCLUDED.encashable,
    max_continuous_days = EXCLUDED.max_continuous_days, is_active = true;

  INSERT INTO leave_types (tenant_id, name, is_paid, carry_forward, max_carry_forward_days, accrual_frequency, accrual_days, annual_quota, encashable, max_continuous_days, is_active)
  VALUES (v_tenant, 'Misfortune Leave', true, false, 0, 'none', 0, 1, false, 1, true)
  ON CONFLICT (tenant_id, name) DO UPDATE SET
    is_paid = EXCLUDED.is_paid, carry_forward = EXCLUDED.carry_forward,
    max_carry_forward_days = EXCLUDED.max_carry_forward_days,
    accrual_frequency = EXCLUDED.accrual_frequency, accrual_days = EXCLUDED.accrual_days,
    annual_quota = EXCLUDED.annual_quota, encashable = EXCLUDED.encashable,
    max_continuous_days = EXCLUDED.max_continuous_days, is_active = true;
END $$;
