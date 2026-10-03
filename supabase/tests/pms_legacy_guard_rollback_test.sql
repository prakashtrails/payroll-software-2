-- Regression test for the null-applicability fix and the legacy kras/reviews
-- field guards (audit lead pms/owner-update/unrestricted-management-fields).
-- Always ends with RAISE → everything is rolled back.
DO $test$
DECLARE
  t1 uuid := gen_random_uuid(); hr uuid := gen_random_uuid(); mgr uuid := gen_random_uuid();
  ea uuid := gen_random_uuid(); eb uuid := gen_random_uuid();
  ws jsonb; g uuid; k uuid; kra uuid; cyc uuid; rev uuid; log text[] := '{}'; v text;
BEGIN
  INSERT INTO tenants (id, company_name) VALUES (t1, 'PMS guard test');
  INSERT INTO auth.users (id, email) SELECT u, 'pms-guard-' || u || '@example.invalid' FROM unnest(ARRAY[hr,mgr,ea,eb]) u;
  INSERT INTO profiles (id, tenant_id, role, status, first_name, department, manager_id)
  VALUES (hr, t1, 'admin', 'Active', 'Hr', 'HR', NULL), (mgr, t1, 'manager', 'Active', 'Mgr', 'Sales', NULL),
         (ea, t1, 'employee', 'Active', 'Ea', 'Sales', mgr), (eb, t1, 'employee', 'Active', 'Eb', 'Sales', mgr)
  ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, role = EXCLUDED.role, status = EXCLUDED.status,
    department = EXCLUDED.department, manager_id = EXCLUDED.manager_id;
  INSERT INTO kras (tenant_id, profile_id, title, weight, progress_percent, created_by) VALUES (t1, ea, 'Legacy KRA', 10, 0, mgr) RETURNING id INTO kra;
  INSERT INTO review_cycles (tenant_id, name, start_date, end_date) VALUES (t1, 'Legacy cycle', current_date, current_date + 30) RETURNING id INTO cyc;
  INSERT INTO reviews (tenant_id, cycle_id, profile_id, reporting_manager_id, status) VALUES (t1, cyc, ea, mgr, 'Not Started') RETURNING id INTO rev;
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Null applicability no longer bypasses validation.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true);
  ws := pms_create_goal(2026, '{"title":"G","scope":"Company","annualTarget":10,"unit":"u"}'::jsonb || jsonb_build_object('ownerId', hr));
  g := (ws->'goals'->0->>'id')::uuid;
  ws := pms_create_kpi(2026, jsonb_build_object('ownerType','Employee','employeeId',ea,'kra','K','kraWeight',100,'weight',100,'title','Rate',
          'goalId',g,'kind','Rate','target',25,'submitterId',ea,'approverId',mgr));
  k := (ws->'kpis'->0->>'id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_submit_update(k, 3, '{"numerator":50,"denominator":40,"note":"bad"}'); log := log || 'FAIL numerator > denominator accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok invalid rate rejected without applicability key: ' || SQLERRM); END;
  BEGIN PERFORM pms_submit_update(k, 3, '{"note":"no values"}'); log := log || 'FAIL empty measurement accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok missing values rejected: ' || SQLERRM); END;
  ws := pms_submit_update(k, 3, '{"applicability":"N/A","note":"On leave all month"}');
  log := log || (CASE WHEN ws->'kpis'->0->'updates'->'3'->>'applicability' = 'N/A' THEN 'ok ' ELSE 'FAIL ' END || 'explicit N/A still accepted');
  BEGIN PERFORM pms_create_campaign('{"title":"x","subject":{}}'); log := log || 'FAIL employee created campaign'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok campaign creation needs HR: ' || SQLERRM); END;

  -- Legacy kras: owner may only move progress (what web + mobile app do).
  UPDATE kras SET progress_percent = 40 WHERE id = kra;
  log := log || (CASE WHEN (SELECT progress_percent FROM kras WHERE id = kra) = 40 THEN 'ok ' ELSE 'FAIL ' END || 'employee can update own KRA progress (app flow intact)');
  BEGIN UPDATE kras SET weight = 90 WHERE id = kra; log := log || 'FAIL employee changed own KRA weight'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok employee blocked from KRA weight: ' || SQLERRM); END;
  BEGIN UPDATE kras SET title = 'Easy target', progress_percent = 100 WHERE id = kra; log := log || 'FAIL employee changed KRA title'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok employee blocked from KRA title: ' || SQLERRM); END;

  -- Legacy reviews: reviewee may only start; cannot reassign reviewer.
  BEGIN UPDATE reviews SET reporting_manager_id = eb WHERE id = rev; log := log || 'FAIL reviewee reassigned reviewer'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok reviewee cannot reassign reviewer: ' || SQLERRM); END;
  BEGIN UPDATE reviews SET status = 'Completed', overall_rating = 5 WHERE id = rev; log := log || 'FAIL reviewee completed own review'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok reviewee cannot complete/rate: ' || SQLERRM); END;
  UPDATE reviews SET status = 'In Progress' WHERE id = rev AND status = 'Not Started';
  log := log || (CASE WHEN (SELECT status FROM reviews WHERE id = rev) = 'In Progress' THEN 'ok ' ELSE 'FAIL ' END || 'reviewee can start review (app flow intact)');

  -- Manager (reporting manager) can still complete; HR can reassign.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  BEGIN UPDATE reviews SET reporting_manager_id = eb WHERE id = rev; log := log || 'FAIL manager reassigned reviewer'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok manager cannot reassign: ' || SQLERRM); END;
  UPDATE reviews SET status = 'Completed', overall_rating = 4 WHERE id = rev;
  log := log || (CASE WHEN (SELECT status FROM reviews WHERE id = rev) = 'Completed' THEN 'ok ' ELSE 'FAIL ' END || 'reporting manager completes review');
  UPDATE kras SET weight = 25 WHERE id = kra;
  log := log || (CASE WHEN (SELECT weight FROM kras WHERE id = kra) = 25 THEN 'ok ' ELSE 'FAIL ' END || 'manager can still edit KRA definition');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true);
  UPDATE reviews SET reporting_manager_id = eb WHERE id = rev;
  log := log || (CASE WHEN (SELECT reporting_manager_id FROM reviews WHERE id = rev) = eb THEN 'ok ' ELSE 'FAIL ' END || 'HR can reassign reviewer');

  RAISE EXCEPTION 'PMS GUARD TEST REPORT (rolled back) — % checks, % failed%', cardinality(log),
    (SELECT count(*) FROM unnest(log) l WHERE l LIKE 'FAIL%'), E'\n' || array_to_string(log, E'\n');
END
$test$;
