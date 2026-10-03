-- PMS end-to-end workflow + authorization test. SAFE TO RUN ON ANY DATABASE:
-- everything happens inside one DO block that always ends by raising
-- 'PMS TEST REPORT', which aborts and rolls back every row it created
-- (tenants, users, PMS records, notifications). Read the report from the
-- error message. A line starting with "FAIL" is a failed assertion.
DO $test$
DECLARE
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  hr1 uuid := gen_random_uuid(); hr1b uuid := gen_random_uuid(); mgr uuid := gen_random_uuid();
  ea uuid := gen_random_uuid(); eb uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); hr2 uuid := gen_random_uuid();
  fy int := 2026; ws jsonb; g1 uuid; g2 uuid; g3 uuid; k1 uuid; k2 uuid; rv uuid; tpl uuid; camp uuid; asg uuid;
  log text[] := '{}'; n int; v text; td date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  -- ── fixtures (as postgres) ──────────────────────────────────────────────
  INSERT INTO tenants (id, company_name) VALUES (t1, 'PMS rollback test T1'), (t2, 'PMS rollback test T2');
  INSERT INTO auth.users (id, email) SELECT u, 'pms-test-' || u || '@example.invalid' FROM unnest(ARRAY[hr1,hr1b,mgr,ea,eb,outsider,hr2]) u;
  INSERT INTO profiles (id, tenant_id, role, status, first_name, last_name, department, manager_id)
  VALUES (hr1, t1, 'admin', 'Active', 'Hr', 'One', 'HR', NULL), (hr1b, t1, 'admin', 'Active', 'Hr', 'Two', 'HR', NULL),
         (mgr, t1, 'manager', 'Active', 'Mona', 'Manager', 'Sales', NULL),
         (ea, t1, 'employee', 'Active', 'Asha', 'A', 'Sales', mgr), (eb, t1, 'employee', 'Active', 'Bala', 'B', 'Sales', mgr),
         (outsider, t1, 'employee', 'Active', 'Omar', 'Ops', 'Ops', NULL), (hr2, t2, 'admin', 'Active', 'Other', 'Hr', 'HR', NULL)
  ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, role = EXCLUDED.role, status = EXCLUDED.status,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, department = EXCLUDED.department, manager_id = EXCLUDED.manager_id;
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- ── HR opens the workspace: starter templates seeded ────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  ws := pms_workspace(fy);
  log := log || (CASE WHEN jsonb_array_length(ws->'templates') = 8 AND (ws->'caller'->>'isHr')::boolean THEN 'ok ' ELSE 'FAIL ' END || 'HR workspace seeds 8 templates');
  log := log || (CASE WHEN jsonb_array_length(ws->'directory') = 6 THEN 'ok ' ELSE 'FAIL ' END || 'directory = 6 active T1 members, got ' || jsonb_array_length(ws->'directory'));

  -- ── Goals ───────────────────────────────────────────────────────────────
  ws := pms_create_goal(fy, jsonb_build_object('title','Grow revenue','description','x','scope','Company','ownerId',hr1,'annualTarget',1200,'unit','INR lakh'));
  g1 := (SELECT (g->>'id')::uuid FROM jsonb_array_elements(ws->'goals') g WHERE g->>'title' = 'Grow revenue');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_create_goal(fy, jsonb_build_object('title','Mgr company','scope','Company','ownerId',mgr)); log := log || 'FAIL manager created a company goal'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok manager blocked from company goal: ' || SQLERRM); END;
  ws := pms_create_goal(fy, jsonb_build_object('title','Sales revenue','scope','Department','department','Sales','ownerId',mgr,'parentId',g1,'allocation','Allocated','annualTarget',800));
  g2 := (SELECT (g->>'id')::uuid FROM jsonb_array_elements(ws->'goals') g WHERE g->>'title' = 'Sales revenue');
  log := log || (CASE WHEN g2 IS NOT NULL THEN 'ok ' ELSE 'FAIL ' END || 'manager creates allocated department goal');
  BEGIN PERFORM pms_create_goal(fy, jsonb_build_object('title','Over','scope','Department','department','Sales','ownerId',mgr,'parentId',g1,'allocation','Allocated','annualTarget',-5)); log := log || 'FAIL negative target accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok negative goal target rejected: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_create_goal(fy, jsonb_build_object('title','Emp goal','scope','Individual','department','Sales','ownerId',ea,'parentId',g2)); log := log || 'FAIL employee created a goal'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok employee blocked from creating goals: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  ws := pms_create_goal(fy, jsonb_build_object('title','Asha portfolio','scope','Individual','department','Sales','ownerId',ea,'parentId',g2));
  g3 := (SELECT (g->>'id')::uuid FROM jsonb_array_elements(ws->'goals') g WHERE g->>'title' = 'Asha portfolio');
  BEGIN PERFORM pms_update_goal_target(g1, 1300, 99); log := log || 'FAIL stale row_version accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok stale goal version rejected (concurrency): ' || SQLERRM); END;

  -- ── KPIs ────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  ws := pms_create_kpi(fy, jsonb_build_object('ownerType','Employee','employeeId',ea,'kra','Growth','kraWeight',100,'weight',60,'title','Qualified opportunities',
         'goalId',g3,'kind','Volume','frequency','Monthly','target',40,'unit','opps','submitterId',ea,'approverId',mgr));
  ws := pms_create_kpi(fy, jsonb_build_object('ownerType','Employee','employeeId',ea,'kra','Growth','kraWeight',100,'weight',40,'title','Win rate',
         'goalId',g3,'kind','Rate','frequency','Monthly','target',25,'submitterId',ea,'approverId',mgr));
  k1 := (SELECT (k->>'id')::uuid FROM jsonb_array_elements(ws->'kpis') k WHERE k->>'title' = 'Qualified opportunities');
  k2 := (SELECT (k->>'id')::uuid FROM jsonb_array_elements(ws->'kpis') k WHERE k->>'title' = 'Win rate');
  log := log || (CASE WHEN k1 IS NOT NULL AND k2 IS NOT NULL THEN 'ok ' ELSE 'FAIL ' END || 'manager assigns 2 KPIs to direct report');
  BEGIN PERFORM pms_create_kpi(fy, jsonb_build_object('ownerType','Employee','employeeId',outsider,'kra','X','kraWeight',100,'weight',100,'title','t','goalId',g3,'target',1,'unit','u','submitterId',outsider,'approverId',mgr));
    log := log || 'FAIL manager planned KPI for someone outside their team'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok manager blocked outside team (IDOR): ' || SQLERRM); END;
  BEGIN PERFORM pms_create_kpi(fy, jsonb_build_object('ownerType','Employee','employeeId',eb,'kra','X','kraWeight',100,'weight',100,'title','t','goalId',g3,'target',1,'unit','u','submitterId',eb,'approverId',eb));
    log := log || 'FAIL same submitter/approver accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok submitter = approver rejected: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_create_kpi(fy, jsonb_build_object('ownerType','Employee','employeeId',ea,'kra','Self','kraWeight',100,'weight',100,'title','t','goalId',g3,'target',1,'unit','u','submitterId',ea,'approverId',mgr));
    log := log || 'FAIL employee defined own KPI'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok employee cannot define own KPI: ' || SQLERRM); END;
  BEGIN PERFORM pms_update_kpi_weights(jsonb_build_array(jsonb_build_object('id',k1,'weight',90,'kraWeight',100), jsonb_build_object('id',k2,'weight',10,'kraWeight',100)));
    log := log || 'FAIL employee edited own weights'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok employee cannot edit weights: ' || SQLERRM); END;

  -- Direct table access is denied (RPC-only surface).
  BEGIN PERFORM 1 FROM pms_kpis LIMIT 1; log := log || 'FAIL authenticated can SELECT pms_kpis directly'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok direct SELECT on pms_kpis denied: ' || SQLERRM); END;
  BEGIN UPDATE pms_scorecards SET status = 'Locked'; log := log || 'FAIL authenticated can UPDATE pms_scorecards directly'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok direct UPDATE on pms_scorecards denied: ' || SQLERRM); END;

  -- ── Scorecard approval workflow ─────────────────────────────────────────
  ws := pms_scorecard_action(fy, 'Employee', ea::text, 'submit');
  v := (SELECT c->>'status' FROM jsonb_array_elements(ws->'scorecards') c WHERE c->>'ownerId' = ea::text);
  log := log || (CASE WHEN v = 'Pending approval' THEN 'ok ' ELSE 'FAIL ' END || 'employee submits scorecard → ' || coalesce(v,'null'));
  BEGIN PERFORM pms_scorecard_action(fy, 'Employee', ea::text, 'approve'); log := log || 'FAIL employee approved own scorecard'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok self-approval blocked: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_scorecard_action(fy, 'Employee', ea::text, 'approve'); log := log || 'FAIL non-designated HR approved'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok only designated manager approves: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_create_kpi(fy, jsonb_build_object('ownerType','Employee','employeeId',ea,'kra','Growth','kraWeight',100,'weight',10,'title','late','goalId',g3,'target',1,'unit','u','submitterId',ea,'approverId',mgr));
    log := log || 'FAIL edited a pending scorecard'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok pending scorecard is read-only: ' || SQLERRM); END;
  BEGIN PERFORM pms_scorecard_action(fy, 'Employee', ea::text, 'return', 'no'); log := log || 'FAIL return without reason accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok return needs a reason: ' || SQLERRM); END;
  ws := pms_scorecard_action(fy, 'Employee', ea::text, 'approve');
  v := (SELECT c->>'status' || '/v' || jsonb_array_length(c->'versions') FROM jsonb_array_elements(ws->'scorecards') c WHERE c->>'ownerId' = ea::text);
  log := log || (CASE WHEN v = 'Locked/v1' THEN 'ok ' ELSE 'FAIL ' END || 'manager approves → ' || coalesce(v,'null') || ' (snapshot stored)');
  BEGIN PERFORM pms_scorecard_action(fy, 'Employee', ea::text, 'approve'); log := log || 'FAIL double approval accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok duplicate approval rejected: ' || SQLERRM); END;

  -- ── Monthly measurements (Q2 = months 3,4,5) ────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  FOR n IN 3..5 LOOP
    PERFORM pms_submit_update(k1, n, jsonb_build_object('actual', 40 + n, 'note', 'CRM report'));
    PERFORM pms_submit_update(k2, n, jsonb_build_object('numerator', 12, 'denominator', 40, 'note', 'wins/opps'));
  END LOOP;
  BEGIN PERFORM pms_submit_update(k1, 3, jsonb_build_object('actual', 1, 'note', 'dup')); log := log || 'FAIL duplicate submission accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok duplicate submission rejected: ' || SQLERRM); END;
  BEGIN PERFORM pms_submit_update(k2, 6, jsonb_build_object('numerator', 50, 'denominator', 40, 'note', 'bad')); log := log || 'FAIL numerator > denominator accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok invalid rate rejected: ' || SQLERRM); END;
  BEGIN PERFORM pms_decide_update(k1, 3, 'confirm'); log := log || 'FAIL submitter confirmed own input'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok self-confirmation blocked: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', eb, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_decide_update(k1, 3, 'confirm'); log := log || 'FAIL peer confirmed an input'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok peer cannot confirm: ' || SQLERRM); END;
  ws := pms_workspace(fy);
  log := log || (CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ws->'kpis') k WHERE k->>'employeeId' = ea::text) THEN 'ok ' ELSE 'FAIL ' END || 'peer cannot see colleague''s KPIs');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM pms_decide_update(k1, 4, 'return', 'Attach the CRM export');
  FOR n IN 3..5 LOOP PERFORM pms_decide_update(k2, n, 'confirm'); END LOOP;
  PERFORM pms_decide_update(k1, 3, 'confirm'); PERFORM pms_decide_update(k1, 5, 'confirm');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  ws := pms_submit_update(k1, 4, jsonb_build_object('actual', 44, 'note', 'CRM export attached (ref #44)'));
  log := log || (CASE WHEN (SELECT k->'updates'->'4'->>'status' FROM jsonb_array_elements(ws->'kpis') k WHERE (k->>'id')::uuid = k1) = 'Submitted' THEN 'ok ' ELSE 'FAIL ' END || 'returned input corrected and resubmitted');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM pms_decide_update(k1, 4, 'confirm');

  -- ── Cycle appraisal ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  ws := pms_launch_cycle_reviews(fy, 'Q2', ARRAY[ea, eb, hr2]);
  log := log || (CASE WHEN (ws->'result'->>'created')::int = 2 THEN 'ok ' ELSE 'FAIL ' END || 'launch creates 2 reviews, skips other tenant: ' || (ws->'result'->>'created'));
  ws := pms_launch_cycle_reviews(fy, 'Q2', ARRAY[ea, eb]);
  log := log || (CASE WHEN (ws->'result'->>'created')::int = 0 THEN 'ok ' ELSE 'FAIL ' END || 'relaunch is idempotent');
  rv := (SELECT (r->>'id')::uuid FROM jsonb_array_elements(ws->'reviews') r WHERE r->>'employeeId' = ea::text);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_submit_cycle_assessment(rv, '{"q1":"9","q2":"x"}'); log := log || 'FAIL rating 9 accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok invalid rating rejected: ' || SQLERRM); END;
  BEGIN PERFORM pms_submit_cycle_assessment(rv, '{"q1":"4"}'); log := log || 'FAIL missing required answer accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok required answer enforced: ' || SQLERRM); END;
  ws := pms_submit_cycle_assessment(rv, '{"q1":"4","q2":"Closed two enterprise deals","evil":"<script>"}');
  log := log || (CASE WHEN (SELECT r->'selfAnswers' ? 'evil' FROM jsonb_array_elements(ws->'reviews') r WHERE (r->>'id')::uuid = rv) = false THEN 'ok ' ELSE 'FAIL ' END || 'unknown answer keys stripped');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', eb, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_submit_cycle_assessment(rv, '{"q1":"1","q2":"x"}'); log := log || 'FAIL peer assessed a colleague'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok peer cannot assess: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM pms_submit_cycle_assessment(rv, '{"q1":"5","q2":"Strong quarter"}');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  ws := pms_workspace(fy);
  log := log || (CASE WHEN (SELECT r->'managerAnswers' FROM jsonb_array_elements(ws->'reviews') r WHERE (r->>'id')::uuid = rv) = 'null'::jsonb THEN 'ok ' ELSE 'FAIL ' END || 'manager assessment hidden from employee before release');
  log := log || (CASE WHEN jsonb_array_length(ws->'reviews') = 1 THEN 'ok ' ELSE 'FAIL ' END || 'employee sees only own review');
  BEGIN PERFORM pms_release_cycle_review(rv); log := log || 'FAIL employee released own review'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok employee cannot release: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  PERFORM pms_release_cycle_review(rv);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  ws := pms_workspace(fy);
  v := (SELECT (r->>'status') || '/' || (r->'managerAnswers'->>'q1') || '/' || jsonb_array_length(r->'releasedSnapshot'->'kpis') FROM jsonb_array_elements(ws->'reviews') r WHERE (r->>'id')::uuid = rv);
  log := log || (CASE WHEN v = 'Released/5/2' THEN 'ok ' ELSE 'FAIL ' END || 'released result + snapshot visible to employee: ' || coalesce(v,'null'));
  BEGIN PERFORM pms_submit_cycle_assessment(rv, '{"q1":"1","q2":"edit"}'); log := log || 'FAIL edited a released review'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok released review is read-only: ' || SQLERRM); END;

  -- ── Change request → revision → re-approval ─────────────────────────────
  BEGIN PERFORM pms_scorecard_action(fy, 'Employee', ea::text, 'request', 'short'); log := log || 'FAIL short change reason accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok change request needs 10+ chars: ' || SQLERRM); END;
  PERFORM pms_scorecard_action(fy, 'Employee', ea::text, 'request', 'Territory changed, rebalance weights');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  ws := pms_scorecard_action(fy, 'Employee', ea::text, 'allow-change', 'Agreed in 1:1');
  v := (SELECT c->>'status' || '/r' || (c->>'revision') FROM jsonb_array_elements(ws->'scorecards') c WHERE c->>'ownerId' = ea::text);
  log := log || (CASE WHEN v = 'Draft/r2' THEN 'ok ' ELSE 'FAIL ' END || 'revision allowed → ' || coalesce(v,'null'));
  BEGIN PERFORM pms_update_kpi_weights(jsonb_build_array(jsonb_build_object('id',k1,'weight',70,'kraWeight',100), jsonb_build_object('id',k2,'weight',20,'kraWeight',100)));
    log := log || 'FAIL weights totalling 90 accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok invalid weight total rejected: ' || SQLERRM); END;
  PERFORM pms_update_kpi_weights(jsonb_build_array(jsonb_build_object('id',k1,'weight',70,'kraWeight',100), jsonb_build_object('id',k2,'weight',30,'kraWeight',100)));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  PERFORM pms_scorecard_action(fy, 'Employee', ea::text, 'submit');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  ws := pms_scorecard_action(fy, 'Employee', ea::text, 'approve');
  v := (SELECT c->>'status' || '/v' || jsonb_array_length(c->'versions') || '/h' || jsonb_array_length(c->'history') FROM jsonb_array_elements(ws->'scorecards') c WHERE c->>'ownerId' = ea::text);
  log := log || (CASE WHEN v LIKE 'Locked/v2/h%' THEN 'ok ' ELSE 'FAIL ' END || 'revision 2 approved, audit history kept: ' || coalesce(v,'null'));

  -- ── Settings ────────────────────────────────────────────────────────────
  BEGIN PERFORM pms_save_settings(fy, 60, 120, '2026-10-10', true); log := log || 'FAIL manager changed policy'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok manager cannot change policy: ' || SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_save_settings(fy, 60, 120, '2026-10-10', true); log := log || 'FAIL policy changed after approval'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok policy frozen after approval: ' || SQLERRM); END;
  ws := pms_save_settings(fy, 70, 120, '2026-10-20', false);
  log := log || (CASE WHEN ws->'settings'->>'deadline' = '2026-10-20' THEN 'ok ' ELSE 'FAIL ' END || 'deadline still editable while policy frozen');

  -- ── Independent review campaign (confidential peer) ─────────────────────
  tpl := (SELECT (t->>'id')::uuid FROM jsonb_array_elements(ws->'templates') t WHERE t->>'type' = 'Peer');
  BEGIN PERFORM pms_create_campaign(jsonb_build_object('title','Peer','templateId',tpl,'subject',jsonb_build_object('type','Employee','id',ea),
      'reviewerIds',jsonb_build_array(mgr),'start',td,'end',td+10,'visibility','Confidential'));
    log := log || 'FAIL manager accepted as peer reviewer'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok relationship rule enforced: ' || SQLERRM); END;
  ws := pms_create_campaign(jsonb_build_object('title','Peer check-in','templateId',tpl,'subject',jsonb_build_object('type','Employee','id',ea),
      'reviewerIds',jsonb_build_array(eb),'start',td,'end',td+10,'visibility','Confidential'));
  camp := (ws->'campaigns'->0->>'id')::uuid;
  asg := (ws->'campaigns'->0->'assignments'->0->>'id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', eb, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_campaign_action(camp, 'launch'); log := log || 'FAIL employee launched campaign'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok only HR launches: ' || SQLERRM); END;
  ws := pms_workspace(fy);
  log := log || (CASE WHEN jsonb_array_length(ws->'campaigns') = 0 THEN 'ok ' ELSE 'FAIL ' END || 'draft campaign hidden from reviewer');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  PERFORM pms_campaign_action(camp, 'launch');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', eb, 'role', 'authenticated')::text, true);
  ws := pms_workspace(fy);
  PERFORM pms_campaign_action(camp, 'save', asg, jsonb_build_object(ws->'campaigns'->0->'template'->'questions'->1->>'id', 'Draft thought'));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  ws := pms_workspace(fy);
  log := log || (CASE WHEN (ws->'campaigns'->0->'assignments'->0->'answers') = '{}'::jsonb THEN 'ok ' ELSE 'FAIL ' END || 'HR cannot read reviewer drafts');
  -- submit with all required answers taken from the campaign's frozen template
  PERFORM set_config('request.jwt.claims', json_build_object('sub', eb, 'role', 'authenticated')::text, true);
  ws := pms_workspace(fy);
  PERFORM pms_campaign_action(camp, 'submit', asg, (SELECT jsonb_object_agg(q->>'id', CASE q->>'type' WHEN 'Rating' THEN '4' ELSE 'Helpful handoffs' END)
    FROM jsonb_array_elements(ws->'campaigns'->0->'template'->'questions') q));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  BEGIN PERFORM pms_campaign_action(camp, 'submit', asg, '{}'); log := log || 'FAIL non-reviewer submitted a response'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok only the assigned reviewer responds: ' || SQLERRM); END;
  ws := pms_workspace(fy);
  log := log || (CASE WHEN jsonb_array_length(ws->'campaigns') = 0 THEN 'ok ' ELSE 'FAIL ' END || 'recipient sees nothing before release');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr1, 'role', 'authenticated')::text, true);
  PERFORM pms_campaign_action(camp, 'release');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ea, 'role', 'authenticated')::text, true);
  ws := pms_workspace(fy);
  v := (SELECT coalesce(a->>'reviewerName','<hidden>') || '/' || coalesce(a->>'role','<hidden>') FROM jsonb_array_elements(ws->'campaigns'->0->'assignments') a);
  log := log || (CASE WHEN v = '<hidden>/<hidden>' THEN 'ok ' ELSE 'FAIL ' END || 'confidential result hides reviewer identity: ' || coalesce(v,'null'));

  -- ── Tenant isolation ────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr2, 'role', 'authenticated')::text, true);
  ws := pms_workspace(fy);
  log := log || (CASE WHEN jsonb_array_length(ws->'goals') = 0 AND jsonb_array_length(ws->'kpis') = 0 AND jsonb_array_length(ws->'campaigns') = 0
                  AND NOT (ws->'directory')::text LIKE '%' || ea || '%' THEN 'ok ' ELSE 'FAIL ' END || 'other-tenant HR sees no T1 data');
  BEGIN PERFORM pms_decide_update(k1, 3, 'confirm'); log := log || 'FAIL cross-tenant KPI access'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok cross-tenant KPI blocked: ' || SQLERRM); END;
  BEGIN PERFORM pms_scorecard_action(fy, 'Employee', ea::text, 'request', 'cross tenant attack text'); log := log || 'FAIL cross-tenant scorecard access'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok cross-tenant scorecard blocked: ' || SQLERRM); END;
  BEGIN PERFORM pms_release_cycle_review(rv); log := log || 'FAIL cross-tenant review access'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok cross-tenant review blocked: ' || SQLERRM); END;

  -- ── Unauthenticated / anon ──────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN PERFORM pms_workspace(fy); log := log || 'FAIL no-JWT call succeeded'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok unauthenticated call rejected: ' || SQLERRM); END;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM pms_workspace(fy); log := log || 'FAIL anon can execute pms_workspace'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok anon lacks EXECUTE: ' || SQLERRM); END;
  EXECUTE 'RESET ROLE';

  -- ── Notifications + audit trail were written ────────────────────────────
  SELECT count(*) INTO n FROM app_notifications WHERE tenant_id = t1 AND link_key = 'performance';
  log := log || (CASE WHEN n >= 8 THEN 'ok ' ELSE 'FAIL ' END || 'performance notifications written: ' || n);
  SELECT count(*) INTO n FROM pms_audit_log WHERE tenant_id = t1;
  log := log || (CASE WHEN n >= 30 THEN 'ok ' ELSE 'FAIL ' END || 'audit rows written: ' || n);
  BEGIN UPDATE pms_audit_log SET action = 'tampered' WHERE tenant_id = t1; log := log || 'FAIL audit log was editable'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok audit log append-only: ' || SQLERRM); END;

  RAISE EXCEPTION 'PMS TEST REPORT (rolled back) — % checks, % failed%', cardinality(log),
    (SELECT count(*) FROM unnest(log) l WHERE l LIKE 'FAIL%'), E'\n' || array_to_string(log, E'\n');
END
$test$;
