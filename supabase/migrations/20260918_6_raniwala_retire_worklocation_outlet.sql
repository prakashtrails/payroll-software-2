-- Retires Raniwala Jewellers' "Worklocation" outlet: its one assigned
-- employee moves to Office Staff, then the outlet row itself is deleted
-- (not deactivated) per explicit instruction.
--
-- Safety: this asserts exactly one employee is currently assigned to
-- Worklocation before touching anything, and aborts with a clear error
-- (nothing changed) if that assumption doesn't hold, rather than silently
-- reassigning an unexpected group.
--
-- FK note: outlets is referenced by profiles.outlet_id (ON DELETE SET NULL),
-- company_feature_toggles.outlet_id (ON DELETE CASCADE), holidays.outlet_id
-- (ON DELETE CASCADE), and a few other ON DELETE SET NULL references
-- (headcount_requests, hierarchy locations, live-tracking toggles, essl
-- devices) — all of those resolve themselves automatically on delete. The
-- one exception is employee_outlet_transfers.to_outlet_id, which is NOT NULL
-- with no ON DELETE action: if Worklocation appears in any historical
-- transfer record, this migration will fail with a foreign-key-violation
-- error (audit trail intentionally left un-cascaded) rather than delete
-- silently — if that happens, deactivating the outlet instead of deleting it
-- is the fallback, but reassigning the transfer history is not.

DO $$
DECLARE
  v_tenant     uuid;
  v_worklocation uuid;
  v_office     uuid;
  v_emp_count  int;
  v_emp_id     uuid;
  v_emp_name   text;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  SELECT id INTO v_worklocation FROM outlets WHERE tenant_id = v_tenant AND name = 'Worklocation';
  IF v_worklocation IS NULL THEN
    RAISE EXCEPTION 'Outlet "Worklocation" not found for Raniwala (tenant %) -- aborting, nothing changed', v_tenant;
  END IF;

  SELECT id INTO v_office FROM outlets WHERE tenant_id = v_tenant AND name = 'Office Staff';
  IF v_office IS NULL THEN
    RAISE EXCEPTION 'Outlet "Office Staff" not found for Raniwala (tenant %) -- run 20260917_2_raniwala_timing_attendance_policy.sql first -- aborting, nothing changed', v_tenant;
  END IF;

  SELECT count(*) INTO v_emp_count FROM profiles WHERE tenant_id = v_tenant AND outlet_id = v_worklocation;
  IF v_emp_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 employee assigned to Worklocation, found % -- aborting, nothing changed. Review manually before retrying.', v_emp_count;
  END IF;

  SELECT id, first_name || ' ' || last_name INTO v_emp_id, v_emp_name
  FROM profiles WHERE tenant_id = v_tenant AND outlet_id = v_worklocation;

  UPDATE profiles
  SET outlet_id = v_office,
      outlet_location = CASE WHEN outlet_location = 'Worklocation' THEN 'Office Staff' ELSE outlet_location END
  WHERE id = v_emp_id;

  DELETE FROM company_feature_toggles WHERE tenant_id = v_tenant AND outlet_id = v_worklocation;

  DELETE FROM outlets WHERE id = v_worklocation;

  RAISE NOTICE 'Reassigned % (profile %) from Worklocation to Office Staff, then deleted the Worklocation outlet for Raniwala (tenant %)', v_emp_name, v_emp_id, v_tenant;
END $$;
