-- =============================================================
-- Raniwala Jewellers -- clean up stray mixed/lower-case department and
-- division spellings (e.g. "Acc", "B2b", "B2c") left over from manual entry
-- before HR's ALL-CAPS master spreadsheet was imported (see
-- 20260917_6_raniwala_employee_master_caps.sql). Every employee keeps the
-- department/division they're actually assigned to (just normalized to
-- upper case) -- nothing is unassigned or deleted from profiles. Only the
-- redundant lower-case rows in the `departments` master list (used to
-- populate the Add/Edit Employee dropdown) are removed, since an
-- upper-case duplicate now exists for every one of them.
--
-- Scope: Raniwala Jewellers tenant only.
-- =============================================================

DO $$
DECLARE
  v_tenant_id uuid;
  v_dept_normalized int;
  v_div_normalized  int;
  v_dept_removed    int;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE company_name ILIKE '%Raniwala%' LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found';
  END IF;

  -- 1. Upper-case every employee's department/division first, so no profile
  --    is left pointing at a mixed-case value right before its master-list
  --    row is removed below.
  UPDATE profiles
  SET department = upper(department)
  WHERE tenant_id = v_tenant_id AND department IS NOT NULL AND department <> upper(department);
  GET DIAGNOSTICS v_dept_normalized = ROW_COUNT;

  UPDATE profiles
  SET division = upper(division)
  WHERE tenant_id = v_tenant_id AND division IS NOT NULL AND division <> upper(division);
  GET DIAGNOSTICS v_div_normalized = ROW_COUNT;

  -- 2. Make sure every now-upper-cased department has a master-list row
  --    (covers a department that, before step 1, only ever existed in
  --    mixed case with no upper-case row yet).
  INSERT INTO departments (tenant_id, name)
  SELECT DISTINCT v_tenant_id, p.department
  FROM profiles p
  WHERE p.tenant_id = v_tenant_id AND p.department IS NOT NULL AND p.department <> ''
  ON CONFLICT (tenant_id, name) DO NOTHING;

  -- 3. Drop the now-redundant mixed/lower-case department rows from the
  --    master list -- nothing in `profiles` references them any more after
  --    step 1.
  DELETE FROM departments
  WHERE tenant_id = v_tenant_id AND name <> upper(name);
  GET DIAGNOSTICS v_dept_removed = ROW_COUNT;

  RAISE NOTICE 'Raniwala case cleanup: % profiles.department upper-cased, % profiles.division upper-cased, % stray lower-case department master rows removed',
    v_dept_normalized, v_div_normalized, v_dept_removed;
END $$;
