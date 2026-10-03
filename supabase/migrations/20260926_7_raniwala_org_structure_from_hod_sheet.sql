-- Raniwala: align the reporting tree with HR's HOD sheet (HOD.xlsx, 26 Sep 2026).
-- Matched by EMP CODE (profiles.employee_id). Only the rows that differed
-- from the sheet are touched; ~235 of 251 codes already matched.
--
-- 'ABHISHEK SIR' / 'ABHIYANT SIR' have no employee record. Anyone whose
-- sheet manager is one of them stays with manager_id = NULL and the web
-- org chart shows them under a display-only "MD" card.
--
-- Mirrors set_direct_manager(): closes the active DIRECT_MANAGER edge in
-- reporting_relationships, opens a new one, and updates profiles.manager_id.

DO $$
DECLARE
  v_tenant uuid;
  r record;
  v_emp uuid;
  v_mgr uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%raniwala%';
  IF v_tenant IS NULL THEN RETURN; END IF;

  -- 1) Backfill codes for profiles that exist without one (name + department
  --    both match the sheet row; codes checked unused across all tenants).
  UPDATE profiles p SET employee_id = v.code
    FROM (VALUES ('786','BISHNU','CAD'), ('787','RANJIT','LASER'),
                 ('788','ANIL','REPAIR'), ('789','DEEPAK','CASTING')) v(code, fname, dept)
   WHERE p.tenant_id = v_tenant AND p.employee_id IS NULL
     AND p.first_name = v.fname AND p.department = v.dept
     AND NOT EXISTS (SELECT 1 FROM profiles x WHERE x.employee_id = v.code);

  -- 2) Department corrections from the sheet.
  UPDATE profiles SET department = 'PURCHASE' WHERE tenant_id = v_tenant AND employee_id = '440';
  UPDATE profiles SET department = 'POLISH'   WHERE tenant_id = v_tenant AND employee_id = '695';

  -- 3) Manager corrections: (employee code, manager code; NULL = under MD).
  FOR r IN
    SELECT * FROM (VALUES
      ('184','60'), ('280','60'), ('320','60'), ('346','60'), ('384','60'), ('539','60'),
      ('425','451'), ('440','242'), ('460','461'), ('695','519'), ('71','253'),
      ('327', NULL)
    ) t(emp_code, mgr_code)
  LOOP
    SELECT id INTO v_emp FROM profiles WHERE tenant_id = v_tenant AND employee_id = r.emp_code;
    v_mgr := NULL;
    IF r.mgr_code IS NOT NULL THEN
      SELECT id INTO v_mgr FROM profiles WHERE tenant_id = v_tenant AND employee_id = r.mgr_code;
      CONTINUE WHEN v_mgr IS NULL;
    END IF;
    CONTINUE WHEN v_emp IS NULL;
    CONTINUE WHEN (SELECT manager_id FROM profiles WHERE id = v_emp) IS NOT DISTINCT FROM v_mgr;

    UPDATE reporting_relationships SET valid_to = current_date
     WHERE profile_id = v_emp AND relationship_type = 'DIRECT_MANAGER' AND is_primary AND valid_to IS NULL;
    IF v_mgr IS NOT NULL THEN
      INSERT INTO reporting_relationships (tenant_id, profile_id, related_profile_id, relationship_type, is_primary, valid_from)
      VALUES (v_tenant, v_emp, v_mgr, 'DIRECT_MANAGER', true, current_date);
    END IF;
    UPDATE profiles SET manager_id = v_mgr WHERE id = v_emp;
  END LOOP;

  -- 4) GHAT / FILING / FILLING workers pointed at the INACTIVE "PALASH BARMAN"
  --    profile, so they fell out of the tree. Move them to the active
  --    "POLASH BARMAN" profile (same person — the sheet's PALASH BARMAN, 546),
  --    and put him under his HOD Ramesh Kumar Yadav (707), since the sheet
  --    lists him as his own manager.
  v_mgr := (SELECT id FROM profiles WHERE tenant_id = v_tenant AND employee_id = '707');
  FOR r IN
    SELECT a.id AS active_id, i.id AS inactive_id
      FROM profiles a JOIN profiles i
        ON i.tenant_id = a.tenant_id AND i.first_name = 'PALASH' AND i.last_name = 'BARMAN' AND i.status = 'Inactive'
     WHERE a.tenant_id = v_tenant AND a.first_name = 'POLASH' AND a.last_name = 'BARMAN' AND a.status = 'Active'
  LOOP
    UPDATE reporting_relationships SET valid_to = current_date
     WHERE related_profile_id = r.inactive_id AND relationship_type = 'DIRECT_MANAGER' AND is_primary AND valid_to IS NULL
       AND profile_id IN (SELECT id FROM profiles WHERE manager_id = r.inactive_id AND status = 'Active');
    INSERT INTO reporting_relationships (tenant_id, profile_id, related_profile_id, relationship_type, is_primary, valid_from)
    SELECT v_tenant, id, r.active_id, 'DIRECT_MANAGER', true, current_date
      FROM profiles WHERE manager_id = r.inactive_id AND status = 'Active';
    UPDATE profiles SET manager_id = r.active_id WHERE manager_id = r.inactive_id AND status = 'Active';

    IF v_mgr IS NOT NULL AND (SELECT manager_id FROM profiles WHERE id = r.active_id) IS DISTINCT FROM v_mgr THEN
      UPDATE reporting_relationships SET valid_to = current_date
       WHERE profile_id = r.active_id AND relationship_type = 'DIRECT_MANAGER' AND is_primary AND valid_to IS NULL;
      INSERT INTO reporting_relationships (tenant_id, profile_id, related_profile_id, relationship_type, is_primary, valid_from)
      VALUES (v_tenant, r.active_id, v_mgr, 'DIRECT_MANAGER', true, current_date);
      UPDATE profiles SET manager_id = v_mgr WHERE id = r.active_id;
    END IF;
  END LOOP;
END $$;
