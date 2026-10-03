-- =============================================================
-- Raniwala: link everyone HR's HOD.xlsx puts under ABHISHEK SIR /
-- ABHIYANT SIR to their Management accounts (26 Sep 2026).
--
-- Run AFTER HR creates the two accounts (Employees -> Add, role
-- Management). 20260926_9 stored the sheet's names for them in
-- manager_display_name / hod_display_name (matched by EMP CODE); this turns
-- those names into real manager_id / hod_id links and clears the labels.
-- Everyone below those people in the manager_id tree then falls under the
-- owner too (my_team_ids, 20260926_12).
--
-- Org chart (user-approved): Abhiyant Sir (top) -> Abhishek Sir -> heads.
-- Fails loudly unless exactly one active Management account matches each.
-- =============================================================

DO $$
DECLARE
  v_tenant    uuid := (SELECT id FROM tenants WHERE company_name ILIKE '%Raniwala%' LIMIT 1);
  v_abhishek  uuid;
  v_abhiyant  uuid;
  v_n         int;
BEGIN
  SELECT count(*), min(id::text)::uuid INTO v_n, v_abhishek FROM profiles
  WHERE tenant_id = v_tenant AND role = 'management' AND status = 'Active'
    AND upper(concat_ws(' ', first_name, middle_name, last_name)) LIKE 'ABHISHEK%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'Expected 1 active Management account for ABHISHEK SIR, found %', v_n; END IF;

  SELECT count(*), min(id::text)::uuid INTO v_n, v_abhiyant FROM profiles
  WHERE tenant_id = v_tenant AND role = 'management' AND status = 'Active'
    AND upper(concat_ws(' ', first_name, middle_name, last_name)) LIKE 'ABHIYANT%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'Expected 1 active Management account for ABHIYANT SIR, found %', v_n; END IF;

  UPDATE profiles SET manager_id = v_abhishek, manager_display_name = NULL
  WHERE tenant_id = v_tenant AND manager_id IS NULL AND manager_display_name = 'ABHISHEK SIR';
  UPDATE profiles SET manager_id = v_abhiyant, manager_display_name = NULL
  WHERE tenant_id = v_tenant AND manager_id IS NULL AND manager_display_name = 'ABHIYANT SIR';

  UPDATE profiles SET hod_id = v_abhishek, hod_display_name = NULL
  WHERE tenant_id = v_tenant AND hod_id IS NULL AND hod_display_name = 'ABHISHEK SIR';
  UPDATE profiles SET hod_id = v_abhiyant, hod_display_name = NULL
  WHERE tenant_id = v_tenant AND hod_id IS NULL AND hod_display_name = 'ABHIYANT SIR';

  -- Abhiyant Sir sits above Abhishek Sir.
  UPDATE profiles SET manager_id = v_abhiyant WHERE id = v_abhishek AND manager_id IS NULL;
END $$;
