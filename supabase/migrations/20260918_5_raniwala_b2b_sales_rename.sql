-- Renames Raniwala Jewellers' "Sales" outlet to "B2B SALES". outlets.name is
-- a plain, unconstrained text column (supabase/migrations/20260725_super_admin_platform.sql)
-- with no code or RLS logic keyed off the literal string "Sales" anywhere in
-- src/ (confirmed) — this is purely a data rename, scoped to Raniwala only.
--
-- Confirmed against the live DB the outlet is named exactly "Sales" (not
-- "Sales Outlet" as the 20260917_2 migration's own comment called it) — 7
-- employees assigned, all reassigned by nothing here (this only renames the
-- outlet, no employees move).
--
-- Also updates any Raniwala employee's profiles.outlet_location (the
-- separate free-text "Branch Name" field, not derived from outlets.name —
-- see 20260611_employee_id_transfers.sql) that literally says "Sales", so
-- the two don't drift apart.

DO $$
DECLARE
  v_tenant  uuid;
  v_outlet  uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  SELECT id INTO v_outlet FROM outlets WHERE tenant_id = v_tenant AND name = 'Sales';
  IF v_outlet IS NULL THEN
    RAISE EXCEPTION 'Outlet "Sales" not found for Raniwala (tenant %) -- aborting, nothing changed', v_tenant;
  END IF;

  UPDATE outlets SET name = 'B2B SALES' WHERE id = v_outlet;

  UPDATE profiles SET outlet_location = 'B2B SALES'
  WHERE tenant_id = v_tenant AND outlet_location = 'Sales';

  RAISE NOTICE 'Renamed outlet % to B2B SALES for Raniwala (tenant %)', v_outlet, v_tenant;
END $$;
