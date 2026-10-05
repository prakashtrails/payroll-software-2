-- Task register rules (20261005_2) test. SAFE TO RUN ON PROD: one DO block
-- that always ends by raising 'TASK RULES REPORT', which aborts and rolls back
-- every row it touched. Uses only the CrewCore test tenant ed7b4ea0.
-- To dry-run the migration itself, paste the migration above this block and
-- run both in one transaction — the final RAISE rolls the DDL back too.
-- A line starting with "FAIL" is a failed assertion. Run it with the SQL editor's
-- role selector on "postgres" (not impersonating a user).
DO $test$
DECLARE
  ten uuid := 'ed7b4ea0-b8f6-4389-a6e6-2baf400221aa';
  hr  uuid := 'ec70cb49-7c53-4345-986a-ccc787f8d606';   -- admin
  s   uuid := '1016a8af-ba5a-400a-9b9d-c6750a3125a9';   -- employee (Suraj)
  d   uuid := 'd1d1ecd4-c445-4507-aa92-490cb06aea42';   -- employee, temporarily reports to s
  o   uuid := '54dcaabd-3ae0-47b0-a4fd-49d9a1196d23';   -- employee, no manager (outsider)
  t1 uuid; t2 uuid; p uuid; s1 uuid; w uuid; x uuid; r uuid; dt uuid; n int; v text; ok boolean;
  log text[] := '{}';
  td date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  link jsonb := '[{"label":"Report","url":"https://docs.example.com/r1"}]';
BEGIN
  UPDATE profiles SET manager_id = s WHERE id = d;
  UPDATE profiles SET manager_id = NULL WHERE id = s;
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- ── Due date rules ────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  INSERT INTO project_tasks (tenant_id, title, assigned_to, started_at, repeat_of)
  VALUES (ten, '[TEST] rules', s, now(), NULL) RETURNING id INTO t1;
  SELECT started_at IS NULL INTO ok FROM project_tasks WHERE id = t1;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'client cannot pre-set started_at');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  BEGIN UPDATE project_tasks SET status = 'In Progress' WHERE id = t1; log := log || 'FAIL started without due date'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok no due date -> cannot start: ' || SQLERRM); END;
  UPDATE project_tasks SET due_date = td + 3 WHERE id = t1;
  SELECT due_date = td + 3 INTO ok FROM project_tasks WHERE id = t1;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'assignee fills a missing due date');
  UPDATE project_tasks SET status = 'In Progress' WHERE id = t1;
  SELECT started_at IS NOT NULL AND start_date = td INTO ok FROM project_tasks WHERE id = t1;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'start stamps started_at + start_date');
  BEGIN UPDATE project_tasks SET due_date = td + 9 WHERE id = t1; log := log || 'FAIL assignee moved due'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok assignee cannot move a set due date'::text; END;
  BEGIN UPDATE project_tasks SET start_date = td - 20 WHERE id = t1; log := log || 'FAIL assignee moved start date'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok assignee cannot edit start date'::text; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  BEGIN UPDATE project_tasks SET due_date = td + 9 WHERE id = t1; log := log || 'FAIL due changed after start'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok due frozen after start: ' || SQLERRM); END;
  UPDATE project_tasks SET revised_due_date = td + 9, priority = 'High' WHERE id = t1;
  SELECT count(*) INTO n FROM task_activity WHERE task_id = t1 AND kind = 'field' AND body IN ('revised_due_date','priority');
  log := log || (CASE WHEN n = 2 THEN 'ok ' ELSE 'FAIL ' END || 'field change log rows, got ' || n);

  -- ── Blocked / Done / review ───────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  SELECT count(*) INTO n FROM app_notifications WHERE related_id = t1 AND type = 'task_due_changed' AND title = 'Task due date revised';
  log := log || (CASE WHEN n = 1 THEN 'ok ' ELSE 'FAIL ' END || 'assignee told about revised due, got ' || n);
  BEGIN UPDATE project_tasks SET status = 'Blocked' WHERE id = t1; log := log || 'FAIL blocked without reason'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok blocked needs a reason: ' || SQLERRM); END;
  UPDATE project_tasks SET status = 'Blocked', status_note = 'Waiting for data' WHERE id = t1;
  SELECT body INTO v FROM task_activity WHERE task_id = t1 AND kind = 'status' AND to_value = 'Blocked';
  log := log || (CASE WHEN v = 'Waiting for data' THEN 'ok ' ELSE 'FAIL ' END || 'reason stored on the status activity');
  BEGIN UPDATE project_tasks SET status = 'Done' WHERE id = t1; log := log || 'FAIL done without proof'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok review needs proof: ' || SQLERRM); END;
  BEGIN UPDATE project_tasks SET deliverables = '[{"url":"javascript:alert(1)"}]' WHERE id = t1; log := log || 'FAIL bad link accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok non-http link rejected'::text; END;
  UPDATE project_tasks SET deliverables = link WHERE id = t1;
  UPDATE project_tasks SET status = 'Done' WHERE id = t1;
  SELECT review_status = 'Pending' AND status_note IS NULL INTO ok FROM project_tasks WHERE id = t1;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'Done -> Pending review, old Blocked note cleared');
  SELECT format('info after Done: status=%s review=%s created_by_is_hr=%s actor_is_s=%s', status, review_status, created_by = hr, auth.uid() = s)
    INTO v FROM project_tasks WHERE id = t1;
  log := log || v;
  BEGIN UPDATE project_tasks SET review_status = 'Approved' WHERE id = t1; log := log || 'FAIL self-approved by column'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok review columns locked'::text; END;
  BEGIN PERFORM task_review(t1, 'approve'); log := log || 'FAIL assignee approved own task'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok assignee cannot review: ' || SQLERRM); END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', o::text, true);
  BEGIN PERFORM task_review(t1, 'approve'); log := log || 'FAIL outsider approved'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok outsider cannot review'::text; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  BEGIN PERFORM task_review(t1, 'send_back'); log := log || 'FAIL send back without reason'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok send back needs a reason'::text; END;
  BEGIN PERFORM task_review(t1, 'send_back', 'Add the September numbers');
  EXCEPTION WHEN OTHERS THEN
    log := log || ('FAIL send back: ' || SQLERRM);
    RAISE EXCEPTION 'TASK RULES REPORT (stopped early)%', E'
