-- Raniwala: merge spelling-duplicate department names (user-approved list).
-- Employees move to the kept name first; a duplicate row is then deleted
-- from `departments` only if no profile, designation or user_role still
-- uses it. Historical text (payslips, GL entries) is left as recorded.

DO $$
DECLARE
  v_tenant uuid;
  r record;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%raniwala%';
  IF v_tenant IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('FILLING',                'FILING'),
      ('E-COMMERCE',             'ECOM'),
      ('SOCIAL MEDIA MARKETING', 'SOCIAL MEDIA & MARKETING'),
      ('SOCIAL MEDIA',           'SOCIAL MEDIA & MARKETING'),
      ('Q.C DEPARTMENT',         'QC'),
      ('PLATING & POLISH',       'POLISH & PLATING'),
      ('ACCS',                   'ACCOUNTS')
    ) t(dup, keep)
  LOOP
    -- The kept name must exist as a department before anyone moves to it.
    INSERT INTO departments (tenant_id, name) VALUES (v_tenant, r.keep)
    ON CONFLICT (tenant_id, name) DO NOTHING;

    UPDATE profiles SET department = r.keep WHERE tenant_id = v_tenant AND department = r.dup;
    UPDATE announcements SET department = r.keep WHERE tenant_id = v_tenant AND department = r.dup;
    UPDATE job_postings SET department = r.keep WHERE tenant_id = v_tenant AND department = r.dup;

    DELETE FROM departments d
     WHERE d.tenant_id = v_tenant AND d.name = r.dup
       AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.tenant_id = v_tenant AND p.department = r.dup)
       AND NOT EXISTS (SELECT 1 FROM designations x WHERE x.department_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM user_roles u WHERE u.department_id = d.id);
  END LOOP;
END $$;