' || array_to_string(log, E'
');
  END;
  SELECT status = 'In Progress' AND review_status = 'Sent back' AND status_note = 'Add the September numbers' INTO ok FROM project_tasks WHERE id = t1;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'send back -> In Progress with reason');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  SELECT count(*) INTO n FROM app_notifications WHERE related_id = t1 AND title = 'Task sent back';
  log := log || (CASE WHEN n = 1 THEN 'ok ' ELSE 'FAIL ' END || 'owner told it was sent back, got ' || n);
  UPDATE project_tasks SET status = 'Done' WHERE id = t1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  PERFORM task_review(t1, 'approve');
  SELECT review_status = 'Approved' AND reviewed_by = hr INTO ok FROM project_tasks WHERE id = t1;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'HR approves');
  SELECT count(*) INTO n FROM task_activity WHERE task_id = t1 AND kind = 'review';
  log := log || (CASE WHEN n = 2 THEN 'ok ' ELSE 'FAIL ' END || 'two review decisions logged, got ' || n);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  BEGIN UPDATE project_tasks SET status = 'In Progress' WHERE id = t1; log := log || 'FAIL owner reopened approved task'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok approved task locked for owner'::text; END;

  -- ── Late Done ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  INSERT INTO project_tasks (tenant_id, title, assigned_to, due_date) VALUES (ten, '[TEST] late', s, td - 2) RETURNING id INTO t2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  UPDATE project_tasks SET status = 'In Progress' WHERE id = t2;
  UPDATE project_tasks SET deliverables = link WHERE id = t2;
  BEGIN UPDATE project_tasks SET status = 'Done' WHERE id = t2; log := log || 'FAIL late done without reason'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok late done needs a reason: ' || SQLERRM); END;
  UPDATE project_tasks SET status = 'Done', status_note = 'Vendor delay' WHERE id = t2;
  SELECT review_status = 'Pending' INTO ok FROM project_tasks WHERE id = t2;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'late done with reason accepted');

  -- ── Manager closes on behalf -> auto-approved ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  INSERT INTO project_tasks (tenant_id, title, assigned_to, due_date) VALUES (ten, '[TEST] hr closes', s, td + 1) RETURNING id INTO x;
  UPDATE project_tasks SET status = 'Done' WHERE id = x;
  SELECT review_status = 'Approved' AND reviewed_by = hr INTO ok FROM project_tasks WHERE id = x;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'assigner marking Done approves it');

  -- ── Sub-tasks + waiting on ────────────────────────────────────────────
  INSERT INTO project_tasks (tenant_id, title, assigned_to, due_date) VALUES (ten, '[TEST] parent', s, td + 5) RETURNING id INTO p;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  INSERT INTO project_tasks (tenant_id, title, parent_task_id, due_date) VALUES (ten, '[TEST] sub', p, td + 4) RETURNING id INTO s1;
  SELECT assigned_to = s INTO ok FROM project_tasks WHERE id = s1;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'owner adds a sub-task to their task');
  BEGIN INSERT INTO project_tasks (tenant_id, title, parent_task_id) VALUES (ten, '[TEST] subsub', s1); log := log || 'FAIL nested sub-task'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok one level of sub-tasks'::text; END;
  UPDATE project_tasks SET status = 'In Progress', deliverables = link WHERE id = p;
  BEGIN UPDATE project_tasks SET status = 'Done' WHERE id = p; log := log || 'FAIL parent done with open sub-task'::text;
  EXCEPTION WHEN OTHERS THEN log := log || ('ok open sub-task blocks Done: ' || SQLERRM); END;
  UPDATE project_tasks SET status = 'Done', status_note = 'Quick check, no document' WHERE id = s1;
  SELECT review_status INTO v FROM project_tasks WHERE id = s1;
  log := log || (CASE WHEN v = 'Approved' THEN 'ok ' ELSE 'FAIL ' END || 'own sub-task with no manager auto-approves, got ' || COALESCE(v, 'null'));
  UPDATE project_tasks SET status = 'Done' WHERE id = p;
  SELECT status = 'Done' INTO ok FROM project_tasks WHERE id = p;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'parent done once sub-task closed');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  INSERT INTO project_tasks (tenant_id, title, assigned_to, due_date) VALUES (ten, '[TEST] first', s, td + 5) RETURNING id INTO x;
  INSERT INTO project_tasks (tenant_id, title, assigned_to, due_date, waiting_on) VALUES (ten, '[TEST] second', s, td + 6, ARRAY[x]) RETURNING id INTO w;
  BEGIN UPDATE project_tasks SET waiting_on = ARRAY[w] WHERE id = x; log := log || 'FAIL two-way wait accepted'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok two-way wait rejected'::text; END;
  BEGIN UPDATE project_tasks SET status = 'Done' WHERE id = w; log := log || 'FAIL done while waiting'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok waiting-on blocks Done'::text; END;

  -- ── Named reviewer ────────────────────────────────────────────────────
  BEGIN INSERT INTO project_tasks (tenant_id, title, assigned_to, reviewer_id) VALUES (ten, '[TEST] x', s, s); log := log || 'FAIL owner as reviewer'::text;
  EXCEPTION WHEN OTHERS THEN log := log || 'ok owner cannot be reviewer'::text; END;
  INSERT INTO project_tasks (tenant_id, title, assigned_to, due_date, reviewer_id) VALUES (ten, '[TEST] reviewed', s, td + 2, o) RETURNING id INTO r;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  UPDATE project_tasks SET status = 'Done', status_note = 'Done on call' WHERE id = r;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', o::text, true);
  SELECT count(*) INTO n FROM project_tasks WHERE id = r;
  log := log || (CASE WHEN n = 1 THEN 'ok ' ELSE 'FAIL ' END || 'named reviewer sees the task');
  SELECT count(*) INTO n FROM app_notifications WHERE related_id = r AND type = 'task_review';
  log := log || (CASE WHEN n = 1 THEN 'ok ' ELSE 'FAIL ' END || 'named reviewer notified, got ' || n);
  PERFORM task_review(r, 'approve');
  SELECT review_status = 'Approved' INTO ok FROM project_tasks WHERE id = r;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'named reviewer approves');
  UPDATE project_tasks SET title = 'reviewer edit' WHERE id = r; GET DIAGNOSTICS n = ROW_COUNT;
  log := log || (CASE WHEN n = 0 THEN 'ok ' ELSE 'FAIL ' END || 'reviewer cannot edit the task');

  -- ── Personal task -> manager reviews ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', d::text, true);
  INSERT INTO project_tasks (tenant_id, title, due_date) VALUES (ten, '[TEST] d personal', td + 2) RETURNING id INTO dt;
  UPDATE project_tasks SET status = 'Done', deliverables = link WHERE id = dt;
  SELECT review_status INTO v FROM project_tasks WHERE id = dt;
  log := log || (CASE WHEN v = 'Pending' THEN 'ok ' ELSE 'FAIL ' END || 'personal task waits for the manager, got ' || COALESCE(v, 'null'));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  SELECT count(*) INTO n FROM app_notifications WHERE related_id = dt AND type = 'task_review';
  log := log || (CASE WHEN n = 1 THEN 'ok ' ELSE 'FAIL ' END || 'manager notified to review, got ' || n);
  PERFORM task_review(dt, 'approve');
  SELECT review_status = 'Approved' INTO ok FROM project_tasks WHERE id = dt;
  log := log || (CASE WHEN ok THEN 'ok ' ELSE 'FAIL ' END || 'manager approves report''s personal task');

  -- ── Repeat ────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  INSERT INTO project_tasks (tenant_id, title, assigned_to, due_date, repeat_rule) VALUES (ten, '[TEST] weekly', s, td, 'weekly') RETURNING id INTO x;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  UPDATE project_tasks SET status = 'Done', deliverables = link WHERE id = x;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  SELECT count(*) INTO n FROM project_tasks WHERE repeat_of = x AND due_date = td + 7 AND status = 'To Do'
    AND created_by = hr AND assigned_to = s AND source = 'system' AND repeat_rule = 'weekly';
  log := log || (CASE WHEN n = 1 THEN 'ok ' ELSE 'FAIL ' END || 'weekly task spawns next copy, got ' || n);
  PERFORM task_review(x, 'send_back', 'redo');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', s::text, true);
  UPDATE project_tasks SET status = 'Done' WHERE id = x;
  SELECT count(*) INTO n FROM project_tasks WHERE repeat_of = x;
  log := log || (CASE WHEN n = 1 THEN 'ok ' ELSE 'FAIL ' END || 'redone task does not spawn twice, got ' || n);

  -- ── KPI picker + reminders on revised due ─────────────────────────────
  PERFORM count(*) FROM task_linkable_kpis();
  log := log || 'ok task_linkable_kpis runs'::text;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', hr::text, true);
  INSERT INTO project_tasks (tenant_id, title, assigned_to, due_date) VALUES (ten, '[TEST] slipped', s, td - 5) RETURNING id INTO x;
  UPDATE project_tasks SET status = 'In Progress' WHERE id = x;
  UPDATE project_tasks SET revised_due_date = td + 1 WHERE id = x;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
  PERFORM task_send_due_reminders();
  SELECT count(*) INTO n FROM app_notifications WHERE profile_id = s AND type = 'task_reminder' AND body LIKE '%slipped (due tomorrow)%';
  log := log || (CASE WHEN n = 1 THEN 'ok ' ELSE 'FAIL ' END || 'reminder uses the revised due date, got ' || n);

  RAISE EXCEPTION 'TASK RULES REPORT%', E'\n' || array_to_string(log, E'\n');
END
$test$;
