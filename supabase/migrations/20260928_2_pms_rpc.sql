-- PMS replacement — server-side API (RPCs) for the Performance workspace.
--
-- Every function is SECURITY DEFINER with a pinned search_path and derives
-- the caller's identity, tenant and role from auth.uid() → profiles. Nothing
-- trusts a client-supplied tenant, role or actor id. Workflow transitions,
-- separation of duties, hierarchy scope and field validation are enforced
-- here, so the web app and the mobile app get identical rules.
--
-- Request-lean by design: pms_workspace() returns everything a screen needs
-- in one call, and every mutation returns the refreshed workspace, so one
-- user action = one request. No polling, realtime or cron.
--
-- Roles: HR = admin/superadmin. Manager-level = manager/hod/management; their
-- scope is their reporting tree (is_in_team_of / my_team_ids, which follow
-- manager_id and hod_id).

-- ═══ Helpers ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pms_fail(p_message text)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = p_message;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_is_hr(p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p_role IN ('admin','superadmin') $$;

CREATE OR REPLACE FUNCTION public.pms_is_mgr(p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p_role IN ('manager','hod','management') $$;

-- Caller context. Fails closed for anonymous callers, inactive profiles and
-- profiles without a company.
CREATE OR REPLACE FUNCTION public.pms_actor(OUT uid uuid, OUT tenant_id uuid, OUT role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN PERFORM pms_fail('Sign in to use Performance.'); END IF;
  SELECT p.tenant_id, p.role, p.status INTO tenant_id, role, v_status FROM profiles p WHERE p.id = uid;
  IF tenant_id IS NULL THEN PERFORM pms_fail('Select a company to open its performance workspace.'); END IF;
  IF v_status IS DISTINCT FROM 'Active' THEN PERFORM pms_fail('Your account is not active.'); END IF;
END;
$$;

-- Company-level feature toggle, mirroring FeatureContext: an explicit
-- company-wide row wins, otherwise premium features default off.
CREATE OR REPLACE FUNCTION public.pms_feature_on(p_tenant uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT c.enabled FROM company_feature_toggles c
      WHERE c.tenant_id = p_tenant AND c.outlet_id IS NULL AND c.feature_key = p_key
      ORDER BY c.updated_at DESC NULLS LAST LIMIT 1),
    NOT COALESCE((SELECT f.is_premium FROM features f WHERE f.key = p_key), false));
$$;

CREATE OR REPLACE FUNCTION public.pms_require_feature(p_tenant uuid, p_key text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pms_feature_on(p_tenant, p_key) THEN
    PERFORM pms_fail(CASE p_key WHEN 'performance_reviews' THEN 'Performance reviews are disabled for this company.'
                                ELSE 'Performance goals are disabled for this company.' END);
  END IF;
END;
$$;

-- Employee in the caller's tenant (active or not — history must resolve).
CREATE OR REPLACE FUNCTION public.pms_same_tenant(p_tenant uuid, p_profile uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile AND tenant_id = p_tenant);
$$;

CREATE OR REPLACE FUNCTION public.pms_active_member(p_tenant uuid, p_profile uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile AND tenant_id = p_tenant AND status = 'Active');
$$;

-- View: HR sees everyone, others see themselves and their reporting tree.
CREATE OR REPLACE FUNCTION public.pms_can_view_emp(p_actor uuid, p_role text, p_emp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pms_is_hr(p_role) OR p_emp = p_actor OR is_in_team_of(p_emp, p_actor);
$$;

-- Manage (define KPIs/goals, enter data on behalf): HR, or a manager-level
-- user over someone in their tree. Managers cannot define their own plan.
CREATE OR REPLACE FUNCTION public.pms_can_manage_emp(p_actor uuid, p_role text, p_emp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pms_is_hr(p_role) OR (pms_is_mgr(p_role) AND p_emp <> p_actor AND is_in_team_of(p_emp, p_actor));
$$;

-- Organisational units: Company → HR only; Department → HR or a
-- manager-level user of that department; Team → HR or a manager-level user
-- of the team goal's department.
CREATE OR REPLACE FUNCTION public.pms_can_manage_unit(p_actor uuid, p_role text, p_tenant uuid, p_fy int, p_type text, p_unit text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pms_is_hr(p_role) OR (pms_is_mgr(p_role) AND CASE p_type
    WHEN 'Department' THEN EXISTS (SELECT 1 FROM profiles WHERE id = p_actor AND lower(btrim(department)) = lower(btrim(p_unit)))
    WHEN 'Team' THEN EXISTS (SELECT 1 FROM pms_goals g JOIN profiles me ON me.id = p_actor
                             WHERE g.tenant_id = p_tenant AND g.fy = p_fy AND g.scope = 'Team' AND g.team = p_unit
                               AND lower(btrim(g.department)) = lower(btrim(me.department)))
    ELSE false END);
$$;

CREATE OR REPLACE FUNCTION public.pms_current_fy()
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN extract(month FROM (now() AT TIME ZONE 'Asia/Kolkata')) >= 4
              THEN extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int
              ELSE extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int - 1 END;
$$;

CREATE OR REPLACE FUNCTION public.pms_today()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

CREATE OR REPLACE FUNCTION public.pms_default_questions()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '[{"id":"q1","text":"How consistently were the agreed outcomes delivered?","type":"Rating","required":true},
           {"id":"q2","text":"What achievement are you most proud of this quarter?","type":"Text","required":true},
           {"id":"q3","text":"What support would help you succeed next quarter?","type":"Text","required":false}]'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.pms_period_months(p_period text)
RETURNS int[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_period WHEN 'Q1' THEN ARRAY[0,1,2] WHEN 'Q2' THEN ARRAY[3,4,5] WHEN 'Q3' THEN ARRAY[6,7,8]
                       WHEN 'Q4' THEN ARRAY[9,10,11] WHEN 'FY' THEN ARRAY[0,1,2,3,4,5,6,7,8,9,10,11] END;
$$;

-- Mirrors model.js dueMonths(): quarterly KPIs are due in the last month of
-- each quarter, annual in March; snapshots/milestones use the last due month.
CREATE OR REPLACE FUNCTION public.pms_due_months(p_frequency text, p_kind text, p_months int[])
RETURNS int[] LANGUAGE sql IMMUTABLE AS $$
  WITH due AS (
    SELECT m FROM unnest(p_months) m
    WHERE p_frequency = 'Monthly' OR (p_frequency = 'Quarterly' AND m % 3 = 2) OR (p_frequency = 'Annual' AND m = 11)
  )
  SELECT CASE WHEN p_kind IN ('Snapshot','Milestone')
              THEN (SELECT COALESCE(array_agg(m), '{}') FROM (SELECT max(m) m FROM due) x WHERE m IS NOT NULL)
              ELSE (SELECT COALESCE(array_agg(m ORDER BY m), '{}') FROM due) END;
$$;

CREATE OR REPLACE FUNCTION public.pms_audit(p_tenant uuid, p_type text, p_entity uuid, p_action text, p_actor uuid,
                                            p_reason text DEFAULT NULL, p_revision int DEFAULT NULL, p_detail jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO pms_audit_log (tenant_id, entity_type, entity_id, action, actor_id, reason, revision, detail)
  VALUES (p_tenant, p_type, p_entity, p_action, p_actor, NULLIF(btrim(p_reason), ''), p_revision, p_detail);
$$;

-- In-app notification (link_key 'performance'). Never notifies the actor.
CREATE OR REPLACE FUNCTION public.pms_notify(p_tenant uuid, p_to uuid, p_actor uuid, p_type text, p_title text, p_body text, p_related uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_to IS NULL OR p_to = p_actor OR NOT pms_active_member(p_tenant, p_to) THEN RETURN; END IF;
  INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
  VALUES (p_tenant, p_to, p_actor, p_type, left(p_title, 200), left(p_body, 500), 'performance', p_related);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_person_name(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF(btrim(concat_ws(' ', first_name, middle_name, last_name)), '') FROM profiles WHERE id = p_id;
$$;

-- ═══ JSON shapes consumed by src/features/performance ═══════════════════

CREATE OR REPLACE FUNCTION public.pms_kpi_json(k public.pms_kpis)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', k.id, 'ownerType', k.owner_type, 'ownerId', k.owner_id, 'employeeId', k.employee_id,
    'goalId', k.goal_id, 'kra', k.kra, 'kraWeight', k.kra_weight, 'title', k.title, 'weight', k.weight,
    'kind', k.kind, 'unit', k.unit, 'target', k.target, 'targets', to_jsonb(k.targets),
    'direction', k.direction, 'frequency', k.frequency, 'aggregation', k.aggregation,
    'dataSource', k.data_source, 'submitterId', k.submitter_id, 'approverId', k.approver_id,
    'milestones', k.milestones, 'sharedSourceId', k.shared_source_id, 'rowVersion', k.row_version,
    'department', CASE WHEN k.owner_type = 'Department' THEN k.owner_id END,
    'updates', COALESCE((SELECT jsonb_object_agg(u.month::text, jsonb_build_object(
        'actual', u.actual, 'numerator', u.numerator, 'denominator', u.denominator,
        'completed', to_jsonb(u.completed), 'applicability', u.applicability, 'note', u.note,
        'status', u.status, 'reason', u.reason, 'submittedBy', u.submitted_by,
        'submittedAt', u.submitted_at, 'decidedBy', u.decided_by, 'decidedAt', u.decided_at))
      FROM pms_kpi_updates u WHERE u.kpi_id = k.id), '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.pms_goal_json(g public.pms_goals)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', g.id, 'title', g.title, 'description', g.description, 'scope', g.scope,
    'department', COALESCE(g.department, ''), 'team', g.team, 'ownerId', g.owner_id, 'parentId', COALESCE(g.parent_id::text, ''),
    'annualTarget', g.annual_target, 'unit', g.unit, 'allocation', g.allocation, 'rowVersion', g.row_version,
    'createdBy', g.created_by);
$$;

CREATE OR REPLACE FUNCTION public.pms_template_json(t public.pms_review_templates)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', t.id, 'family', t.family, 'version', t.version, 'status', t.status, 'type', t.type,
    'title', t.title, 'description', t.description, 'scored', t.scored, 'questions', t.questions);
$$;

-- Snapshot of one owner's plan plus everything its scores depend on.
CREATE OR REPLACE FUNCTION public.pms_plan_snapshot(p_tenant uuid, p_fy int, p_type text, p_owner text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'kpis', COALESCE((SELECT jsonb_agg(pms_kpi_json(k) ORDER BY k.created_at) FROM pms_kpis k
      WHERE k.tenant_id = p_tenant AND k.fy = p_fy AND k.owner_type = p_type AND k.owner_id = p_owner), '[]'::jsonb),
    'allKpis', COALESCE((SELECT jsonb_agg(pms_kpi_json(k)) FROM pms_kpis k WHERE k.tenant_id = p_tenant AND k.fy = p_fy
      AND ((k.owner_type = p_type AND k.owner_id = p_owner) OR k.id IN (SELECT o.shared_source_id FROM pms_kpis o
        WHERE o.tenant_id = p_tenant AND o.fy = p_fy AND o.owner_type = p_type AND o.owner_id = p_owner AND o.shared_source_id IS NOT NULL))), '[]'::jsonb),
    'goals', COALESCE((SELECT jsonb_agg(pms_goal_json(g)) FROM pms_goals g WHERE g.tenant_id = p_tenant AND g.fy = p_fy), '[]'::jsonb));
$$;

-- ═══ Validation mirrors of model.js / workflow.js ════════════════════════

-- workflow.js readiness(): everything that must hold before submit/approve.
CREATE OR REPLACE FUNCTION public.pms_card_issues(p_tenant uuid, p_fy int, p_type text, p_owner text)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_issues text[] := '{}';
  r record; s pms_kpis; g pms_goals; v_id uuid; v_seen uuid[];
  v_alloc numeric; v_bad_unit boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pms_kpis WHERE tenant_id = p_tenant AND fy = p_fy AND owner_type = p_type AND owner_id = p_owner) THEN
    RETURN ARRAY['No KRAs assigned'];
  END IF;
  IF abs((SELECT sum(w) FROM (SELECT min(kra_weight) w FROM pms_kpis WHERE tenant_id = p_tenant AND fy = p_fy
          AND owner_type = p_type AND owner_id = p_owner GROUP BY kra) x) - 100) > 0.001 THEN
    v_issues := v_issues || 'KRA weights must total 100%';
  END IF;
  FOR r IN SELECT kra, min(kra_weight) lo, max(kra_weight) hi, sum(weight) total FROM pms_kpis
           WHERE tenant_id = p_tenant AND fy = p_fy AND owner_type = p_type AND owner_id = p_owner GROUP BY kra LOOP
    IF r.lo <> r.hi THEN v_issues := v_issues || (r.kra || ': inconsistent KRA weight'); END IF;
    IF abs(r.total - 100) > 0.001 THEN v_issues := v_issues || (r.kra || ': KPI weights must total 100%'); END IF;
  END LOOP;
  FOR r IN SELECT * FROM pms_kpis WHERE tenant_id = p_tenant AND fy = p_fy AND owner_type = p_type AND owner_id = p_owner LOOP
    IF r.shared_source_id IS NOT NULL THEN
      SELECT * INTO s FROM pms_kpis WHERE id = r.shared_source_id AND shared_source_id IS NULL AND tenant_id = p_tenant;
      IF NOT FOUND THEN v_issues := v_issues || (r.title || ': shared source is missing'); CONTINUE; END IF;
    ELSE
      SELECT * INTO s FROM pms_kpis WHERE id = r.id;
    END IF;
    IF s.submitter_id IS NULL OR s.approver_id IS NULL OR s.submitter_id = s.approver_id THEN
      v_issues := v_issues || (r.title || ': separate submitter and approver required');
    END IF;
    IF s.kind NOT IN ('Zero incidents','Milestone','Rubric') AND (s.target IS NULL OR s.target <= 0) THEN
      v_issues := v_issues || (r.title || ': a positive target is required');
    END IF;
    IF s.targets IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(s.targets) t WHERE t IS NULL OR t <= 0) THEN
      v_issues := v_issues || (r.title || ': all 12 phased targets must be positive');
    END IF;
    IF s.kind = 'Milestone' AND abs(COALESCE((SELECT sum((m->>'weight')::numeric) FROM jsonb_array_elements(s.milestones) m), 0) - 100) > 0.001 THEN
      v_issues := v_issues || (r.title || ': milestone weights must total 100%');
    END IF;
    v_id := r.goal_id; v_seen := '{}';
    WHILE v_id IS NOT NULL AND NOT v_id = ANY(v_seen) LOOP
      v_seen := v_seen || v_id;
      SELECT * INTO g FROM pms_goals WHERE id = v_id;
      EXIT WHEN NOT FOUND;
      SELECT COALESCE(sum(c.annual_target), 0), bool_or(c.unit IS DISTINCT FROM g.unit) INTO v_alloc, v_bad_unit
        FROM pms_goals c WHERE c.parent_id = g.id AND c.allocation = 'Allocated';
      IF COALESCE(v_bad_unit, false) OR v_alloc > COALESCE(g.annual_target, 0) + 0.001 THEN
        v_issues := v_issues || (g.title || ': correct target allocation before approval');
      END IF;
      v_id := g.parent_id;
    END LOOP;
  END LOOP;
  RETURN ARRAY(SELECT DISTINCT unnest(v_issues));
END;
$$;

-- model.js weightIssues() for a proposed weight set on one owner.
CREATE OR REPLACE FUNCTION public.pms_weight_issues(p_tenant uuid, p_fy int, p_type text, p_owner text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(
    SELECT 'KRA weights must total 100%' WHERE abs(COALESCE((SELECT sum(w) FROM (SELECT min(kra_weight) w FROM pms_kpis
           WHERE tenant_id = p_tenant AND fy = p_fy AND owner_type = p_type AND owner_id = p_owner GROUP BY kra) x), 0) - 100) > 0.001
    UNION ALL
    SELECT kra || ': inconsistent KRA weight' FROM pms_kpis WHERE tenant_id = p_tenant AND fy = p_fy AND owner_type = p_type AND owner_id = p_owner
      GROUP BY kra HAVING min(kra_weight) <> max(kra_weight)
    UNION ALL
    SELECT kra || ': KPI weights must total 100%' FROM pms_kpis WHERE tenant_id = p_tenant AND fy = p_fy AND owner_type = p_type AND owner_id = p_owner
      GROUP BY kra HAVING abs(sum(weight) - 100) > 0.001);
$$;

-- Designated approver for an employee scorecard: their manager, else HOD, if
-- that person can approve (manager-level or HR, active). NULL ⇒ any HR
-- administrator other than the owner/submitter decides.
CREATE OR REPLACE FUNCTION public.pms_employee_approver(p_emp uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id FROM profiles e
  CROSS JOIN LATERAL (VALUES (e.manager_id, 1), (e.hod_id, 2)) c(id, ord)
  JOIN profiles a ON a.id = c.id
  WHERE e.id = p_emp AND a.id <> p_emp AND a.tenant_id = e.tenant_id AND a.status = 'Active'
    AND (pms_is_mgr(a.role) OR pms_is_hr(a.role))
  ORDER BY c.ord LIMIT 1;
$$;

-- Locks (creating if needed) the scorecard row that serialises all plan
-- edits and workflow decisions for one owner.
CREATE OR REPLACE FUNCTION public.pms_lock_card(p_tenant uuid, p_fy int, p_type text, p_owner text)
RETURNS public.pms_scorecards LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c pms_scorecards;
BEGIN
  INSERT INTO pms_scorecards (tenant_id, fy, owner_type, owner_id) VALUES (p_tenant, p_fy, p_type, p_owner)
  ON CONFLICT (tenant_id, fy, owner_type, owner_id) DO NOTHING;
  SELECT * INTO c FROM pms_scorecards WHERE tenant_id = p_tenant AND fy = p_fy AND owner_type = p_type AND owner_id = p_owner FOR UPDATE;
  RETURN c;
END;
$$;

-- A KPI's definition is editable only while its own scorecard is Draft and
-- no submitted/locked scorecard references it as a shared source.
CREATE OR REPLACE FUNCTION public.pms_kpi_editable(p_kpi uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM pms_kpis k JOIN pms_scorecards c ON c.tenant_id = k.tenant_id AND c.fy = k.fy
      AND c.owner_type = k.owner_type AND c.owner_id = k.owner_id
    WHERE (k.id = p_kpi OR k.shared_source_id = p_kpi) AND c.status <> 'Draft');
$$;

-- workflow.js goalProtected(): a goal on the ancestry path of any KPI whose
-- scorecard is submitted/locked.
CREATE OR REPLACE FUNCTION public.pms_goal_protected(p_goal uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE up(id, parent_id, depth) AS (
    SELECT g.id, g.parent_id, 0 FROM pms_goals g
    WHERE g.id IN (SELECT k.goal_id FROM pms_kpis k JOIN pms_scorecards c ON c.tenant_id = k.tenant_id AND c.fy = k.fy
                   AND c.owner_type = k.owner_type AND c.owner_id = k.owner_id WHERE c.status <> 'Draft')
    UNION
    SELECT p.id, p.parent_id, up.depth + 1 FROM pms_goals p JOIN up ON p.id = up.parent_id WHERE up.depth < 20
  )
  SELECT p_goal IS NOT NULL AND EXISTS (SELECT 1 FROM up WHERE id = p_goal);
$$;

-- Validates answers to a cycle questionnaire; returns the cleaned object
-- (only known question ids, trimmed, length-limited).
CREATE OR REPLACE FUNCTION public.pms_clean_cycle_answers(p_questions jsonb, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE q jsonb; v text; v_out jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'object' THEN PERFORM pms_fail('Answers are missing.'); END IF;
  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    v := btrim(p_answers->>(q->>'id'));
    IF v IS NULL OR v = '' THEN
      IF (q->>'required')::boolean THEN PERFORM pms_fail('Answer the required question: ' || (q->>'text')); END IF;
      CONTINUE;
    END IF;
    IF length(v) > 4000 THEN PERFORM pms_fail('Answers are limited to 4000 characters.'); END IF;
    IF q->>'type' = 'Rating' AND v NOT IN ('1','2','3','4','5') THEN PERFORM pms_fail('Ratings must be between 1 and 5.'); END IF;
    IF q->>'type' = 'Yes / No' AND v NOT IN ('Yes','No') THEN PERFORM pms_fail('Choose Yes or No.'); END IF;
    IF q->>'type' = 'Number' AND v !~ '^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$' THEN PERFORM pms_fail('Enter a valid number.'); END IF;
    v_out := v_out || jsonb_build_object(q->>'id', v);
  END LOOP;
  RETURN v_out;
END;
$$;

-- reviewModel.js validateTemplate().
CREATE OR REPLACE FUNCTION public.pms_validate_template(p_title text, p_type text, p_scored boolean, p_questions jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE q jsonb; v_opts text[]; v_total numeric := 0; v_rated int := 0;
BEGIN
  IF btrim(COALESCE(p_title, '')) = '' THEN PERFORM pms_fail('Give the template a name.'); END IF;
  IF p_type NOT IN ('Self','Manager','Peer','Upward','Interdepartmental','360','Project','Custom') THEN PERFORM pms_fail('Choose a review type.'); END IF;
  IF jsonb_typeof(p_questions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_questions) = 0 THEN PERFORM pms_fail('Add at least one question.'); END IF;
  IF jsonb_array_length(p_questions) > 50 THEN PERFORM pms_fail('A template can have at most 50 questions.'); END IF;
  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    IF btrim(COALESCE(q->>'text', '')) = '' OR q->>'type' NOT IN ('Rating','Text','Number','Choice') OR btrim(COALESCE(q->>'id','')) = '' THEN
      PERFORM pms_fail('Every question needs text and a supported answer type.');
    END IF;
    IF q->>'type' = 'Choice' THEN
      v_opts := ARRAY(SELECT btrim(o) FROM regexp_split_to_table(COALESCE(q->>'options', ''), E'\n') o WHERE btrim(o) <> '');
      IF cardinality(v_opts) < 2 OR cardinality(v_opts) <> (SELECT count(DISTINCT o) FROM unnest(v_opts) o) THEN
        PERFORM pms_fail('Choice questions need at least two different options, one per line.');
      END IF;
    END IF;
    IF q->>'type' = 'Rating' THEN
      v_rated := v_rated + 1;
      IF p_scored AND (COALESCE((q->>'weight')::numeric, 0) <= 0) THEN PERFORM pms_fail('Rating question weights must be positive and total 100%.'); END IF;
      v_total := v_total + COALESCE((q->>'weight')::numeric, 0);
    END IF;
  END LOOP;
  IF p_scored AND (v_rated = 0 OR abs(v_total - 100) > 0.001) THEN PERFORM pms_fail('Rating question weights must be positive and total 100%.'); END IF;
END;
$$;

-- reviewModel.js validateAnswers() + reviewScore(). Returns {answers, score}.
CREATE OR REPLACE FUNCTION public.pms_campaign_answers(p_template jsonb, p_answers jsonb, p_strict boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE q jsonb; v text; v_out jsonb := '{}'::jsonb; v_sum numeric := 0; v_w numeric := 0; v_opts text[];
BEGIN
  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'object' THEN PERFORM pms_fail('Answers are missing.'); END IF;
  FOR q IN SELECT * FROM jsonb_array_elements(p_template->'questions') LOOP
    v := btrim(p_answers->>(q->>'id'));
    IF v IS NOT NULL AND length(v) > 4000 THEN PERFORM pms_fail('Answers are limited to 4000 characters.'); END IF;
    IF v IS NOT NULL AND v <> '' THEN v_out := v_out || jsonb_build_object(q->>'id', v); END IF;
    IF NOT p_strict THEN CONTINUE; END IF;
    IF (q->>'required')::boolean AND (v IS NULL OR v = '' OR v = 'N/A') THEN PERFORM pms_fail('Answer the required question: ' || (q->>'text')); END IF;
    IF v IS NULL OR v = '' OR (v = 'N/A' AND q->>'type' = 'Rating' AND NOT (q->>'required')::boolean) THEN CONTINUE; END IF;
    IF q->>'type' = 'Rating' AND v NOT IN ('1','2','3','4','5') THEN PERFORM pms_fail('Ratings must be between 1 and 5.'); END IF;
    IF q->>'type' = 'Number' AND v !~ '^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$' THEN PERFORM pms_fail('Enter a valid number.'); END IF;
    IF q->>'type' = 'Choice' THEN
      v_opts := ARRAY(SELECT btrim(o) FROM regexp_split_to_table(COALESCE(q->>'options', ''), E'\n') o);
      IF NOT v = ANY(v_opts) THEN PERFORM pms_fail('Choose one of the listed options.'); END IF;
    END IF;
    IF q->>'type' = 'Rating' THEN
      v_sum := v_sum + (ARRAY[60,85,100,110,120])[v::int] * (q->>'weight')::numeric;
      v_w := v_w + (q->>'weight')::numeric;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('answers', v_out,
    'score', CASE WHEN p_strict AND (p_template->>'scored')::boolean AND v_w > 0 THEN round(v_sum / v_w, 4) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_reviewer_role(p_template_type text, p_subject jsonb, p_reviewer uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_subject->>'type' <> 'Employee' THEN CASE WHEN p_template_type = 'Interdepartmental' THEN 'Interdepartmental' ELSE 'Contributor' END
    WHEN p_reviewer::text = p_subject->>'id' THEN 'Self'
    WHEN EXISTS (SELECT 1 FROM profiles WHERE id = (p_subject->>'id')::uuid AND manager_id = p_reviewer) THEN 'Manager'
    WHEN EXISTS (SELECT 1 FROM profiles WHERE id = p_reviewer AND manager_id::text = p_subject->>'id') THEN 'Upward'
    WHEN p_template_type = 'Interdepartmental' THEN 'Interdepartmental'
    ELSE 'Peer' END;
$$;

-- Starter library (reviewModel.js initialReviewHub), created once per tenant.
CREATE OR REPLACE FUNCTION public.pms_seed_templates(p_tenant uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pms_review_templates WHERE tenant_id = p_tenant) THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY['Self','Manager','Peer','Upward','Interdepartmental','360','Project','Custom'] LOOP
    INSERT INTO pms_review_templates (tenant_id, family, version, status, type, title, description, scored, questions, created_by)
    VALUES (p_tenant, gen_random_uuid(), 1, 'Published', t, t || ' review',
      CASE t WHEN 'Interdepartmental' THEN 'Review collaboration and handoffs between departments.'
             WHEN 'Upward' THEN 'Give feedback on leadership and support.'
             WHEN 'Peer' THEN 'Reflect on collaboration with a colleague.'
             WHEN '360' THEN 'Collect self, manager, peer and upward perspectives separately.'
             ELSE 'A reusable conversation about outcomes, strengths and development.' END,
      false,
      jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'type', 'Rating', 'required', true, 'weight', 100, 'options', '',
          'text', CASE WHEN t = 'Interdepartmental' THEN 'How effective were communication and handoffs?' ELSE 'How consistently were expectations met?' END),
        jsonb_build_object('id', gen_random_uuid(), 'type', 'Text', 'required', true, 'weight', 0, 'options', '', 'text', 'What worked well? Give a specific example.'),
        jsonb_build_object('id', gen_random_uuid(), 'type', 'Text', 'required', false, 'weight', 0, 'options', '', 'text', 'What should improve, and what support would help?')),
      p_actor);
  END LOOP;
END;
$$;

-- ═══ Read: the whole workspace in one request ═══════════════════════════

CREATE OR REPLACE FUNCTION public.pms_workspace(p_fy int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; v_hr boolean; v_mgr boolean; v_set pms_settings; v_fy int; v_scope uuid[];
  v_kras boolean; v_reviews boolean; v_locked boolean;
BEGIN
  SELECT * INTO a FROM pms_actor();
  v_hr := pms_is_hr(a.role); v_mgr := pms_is_mgr(a.role);
  v_kras := pms_feature_on(a.tenant_id, 'performance_kras');
  v_reviews := pms_feature_on(a.tenant_id, 'performance_reviews');
  IF NOT v_kras AND NOT v_reviews THEN PERFORM pms_fail('Performance goals and reviews are disabled for this company.'); END IF;

  SELECT * INTO v_set FROM pms_settings WHERE tenant_id = a.tenant_id;
  v_fy := COALESCE(p_fy, v_set.fy, pms_current_fy());
  IF v_fy NOT BETWEEN 2000 AND 2100 THEN PERFORM pms_fail('Choose a valid financial year.'); END IF;
  IF v_hr AND v_reviews THEN PERFORM pms_seed_templates(a.tenant_id, a.uid); END IF;

  v_scope := CASE WHEN v_hr THEN ARRAY(SELECT id FROM profiles WHERE tenant_id = a.tenant_id)
                  ELSE ARRAY[a.uid] || my_team_ids() END;
  v_locked := EXISTS (SELECT 1 FROM pms_scorecards c WHERE c.tenant_id = a.tenant_id AND c.fy = v_fy
                AND (c.status <> 'Draft' OR EXISTS (SELECT 1 FROM pms_scorecard_versions v WHERE v.scorecard_id = c.id)));

  RETURN jsonb_build_object(
    'fy', v_fy,
    'caller', jsonb_build_object('id', a.uid, 'role', a.role, 'isHr', v_hr, 'canManage', v_hr OR v_mgr),
    'features', jsonb_build_object('kras', v_kras, 'reviews', v_reviews),
    'settings', jsonb_build_object('year', v_fy, 'savedYear', v_set.fy, 'kpiWeight', COALESCE(v_set.kpi_weight, 70), 'cap', COALESCE(v_set.cap, 120),
      'deadline', COALESCE(v_set.deadline, make_date(v_fy, 10, 10)), 'reminders', COALESCE(v_set.reminders, true),
      'rowVersion', COALESCE(v_set.row_version, 0), 'locked', v_locked),
    'questions', COALESCE(NULLIF(v_set.cycle_questions, '[]'::jsonb), pms_default_questions()),
    'scope', to_jsonb(v_scope),
    'directory', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'code', COALESCE(p.employee_id, 'Not assigned'),
        'name', COALESCE(pms_person_name(p.id), 'Unnamed'), 'department', COALESCE(NULLIF(btrim(p.department), ''), 'Unassigned'),
        'designation', COALESCE(NULLIF(p.designation, ''), 'Employee'), 'managerId', p.manager_id, 'hodId', p.hod_id,
        'outletId', p.outlet_id, 'outlet', COALESCE(p.outlet_location, 'Unassigned'), 'role', p.role) ORDER BY p.first_name, p.last_name)
      FROM profiles p WHERE p.tenant_id = a.tenant_id AND p.status = 'Active' AND p.role <> 'superadmin'), '[]'::jsonb),
    'goals', CASE WHEN NOT v_kras THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(pms_goal_json(g) ORDER BY g.created_at) FROM pms_goals g
      WHERE g.tenant_id = a.tenant_id AND g.fy = v_fy AND (v_hr OR g.scope <> 'Individual' OR g.owner_id = ANY(v_scope))), '[]'::jsonb) END,
    'kpis', CASE WHEN NOT v_kras THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(pms_kpi_json(k) ORDER BY k.created_at) FROM pms_kpis k
      WHERE k.tenant_id = a.tenant_id AND k.fy = v_fy AND (v_hr OR k.owner_type <> 'Employee' OR k.employee_id = ANY(v_scope)
        OR k.submitter_id = a.uid OR k.approver_id = a.uid)), '[]'::jsonb) END,
    'scorecards', CASE WHEN NOT v_kras THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'type', c.owner_type, 'ownerId', c.owner_id, 'status', c.status, 'revision', c.revision,
        'approverId', c.approver_id, 'submittedBy', c.submitted_by, 'changeRequest', c.change_request,
        'versions', COALESCE((SELECT jsonb_agg(v.snapshot || jsonb_build_object('revision', v.revision, 'at', v.approved_at, 'approvedBy', v.approved_by) ORDER BY v.revision)
                     FROM pms_scorecard_versions v WHERE v.scorecard_id = c.id), '[]'::jsonb),
        'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', l.action, 'actorId', l.actor_id, 'reason', COALESCE(l.reason, ''),
                     'revision', l.revision, 'at', l.at) ORDER BY l.at, l.id) FROM pms_audit_log l
                     WHERE l.entity_type = 'scorecard' AND l.entity_id = c.id), '[]'::jsonb)))
      FROM pms_scorecards c WHERE c.tenant_id = a.tenant_id AND c.fy = v_fy
        AND (v_hr OR c.owner_type <> 'Employee' OR c.owner_id = ANY(v_scope::text[]) OR c.approver_id = a.uid)), '[]'::jsonb) END,
    'reviews', CASE WHEN NOT v_reviews THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'employeeId', r.employee_id, 'period', r.period, 'status', r.status, 'questions', r.questions,
        'selfAnswers', r.self_answers,
        -- The employee sees the manager's assessment only once HR releases it.
        'managerAnswers', CASE WHEN r.employee_id = a.uid AND NOT v_hr AND r.status <> 'Released' THEN NULL ELSE r.manager_answers END,
        'releasedPolicy', r.released_policy, 'releasedSnapshot', r.released_snapshot, 'releasedAt', r.released_at))
      FROM pms_cycle_reviews r WHERE r.tenant_id = a.tenant_id AND r.fy = v_fy AND r.employee_id = ANY(v_scope)), '[]'::jsonb) END,
    'templates', CASE WHEN v_hr AND v_reviews THEN COALESCE((SELECT jsonb_agg(pms_template_json(t) ORDER BY t.type, t.title, t.version)
      FROM pms_review_templates t WHERE t.tenant_id = a.tenant_id), '[]'::jsonb) ELSE '[]'::jsonb END,
    'campaigns', CASE WHEN NOT v_reviews THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'template', c.template, 'subject', c.subject, 'recipientId', c.recipient_id,
        'start', c.start_date, 'end', c.end_date, 'visibility', c.visibility, 'status', c.status,
        'cancelReason', c.cancel_reason, 'releasedAt', c.released_at, 'createdBy', c.created_by,
        'assignments', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'submittedAt' NULLS LAST, x->>'id') FROM (
            SELECT CASE
              -- Own assignment: full detail, including drafts.
              WHEN s.reviewer_id = a.uid THEN jsonb_build_object('id', s.id, 'reviewerId', s.reviewer_id, 'reviewerName', pms_person_name(s.reviewer_id),
                'role', s.role, 'status', s.status, 'answers', s.answers, 'score', s.score, 'submittedAt', s.submitted_at, 'reason', s.reason, 'own', true)
              -- HR oversight: identities always; answers only once submitted.
              WHEN v_hr THEN jsonb_build_object('id', s.id, 'reviewerId', s.reviewer_id, 'reviewerName', pms_person_name(s.reviewer_id),
                'role', s.role, 'status', s.status, 'answers', CASE WHEN s.status = 'Submitted' THEN s.answers ELSE '{}'::jsonb END,
                'score', CASE WHEN s.status = 'Submitted' THEN s.score END, 'submittedAt', s.submitted_at, 'reason', s.reason,
                'previousSubmissions', s.previous_submissions)
              -- Recipient after release: submitted answers; identity hidden when Confidential.
              WHEN c.recipient_id = a.uid AND c.status = 'Released' AND s.status = 'Submitted' THEN jsonb_build_object('id', s.id,
                'reviewerId', CASE WHEN c.visibility = 'Named' THEN s.reviewer_id END,
                'reviewerName', CASE WHEN c.visibility = 'Named' THEN pms_person_name(s.reviewer_id) END,
                'role', CASE WHEN c.visibility = 'Named' THEN s.role END, 'status', s.status, 'answers', s.answers,
                'score', s.score, 'submittedAt', CASE WHEN c.visibility = 'Named' THEN s.submitted_at END)
            END x
            FROM pms_review_assignments s WHERE s.campaign_id = c.id) y WHERE x IS NOT NULL), '[]'::jsonb),
        'history', CASE WHEN v_hr THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('at', l.at, 'actorId', l.actor_id, 'action', l.action,
                     'reason', l.reason, 'assignmentId', l.detail->>'assignmentId') ORDER BY l.at, l.id)
                   FROM pms_audit_log l WHERE l.entity_type = 'campaign' AND l.entity_id = c.id), '[]'::jsonb) ELSE '[]'::jsonb END)
        ORDER BY c.created_at DESC)
      FROM pms_review_campaigns c WHERE c.tenant_id = a.tenant_id AND (v_hr
        OR (c.status NOT IN ('Draft','Cancelled') AND EXISTS (SELECT 1 FROM pms_review_assignments s WHERE s.campaign_id = c.id AND s.reviewer_id = a.uid))
        OR (c.recipient_id = a.uid AND c.status = 'Released'))), '[]'::jsonb) END
  );
END;
$$;

-- ═══ Settings ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pms_save_settings(p_fy int, p_kpi_weight numeric, p_cap numeric, p_deadline date,
                                                    p_reminders boolean, p_expected_version int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; s pms_settings; v_locked boolean;
BEGIN
  SELECT * INTO a FROM pms_actor();
  IF NOT pms_is_hr(a.role) THEN PERFORM pms_fail('HR access is required to change the scoring policy.'); END IF;
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  IF p_fy NOT BETWEEN 2000 AND 2100 OR p_kpi_weight NOT BETWEEN 0 AND 100 OR p_cap NOT BETWEEN 100 AND 200 THEN
    PERFORM pms_fail('KPI weight must be 0–100% and the cap 100–200%.');
  END IF;
  SELECT * INTO s FROM pms_settings WHERE tenant_id = a.tenant_id FOR UPDATE;
  IF FOUND AND p_expected_version IS NOT NULL AND s.row_version <> p_expected_version THEN
    PERFORM pms_fail('Settings were changed by someone else. Reload and try again.');
  END IF;
  v_locked := EXISTS (SELECT 1 FROM pms_scorecards c WHERE c.tenant_id = a.tenant_id AND c.fy = p_fy
    AND (c.status <> 'Draft' OR EXISTS (SELECT 1 FROM pms_scorecard_versions v WHERE v.scorecard_id = c.id)));
  IF v_locked AND (COALESCE(s.kpi_weight, 70) <> p_kpi_weight OR COALESCE(s.cap, 120) <> p_cap) THEN
    PERFORM pms_fail('Scoring policy is frozen once a scorecard is submitted or approved.');
  END IF;
  INSERT INTO pms_settings AS t (tenant_id, fy, kpi_weight, cap, deadline, reminders, updated_by)
  VALUES (a.tenant_id, p_fy, p_kpi_weight, p_cap, p_deadline, COALESCE(p_reminders, true), a.uid)
  ON CONFLICT (tenant_id) DO UPDATE SET fy = EXCLUDED.fy, kpi_weight = EXCLUDED.kpi_weight, cap = EXCLUDED.cap,
    deadline = EXCLUDED.deadline, reminders = EXCLUDED.reminders, updated_by = a.uid, updated_at = now(),
    row_version = t.row_version + 1;
  PERFORM pms_audit(a.tenant_id, 'settings', a.tenant_id, 'save-policy', a.uid, NULL, NULL,
    jsonb_build_object('fy', p_fy, 'kpiWeight', p_kpi_weight, 'cap', p_cap, 'deadline', p_deadline));
  RETURN pms_workspace(p_fy);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_save_questions(p_fy int, p_questions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; q jsonb; v_clean jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO a FROM pms_actor();
  IF NOT pms_is_hr(a.role) THEN PERFORM pms_fail('HR access is required to edit the questionnaire.'); END IF;
  PERFORM pms_require_feature(a.tenant_id, 'performance_reviews');
  IF jsonb_typeof(p_questions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_questions) > 50 THEN
    PERFORM pms_fail('The questionnaire can have at most 50 questions.');
  END IF;
  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    IF btrim(COALESCE(q->>'text', '')) = '' OR length(q->>'text') > 500 OR q->>'type' NOT IN ('Rating','Text','Number','Yes / No')
       OR btrim(COALESCE(q->>'id', '')) = '' THEN
      PERFORM pms_fail('Every question needs text (up to 500 characters) and a supported answer type.');
    END IF;
    v_clean := v_clean || jsonb_build_object('id', q->>'id', 'text', btrim(q->>'text'), 'type', q->>'type',
                                             'required', COALESCE((q->>'required')::boolean, false));
  END LOOP;
  INSERT INTO pms_settings AS t (tenant_id, fy, cycle_questions, updated_by)
  VALUES (a.tenant_id, COALESCE(p_fy, pms_current_fy()), v_clean, a.uid)
  ON CONFLICT (tenant_id) DO UPDATE SET cycle_questions = EXCLUDED.cycle_questions, updated_by = a.uid,
    updated_at = now(), row_version = t.row_version + 1;
  PERFORM pms_audit(a.tenant_id, 'settings', a.tenant_id, 'save-questions', a.uid);
  RETURN pms_workspace(p_fy);
END;
$$;

-- ═══ Goals ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pms_create_goal(p_fy int, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; v_parent pms_goals; v_scope text := COALESCE(p->>'scope', ''); v_alloc text := COALESCE(NULLIF(p->>'allocation', ''), 'Aligned');
  v_target numeric := NULLIF(p->>'annualTarget', '')::numeric; v_unit text := NULLIF(btrim(p->>'unit'), '');
  v_owner uuid := NULLIF(p->>'ownerId', '')::uuid; v_dept text := NULLIF(btrim(p->>'department'), ''); v_id uuid;
  v_levels jsonb := '{"Company":0,"Department":1,"Team":2,"Individual":3}';
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  IF NOT (pms_is_hr(a.role) OR pms_is_mgr(a.role)) THEN PERFORM pms_fail('Only managers and HR can create goals.'); END IF;
  IF v_scope NOT IN ('Company','Department','Team','Individual') THEN PERFORM pms_fail('Choose a goal scope.'); END IF;
  IF v_scope = 'Company' AND NOT pms_is_hr(a.role) THEN PERFORM pms_fail('Only HR can create company objectives.'); END IF;
  IF v_owner IS NULL OR NOT pms_active_member(a.tenant_id, v_owner) THEN PERFORM pms_fail('Choose an accountable owner from this company.'); END IF;
  IF v_scope = 'Individual' AND NOT (pms_can_manage_emp(a.uid, a.role, v_owner) OR v_owner = a.uid) THEN
    PERFORM pms_fail('You can only set individual goals for people in your team.');
  END IF;
  IF v_scope <> 'Company' THEN
    SELECT * INTO v_parent FROM pms_goals WHERE id = NULLIF(p->>'parentId', '')::uuid AND tenant_id = a.tenant_id AND fy = p_fy;
    IF NOT FOUND THEN PERFORM pms_fail('Choose a parent objective.'); END IF;
    IF (v_levels->>v_parent.scope)::int >= (v_levels->>v_scope)::int THEN PERFORM pms_fail('The parent must be a broader goal.'); END IF;
    IF pms_goal_protected(v_parent.id) THEN
      PERFORM pms_fail('This goal supports a submitted or locked scorecard. Open a revision before changing its allocation.');
    END IF;
    IF v_dept IS NULL THEN PERFORM pms_fail('Choose a department.'); END IF;
    IF v_parent.department IS NOT NULL AND v_parent.department <> '' AND v_parent.department <> v_dept THEN
      PERFORM pms_fail('The child department must match its parent department.');
    END IF;
    IF NOT pms_is_hr(a.role) AND v_scope IN ('Department','Team')
       AND NOT pms_can_manage_unit(a.uid, a.role, a.tenant_id, p_fy, 'Department', v_dept) THEN
      PERFORM pms_fail('You can only create goals for your own department.');
    END IF;
  ELSE
    v_dept := NULL;
  END IF;
  IF v_alloc = 'Allocated' THEN
    IF v_parent.id IS NULL OR COALESCE(v_parent.annual_target, 0) <= 0 THEN PERFORM pms_fail('Only goals with a numeric parent target can be allocated.'); END IF;
    IF v_target IS NULL OR v_target <= 0 THEN PERFORM pms_fail('Enter the allocated annual target.'); END IF;
    v_unit := v_parent.unit;
  ELSIF v_alloc <> 'Aligned' THEN PERFORM pms_fail('Choose how this goal contributes to its parent.');
  END IF;
  IF v_target IS NOT NULL AND v_target <= 0 THEN PERFORM pms_fail('Annual targets must be positive.'); END IF;
  IF v_scope = 'Team' AND btrim(COALESCE(p->>'team', '')) = '' THEN PERFORM pms_fail('Enter the team name.'); END IF;

  INSERT INTO pms_goals (tenant_id, fy, title, description, scope, department, team, owner_id, parent_id, annual_target, unit, allocation, created_by)
  VALUES (a.tenant_id, p_fy, btrim(p->>'title'), COALESCE(btrim(p->>'description'), ''), v_scope, v_dept,
          CASE WHEN v_scope = 'Team' THEN btrim(p->>'team') END, v_owner, v_parent.id, v_target, v_unit, v_alloc, a.uid)
  RETURNING id INTO v_id;
  PERFORM pms_audit(a.tenant_id, 'goal', v_id, 'create', a.uid, NULL, NULL, jsonb_build_object('title', p->>'title', 'scope', v_scope));
  RETURN pms_workspace(p_fy);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_update_goal_target(p_goal uuid, p_target numeric, p_expected_version int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; g pms_goals;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  SELECT * INTO g FROM pms_goals WHERE id = p_goal AND tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pms_fail('Goal not found.'); END IF;
  IF NOT (pms_is_hr(a.role) OR (pms_is_mgr(a.role) AND (g.created_by = a.uid OR g.owner_id = a.uid))) THEN
    PERFORM pms_fail('Only HR or the goal''s owner can change its target.');
  END IF;
  IF g.row_version <> p_expected_version THEN PERFORM pms_fail('This goal was changed by someone else. Reload and try again.'); END IF;
  IF p_target IS NULL OR p_target <= 0 THEN PERFORM pms_fail('Annual targets must be positive.'); END IF;
  IF pms_goal_protected(g.id) OR pms_goal_protected(g.parent_id) THEN
    PERFORM pms_fail('This goal supports a submitted or locked scorecard. Open a revision before changing its allocation.');
  END IF;
  UPDATE pms_goals SET annual_target = p_target, row_version = row_version + 1, updated_at = now() WHERE id = g.id;
  PERFORM pms_audit(a.tenant_id, 'goal', g.id, 'update-target', a.uid, NULL, NULL, jsonb_build_object('from', g.annual_target, 'to', p_target));
  RETURN pms_workspace(g.fy);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_delete_goal(p_goal uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; g pms_goals;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  SELECT * INTO g FROM pms_goals WHERE id = p_goal AND tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pms_fail('Goal not found.'); END IF;
  IF NOT (pms_is_hr(a.role) OR (pms_is_mgr(a.role) AND g.created_by = a.uid)) THEN PERFORM pms_fail('Only HR or the goal''s creator can delete it.'); END IF;
  IF EXISTS (SELECT 1 FROM pms_goals WHERE parent_id = g.id) OR EXISTS (SELECT 1 FROM pms_kpis WHERE goal_id = g.id) THEN
    PERFORM pms_fail('Remove its child goals and linked KPIs first.');
  END IF;
  DELETE FROM pms_goals WHERE id = g.id;
  PERFORM pms_audit(a.tenant_id, 'goal', g.id, 'delete', a.uid, NULL, NULL, jsonb_build_object('title', g.title));
  RETURN pms_workspace(g.fy);
END;
$$;

-- ═══ KPIs / scorecard definitions ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pms_require_owner_manage(p_uid uuid, p_role text, p_tenant uuid, p_fy int, p_type text, p_owner text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_type = 'Employee' THEN
    IF NOT pms_same_tenant(p_tenant, p_owner::uuid) OR NOT pms_can_manage_emp(p_uid, p_role, p_owner::uuid) THEN
      PERFORM pms_fail('You can only plan KPIs for people in your team.');
    END IF;
  ELSIF NOT pms_can_manage_unit(p_uid, p_role, p_tenant, p_fy, p_type, p_owner) THEN
    PERFORM pms_fail('You cannot plan this organisational scorecard.');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_create_kpi(p_fy int, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; c pms_scorecards; v_type text := COALESCE(p->>'ownerType', 'Employee'); v_owner text; v_emp uuid;
  v_src pms_kpis; v_kind text := COALESCE(p->>'kind', 'Volume'); v_target numeric; v_unit text; v_kraw numeric;
  v_existing numeric; v_sub uuid; v_app uuid; v_ms jsonb := '[]'::jsonb; v_id uuid;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  IF v_type NOT IN ('Employee','Company','Department','Team') THEN PERFORM pms_fail('Choose a scorecard owner type.'); END IF;
  v_owner := CASE WHEN v_type = 'Employee' THEN NULLIF(p->>'employeeId', '') ELSE NULLIF(btrim(p->>'ownerId'), '') END;
  IF v_owner IS NULL THEN PERFORM pms_fail('Choose who owns this KPI.'); END IF;
  IF v_type = 'Company' THEN v_owner := 'Company'; END IF;
  IF v_type = 'Employee' THEN v_emp := v_owner::uuid; END IF;
  PERFORM pms_require_owner_manage(a.uid, a.role, a.tenant_id, p_fy, v_type, v_owner);
  c := pms_lock_card(a.tenant_id, p_fy, v_type, v_owner);
  IF c.status <> 'Draft' THEN PERFORM pms_fail('This scorecard is read-only. An approved change request is required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pms_goals WHERE id = NULLIF(p->>'goalId', '')::uuid AND tenant_id = a.tenant_id AND fy = p_fy) THEN
    PERFORM pms_fail('Choose an aligned goal.');
  END IF;
  IF btrim(COALESCE(p->>'kra', '')) = '' OR btrim(COALESCE(p->>'title', '')) = '' THEN PERFORM pms_fail('Enter the KRA and KPI title.'); END IF;

  v_kraw := NULLIF(p->>'kraWeight', '')::numeric;
  SELECT min(kra_weight) INTO v_existing FROM pms_kpis WHERE tenant_id = a.tenant_id AND fy = p_fy
    AND owner_type = v_type AND owner_id = v_owner AND kra = btrim(p->>'kra');
  v_kraw := COALESCE(v_existing, v_kraw);   -- an existing KRA keeps its weight

  IF NULLIF(p->>'sharedSourceId', '') IS NOT NULL THEN
    IF v_type <> 'Employee' THEN PERFORM pms_fail('Only employee scorecards can reference a shared result.'); END IF;
    SELECT * INTO v_src FROM pms_kpis WHERE id = (p->>'sharedSourceId')::uuid AND tenant_id = a.tenant_id AND fy = p_fy
      AND shared_source_id IS NULL AND owner_type <> 'Employee';
    IF NOT FOUND THEN PERFORM pms_fail('Choose an authoritative company, department or team KPI.'); END IF;
    v_kind := v_src.kind; v_unit := v_src.unit; v_target := v_src.target;
  ELSE
    IF v_kind NOT IN ('Volume','Rate','Weighted average','Snapshot','Milestone','Rubric','Zero incidents') THEN PERFORM pms_fail('Choose a measurement type.'); END IF;
    v_sub := NULLIF(p->>'submitterId', '')::uuid; v_app := NULLIF(p->>'approverId', '')::uuid;
    IF v_sub IS NULL OR v_app IS NULL OR NOT pms_active_member(a.tenant_id, v_sub) OR NOT pms_active_member(a.tenant_id, v_app) THEN
      PERFORM pms_fail('Choose a data submitter and an approver from this company.');
    END IF;
    IF v_sub = v_app THEN PERFORM pms_fail('Choose an approver different from the data submitter.'); END IF;
    v_target := CASE v_kind WHEN 'Milestone' THEN 100 WHEN 'Rubric' THEN 3 WHEN 'Zero incidents' THEN 0 ELSE NULLIF(p->>'target', '')::numeric END;
    v_unit := CASE v_kind WHEN 'Milestone' THEN '%' WHEN 'Rubric' THEN 'rating' WHEN 'Zero incidents' THEN 'incidents' WHEN 'Rate' THEN '%'
                          ELSE btrim(COALESCE(p->>'unit', '')) END;
    IF v_kind IN ('Volume','Rate','Weighted average','Snapshot') AND (v_target IS NULL OR v_target <= 0) THEN PERFORM pms_fail('Enter a positive target.'); END IF;
    IF v_kind = 'Rate' AND v_target > 100 THEN PERFORM pms_fail('A rate target cannot exceed 100%.'); END IF;
    IF v_kind IN ('Volume','Weighted average','Snapshot') AND v_unit = '' THEN PERFORM pms_fail('Enter the unit of measure.'); END IF;
    IF v_kind = 'Milestone' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', COALESCE(NULLIF(m->>'id', ''), gen_random_uuid()::text),
               'title', btrim(m->>'title'), 'weight', (m->>'weight')::numeric)), '[]'::jsonb)
        INTO v_ms FROM jsonb_array_elements(COALESCE(p->'milestones', '[]'::jsonb)) m;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ms) m WHERE btrim(COALESCE(m->>'title', '')) = '' OR (m->>'weight')::numeric <= 0)
         OR abs(COALESCE((SELECT sum((m->>'weight')::numeric) FROM jsonb_array_elements(v_ms) m), 0) - 100) > 0.001 THEN
        PERFORM pms_fail('Every milestone needs a title, and milestone weights must total 100%.');
      END IF;
    END IF;
  END IF;

  INSERT INTO pms_kpis (tenant_id, fy, owner_type, owner_id, employee_id, goal_id, kra, kra_weight, title, weight, kind, unit, target,
                        direction, frequency, data_source, submitter_id, approver_id, milestones, shared_source_id, created_by)
  VALUES (a.tenant_id, p_fy, v_type, v_owner, v_emp, (p->>'goalId')::uuid, btrim(p->>'kra'), v_kraw, btrim(p->>'title'),
          NULLIF(p->>'weight', '')::numeric, v_kind, COALESCE(v_unit, ''), v_target,
          CASE WHEN p->>'direction' = 'Lower' THEN 'Lower' ELSE 'Higher' END,
          CASE WHEN p->>'frequency' IN ('Quarterly','Annual') THEN p->>'frequency' ELSE 'Monthly' END,
          CASE WHEN p->>'dataSource' = 'Imported report reference' THEN p->>'dataSource' ELSE 'Manual' END,
          v_sub, v_app, v_ms, v_src.id, a.uid)
  RETURNING id INTO v_id;
  PERFORM pms_audit(a.tenant_id, 'kpi', v_id, 'create', a.uid, NULL, NULL, jsonb_build_object('title', p->>'title', 'owner', v_owner));
  RETURN pms_workspace(p_fy);
END;
$$;

-- p_items: [{id, weight, kraWeight}] for one owner's scorecard.
CREATE OR REPLACE FUNCTION public.pms_update_kpi_weights(p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; k pms_kpis; c pms_scorecards; i jsonb; v_issues text[];
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN PERFORM pms_fail('No weights to save.'); END IF;
  SELECT * INTO k FROM pms_kpis WHERE id = (p_items->0->>'id')::uuid AND tenant_id = a.tenant_id;
  IF NOT FOUND THEN PERFORM pms_fail('KPI not found.'); END IF;
  PERFORM pms_require_owner_manage(a.uid, a.role, a.tenant_id, k.fy, k.owner_type, k.owner_id);
  c := pms_lock_card(a.tenant_id, k.fy, k.owner_type, k.owner_id);
  FOR i IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (SELECT 1 FROM pms_kpis WHERE id = (i->>'id')::uuid AND tenant_id = a.tenant_id AND fy = k.fy
                   AND owner_type = k.owner_type AND owner_id = k.owner_id) THEN
      PERFORM pms_fail('All weights must belong to the same scorecard.');
    END IF;
    IF NOT pms_kpi_editable((i->>'id')::uuid) THEN PERFORM pms_fail('These weights are protected by a submitted or locked scorecard.'); END IF;
    UPDATE pms_kpis SET weight = (i->>'weight')::numeric, kra_weight = (i->>'kraWeight')::numeric,
      row_version = row_version + 1, updated_at = now() WHERE id = (i->>'id')::uuid;
  END LOOP;
  v_issues := pms_weight_issues(a.tenant_id, k.fy, k.owner_type, k.owner_id);
  IF cardinality(v_issues) > 0 THEN PERFORM pms_fail(array_to_string(v_issues, '; ')); END IF;
  PERFORM pms_audit(a.tenant_id, 'scorecard', c.id, 'edit-weights', a.uid, NULL, c.revision, p_items);
  RETURN pms_workspace(k.fy);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_update_kpi_targets(p_kpi uuid, p_targets numeric[], p_expected_version int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; k pms_kpis; c pms_scorecards;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  SELECT * INTO k FROM pms_kpis WHERE id = p_kpi AND tenant_id = a.tenant_id;
  IF NOT FOUND THEN PERFORM pms_fail('KPI not found.'); END IF;
  PERFORM pms_require_owner_manage(a.uid, a.role, a.tenant_id, k.fy, k.owner_type, k.owner_id);
  c := pms_lock_card(a.tenant_id, k.fy, k.owner_type, k.owner_id);
  SELECT * INTO k FROM pms_kpis WHERE id = p_kpi FOR UPDATE;
  IF k.row_version <> p_expected_version THEN PERFORM pms_fail('This KPI was changed by someone else. Reload and try again.'); END IF;
  IF k.shared_source_id IS NOT NULL OR k.kind <> 'Volume' OR k.frequency <> 'Monthly' THEN PERFORM pms_fail('Only monthly volume KPIs can be phased.'); END IF;
  IF NOT pms_kpi_editable(k.id) THEN PERFORM pms_fail('Targets are protected by a submitted or locked scorecard. Request a revision first.'); END IF;
  IF cardinality(p_targets) <> 12 OR EXISTS (SELECT 1 FROM unnest(p_targets) t WHERE t IS NULL OR t <= 0) THEN
    PERFORM pms_fail('Monthly targets must be positive for all 12 months.');
  END IF;
  UPDATE pms_kpis SET targets = p_targets, row_version = row_version + 1, updated_at = now() WHERE id = k.id;
  PERFORM pms_audit(a.tenant_id, 'kpi', k.id, 'phase-targets', a.uid, NULL, c.revision, jsonb_build_object('from', k.targets, 'to', p_targets));
  RETURN pms_workspace(k.fy);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_delete_kpi(p_kpi uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; k pms_kpis; c pms_scorecards;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  SELECT * INTO k FROM pms_kpis WHERE id = p_kpi AND tenant_id = a.tenant_id;
  IF NOT FOUND THEN PERFORM pms_fail('KPI not found.'); END IF;
  PERFORM pms_require_owner_manage(a.uid, a.role, a.tenant_id, k.fy, k.owner_type, k.owner_id);
  c := pms_lock_card(a.tenant_id, k.fy, k.owner_type, k.owner_id);
  IF c.status <> 'Draft' OR NOT pms_kpi_editable(k.id) THEN PERFORM pms_fail('This scorecard is read-only. An approved change request is required.'); END IF;
  IF EXISTS (SELECT 1 FROM pms_kpis WHERE shared_source_id = k.id) THEN PERFORM pms_fail('Employee scorecards reference this KPI. Remove those references first.'); END IF;
  IF EXISTS (SELECT 1 FROM pms_kpi_updates WHERE kpi_id = k.id AND status = 'Confirmed') THEN
    PERFORM pms_fail('This KPI already has confirmed results and cannot be removed.');
  END IF;
  DELETE FROM pms_kpis WHERE id = k.id;
  PERFORM pms_audit(a.tenant_id, 'scorecard', c.id, 'remove-kpi', a.uid, NULL, c.revision, jsonb_build_object('title', k.title));
  RETURN pms_workspace(k.fy);
END;
$$;

-- ═══ Monthly measurement inputs ═════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pms_submit_update(p_kpi uuid, p_month int, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; k pms_kpis; u pms_kpi_updates; v_na boolean := COALESCE(p->>'applicability', '') = 'N/A';
  v_actual numeric; v_num numeric; v_den numeric; v_done text[] := '{}'; v_note text := btrim(COALESCE(p->>'note', ''));
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  SELECT * INTO k FROM pms_kpis WHERE id = p_kpi AND tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pms_fail('KPI not found.'); END IF;
  IF k.shared_source_id IS NOT NULL THEN PERFORM pms_fail('Shared results are entered once on the organisational scorecard.'); END IF;
  IF p_month NOT BETWEEN 0 AND 11 OR NOT p_month = ANY(pms_due_months(k.frequency, 'Volume', ARRAY[p_month])) THEN
    PERFORM pms_fail('This KPI is not due for that month.');
  END IF;
  IF NOT (k.submitter_id = a.uid
          OR (k.owner_type = 'Employee' AND pms_can_manage_emp(a.uid, a.role, k.employee_id))
          OR (k.owner_type <> 'Employee' AND pms_can_manage_unit(a.uid, a.role, a.tenant_id, k.fy, k.owner_type, k.owner_id))) THEN
    PERFORM pms_fail('Only the designated data submitter or their manager can enter this result.');
  END IF;
  SELECT * INTO u FROM pms_kpi_updates WHERE kpi_id = k.id AND month = p_month FOR UPDATE;
  IF FOUND AND u.status IN ('Submitted','Confirmed') THEN PERFORM pms_fail('This result is already ' || lower(u.status) || '.'); END IF;
  IF v_note = '' THEN PERFORM pms_fail(CASE WHEN v_na THEN 'Give the reason this period is not applicable.' ELSE 'Add a progress note or evidence reference.' END); END IF;
  IF NOT v_na THEN
    IF k.kind IN ('Rate','Weighted average') THEN
      v_num := NULLIF(p->>'numerator', '')::numeric; v_den := NULLIF(p->>'denominator', '')::numeric;
      IF v_den IS NULL OR v_den <= 0 OR v_num IS NULL OR v_num < 0 THEN PERFORM pms_fail('A positive denominator and valid numerator are required.'); END IF;
      IF k.kind = 'Rate' AND v_num > v_den THEN PERFORM pms_fail('Successful outcomes cannot exceed eligible outcomes.'); END IF;
      v_actual := v_num / v_den * CASE WHEN k.kind = 'Rate' THEN 100 ELSE 1 END;
    ELSIF k.kind = 'Milestone' THEN
      v_done := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(COALESCE(p->'completed', '[]'::jsonb)) x
                      WHERE x IN (SELECT m->>'id' FROM jsonb_array_elements(k.milestones) m));
      v_actual := COALESCE((SELECT sum((m->>'weight')::numeric) FROM jsonb_array_elements(k.milestones) m WHERE m->>'id' = ANY(v_done)), 0);
    ELSE
      v_actual := NULLIF(p->>'actual', '')::numeric;
      IF v_actual IS NULL OR v_actual < 0 THEN PERFORM pms_fail('Enter the actual result.'); END IF;
      IF k.kind = 'Rubric' AND v_actual NOT IN (1,2,3,4,5) THEN PERFORM pms_fail('Choose a rubric rating from 1 to 5.'); END IF;
      IF k.kind = 'Zero incidents' AND v_actual <> trunc(v_actual) THEN PERFORM pms_fail('Incidents must be a whole number.'); END IF;
    END IF;
  END IF;
  INSERT INTO pms_kpi_updates (tenant_id, kpi_id, month, applicability, actual, numerator, denominator, completed, note, status, submitted_by)
  VALUES (a.tenant_id, k.id, p_month, CASE WHEN v_na THEN 'N/A' ELSE 'Measured' END, v_actual, v_num, v_den, v_done, left(v_note, 2000), 'Submitted', a.uid)
  ON CONFLICT (kpi_id, month) DO UPDATE SET applicability = EXCLUDED.applicability, actual = EXCLUDED.actual,
    numerator = EXCLUDED.numerator, denominator = EXCLUDED.denominator, completed = EXCLUDED.completed, note = EXCLUDED.note,
    status = 'Submitted', reason = NULL, submitted_by = a.uid, submitted_at = now(), decided_by = NULL, decided_at = NULL;
  PERFORM pms_audit(a.tenant_id, 'kpi', k.id, 'submit-update', a.uid, NULL, NULL, jsonb_build_object('month', p_month, 'actual', v_actual));
  PERFORM pms_notify(a.tenant_id, COALESCE(k.approver_id, pms_employee_approver(k.employee_id)), a.uid, 'pms_update_submitted',
    'KPI result awaiting confirmation', k.title || ' — ' || COALESCE(pms_person_name(a.uid), 'A colleague') || ' submitted a result.', k.id);
  RETURN pms_workspace(k.fy);
END;
$$;

-- p_action: 'confirm' | 'return'.
CREATE OR REPLACE FUNCTION public.pms_decide_update(p_kpi uuid, p_month int, p_action text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; k pms_kpis; u pms_kpi_updates; v_designated boolean;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  SELECT * INTO k FROM pms_kpis WHERE id = p_kpi AND tenant_id = a.tenant_id;
  IF NOT FOUND THEN PERFORM pms_fail('KPI not found.'); END IF;
  SELECT * INTO u FROM pms_kpi_updates WHERE kpi_id = k.id AND month = p_month FOR UPDATE;
  IF NOT FOUND OR u.status <> 'Submitted' THEN PERFORM pms_fail('Only a submitted result can be confirmed or returned.'); END IF;
  IF u.submitted_by = a.uid THEN PERFORM pms_fail('Your own submission needs another approver.'); END IF;
  -- The designated approver decides; HR steps in only when that approver has left.
  v_designated := k.approver_id IS NOT NULL AND pms_active_member(a.tenant_id, k.approver_id);
  IF NOT ((v_designated AND k.approver_id = a.uid)
          OR (NOT v_designated AND (pms_is_hr(a.role) OR (k.owner_type = 'Employee' AND pms_can_manage_emp(a.uid, a.role, k.employee_id))))) THEN
    PERFORM pms_fail('Only the designated approver can confirm this result.');
  END IF;
  IF p_action = 'confirm' THEN
    UPDATE pms_kpi_updates SET status = 'Confirmed', decided_by = a.uid, decided_at = now(), reason = NULL WHERE id = u.id;
  ELSIF p_action = 'return' THEN
    IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN PERFORM pms_fail('Give a reason for returning this result (at least 5 characters).'); END IF;
    UPDATE pms_kpi_updates SET status = 'Returned', decided_by = a.uid, decided_at = now(), reason = left(btrim(p_reason), 2000) WHERE id = u.id;
    PERFORM pms_notify(a.tenant_id, u.submitted_by, a.uid, 'pms_update_returned', 'KPI result returned',
      k.title || ': ' || left(btrim(p_reason), 200), k.id);
  ELSE PERFORM pms_fail('Unknown action.');
  END IF;
  PERFORM pms_audit(a.tenant_id, 'kpi', k.id, p_action || '-update', a.uid, p_reason, NULL, jsonb_build_object('month', p_month));
  RETURN pms_workspace(k.fy);
END;
$$;

-- ═══ Scorecard approval workflow (workflow.js transitionCard) ═══════════

CREATE OR REPLACE FUNCTION public.pms_scorecard_action(p_fy int, p_type text, p_owner text, p_action text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; c pms_scorecards; v_is_owner boolean; v_can_manage boolean; v_approver uuid; v_issues text[];
  v_reason text := btrim(COALESCE(p_reason, '')); v_decider boolean; v_owner_name text; v_emp uuid;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  IF p_type NOT IN ('Employee','Company','Department','Team') THEN PERFORM pms_fail('Unknown scorecard.'); END IF;
  IF p_type = 'Employee' THEN
    v_emp := p_owner::uuid;
    IF NOT pms_same_tenant(a.tenant_id, v_emp) THEN PERFORM pms_fail('Scorecard not found.'); END IF;
    v_is_owner := v_emp = a.uid;
    v_can_manage := pms_can_manage_emp(a.uid, a.role, v_emp);
    v_owner_name := pms_person_name(v_emp);
  ELSE
    v_is_owner := EXISTS (SELECT 1 FROM pms_kpis WHERE tenant_id = a.tenant_id AND fy = p_fy AND owner_type = p_type AND owner_id = p_owner AND submitter_id = a.uid);
    v_can_manage := pms_can_manage_unit(a.uid, a.role, a.tenant_id, p_fy, p_type, p_owner);
    v_owner_name := p_owner;
  END IF;
  c := pms_lock_card(a.tenant_id, p_fy, p_type, p_owner);
  -- Designated independent decider: stored approver, or HR when none is configured.
  v_decider := (c.approver_id IS NOT NULL AND c.approver_id = a.uid AND pms_active_member(a.tenant_id, c.approver_id))
            OR ((c.approver_id IS NULL OR NOT pms_active_member(a.tenant_id, c.approver_id)) AND pms_is_hr(a.role));
  v_decider := v_decider AND a.uid IS DISTINCT FROM c.submitted_by AND NOT (p_type = 'Employee' AND v_is_owner);

  IF p_action = 'submit' THEN
    IF c.status <> 'Draft' OR NOT (v_is_owner OR v_can_manage) THEN PERFORM pms_fail('Only the owner or a manager can submit a draft.'); END IF;
    v_approver := CASE WHEN p_type = 'Employee' THEN pms_employee_approver(v_emp)
                       ELSE (SELECT approver_id FROM pms_kpis WHERE tenant_id = a.tenant_id AND fy = p_fy AND owner_type = p_type
                             AND owner_id = p_owner AND approver_id IS NOT NULL ORDER BY created_at LIMIT 1) END;
    IF v_approver = a.uid OR (v_approver IS NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE tenant_id = a.tenant_id
         AND status = 'Active' AND role IN ('admin','superadmin') AND id <> a.uid AND id::text <> p_owner)) THEN
      PERFORM pms_fail('A different designated manager must approve this scorecard.');
    END IF;
    v_issues := pms_card_issues(a.tenant_id, p_fy, p_type, p_owner);
    IF cardinality(v_issues) > 0 THEN PERFORM pms_fail(array_to_string(v_issues, '; ')); END IF;
    UPDATE pms_scorecards SET status = 'Pending approval', submitted_by = a.uid, approver_id = v_approver, updated_at = now() WHERE id = c.id;
    PERFORM pms_notify(a.tenant_id, v_approver, a.uid, 'pms_scorecard_submitted', 'Scorecard awaiting approval',
      COALESCE(v_owner_name, 'A scorecard') || ' was submitted for approval.', c.id);
  ELSIF p_action IN ('approve','return') THEN
    IF c.status <> 'Pending approval' OR NOT v_decider THEN PERFORM pms_fail('Only the designated independent manager can decide.'); END IF;
    IF p_action = 'return' THEN
      IF length(v_reason) < 5 THEN PERFORM pms_fail('Provide a reason for returning the scorecard.'); END IF;
      UPDATE pms_scorecards SET status = 'Draft', updated_at = now() WHERE id = c.id;
    ELSE
      v_issues := pms_card_issues(a.tenant_id, p_fy, p_type, p_owner);
      IF cardinality(v_issues) > 0 THEN PERFORM pms_fail(array_to_string(v_issues, '; ')); END IF;
      INSERT INTO pms_scorecard_versions (tenant_id, scorecard_id, revision, snapshot, approved_by)
      VALUES (a.tenant_id, c.id, c.revision,
              pms_plan_snapshot(a.tenant_id, p_fy, p_type, p_owner) || jsonb_build_object('policy', (SELECT jsonb_build_object(
                'year', p_fy, 'kpiWeight', COALESCE(s.kpi_weight, 70), 'cap', COALESCE(s.cap, 120), 'deadline', s.deadline)
                FROM (SELECT 1) x LEFT JOIN pms_settings s ON s.tenant_id = a.tenant_id)), a.uid)
      ON CONFLICT (scorecard_id, revision) DO UPDATE SET snapshot = EXCLUDED.snapshot, approved_by = EXCLUDED.approved_by, approved_at = now();
      UPDATE pms_scorecards SET status = 'Locked', updated_at = now() WHERE id = c.id;
    END IF;
    PERFORM pms_notify(a.tenant_id, c.submitted_by, a.uid, 'pms_scorecard_' || p_action || 'd',
      CASE p_action WHEN 'approve' THEN 'Scorecard approved and locked' ELSE 'Scorecard returned' END,
      COALESCE(v_owner_name, 'Scorecard') || CASE WHEN p_action = 'return' THEN ': ' || left(v_reason, 200) ELSE ' is approved.' END, c.id);
  ELSIF p_action = 'request' THEN
    IF c.status <> 'Locked' OR c.change_request->>'status' = 'Pending' OR NOT (v_is_owner OR v_can_manage) THEN
      PERFORM pms_fail('A locked scorecard can have one pending change request.');
    END IF;
    IF a.uid = c.approver_id THEN PERFORM pms_fail('The owner must request changes so approval remains independent.'); END IF;
    IF length(v_reason) < 10 THEN PERFORM pms_fail('Describe the requested changes and why they are needed (at least 10 characters).'); END IF;
    UPDATE pms_scorecards SET change_request = jsonb_build_object('reason', v_reason, 'requestedBy', a.uid, 'status', 'Pending', 'at', now()),
      updated_at = now() WHERE id = c.id;
    PERFORM pms_notify(a.tenant_id, c.approver_id, a.uid, 'pms_change_requested', 'Scorecard change requested',
      COALESCE(v_owner_name, 'Scorecard') || ': ' || left(v_reason, 200), c.id);
  ELSIF p_action IN ('allow-change','reject-change') THEN
    IF c.status <> 'Locked' OR c.change_request->>'status' IS DISTINCT FROM 'Pending' OR NOT v_decider
       OR a.uid::text = c.change_request->>'requestedBy' THEN
      PERFORM pms_fail('Only the independent designated approver can decide this request.');
    END IF;
    IF length(v_reason) < 5 THEN PERFORM pms_fail('Provide an approval or rejection note.'); END IF;
    UPDATE pms_scorecards SET
      status = CASE WHEN p_action = 'allow-change' THEN 'Draft' ELSE 'Locked' END,
      revision = revision + CASE WHEN p_action = 'allow-change' THEN 1 ELSE 0 END,
      change_request = change_request || jsonb_build_object('status', CASE WHEN p_action = 'allow-change' THEN 'Approved' ELSE 'Rejected' END,
                                                            'decidedBy', a.uid, 'decision', v_reason),
      updated_at = now() WHERE id = c.id;
    PERFORM pms_notify(a.tenant_id, (c.change_request->>'requestedBy')::uuid, a.uid, 'pms_change_decided',
      CASE WHEN p_action = 'allow-change' THEN 'Scorecard revision allowed' ELSE 'Scorecard change rejected' END, left(v_reason, 200), c.id);
  ELSE PERFORM pms_fail('Unknown scorecard action.');
  END IF;
  SELECT * INTO c FROM pms_scorecards WHERE id = c.id;
  PERFORM pms_audit(a.tenant_id, 'scorecard', c.id, p_action, a.uid, v_reason, c.revision);
  RETURN pms_workspace(p_fy);
END;
$$;

-- ═══ Cycle appraisals ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pms_launch_cycle_reviews(p_fy int, p_period text, p_employee_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; v_q jsonb; v_id uuid; v_emp uuid; v_count int := 0;
BEGIN
  SELECT * INTO a FROM pms_actor();
  IF NOT pms_is_hr(a.role) THEN PERFORM pms_fail('HR access is required to launch reviews.'); END IF;
  PERFORM pms_require_feature(a.tenant_id, 'performance_reviews');
  IF pms_period_months(p_period) IS NULL THEN PERFORM pms_fail('Choose a quarter or the full year.'); END IF;
  SELECT COALESCE(NULLIF(cycle_questions, '[]'::jsonb), pms_default_questions()) INTO v_q FROM (SELECT 1) x
    LEFT JOIN pms_settings s ON s.tenant_id = a.tenant_id;
  IF cardinality(p_employee_ids) > 2000 THEN PERFORM pms_fail('Launch at most 2000 reviews at once.'); END IF;
  FOREACH v_emp IN ARRAY COALESCE(p_employee_ids, '{}') LOOP
    CONTINUE WHEN NOT pms_active_member(a.tenant_id, v_emp);
    INSERT INTO pms_cycle_reviews (tenant_id, fy, period, employee_id, questions, launched_by)
    VALUES (a.tenant_id, p_fy, p_period, v_emp, v_q, a.uid)
    ON CONFLICT (tenant_id, fy, period, employee_id) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      v_count := v_count + 1;
      PERFORM pms_audit(a.tenant_id, 'cycle_review', v_id, 'launch', a.uid, NULL, NULL, jsonb_build_object('period', p_period));
      PERFORM pms_notify(a.tenant_id, v_emp, a.uid, 'pms_review_launched', p_period || ' performance review',
        'Your self-assessment is open.', v_id);
    END IF;
    v_id := NULL;
  END LOOP;
  RETURN pms_workspace(p_fy) || jsonb_build_object('result', jsonb_build_object('created', v_count));
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_submit_cycle_assessment(p_review uuid, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; r pms_cycle_reviews; v_clean jsonb;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_reviews');
  SELECT * INTO r FROM pms_cycle_reviews WHERE id = p_review AND tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pms_fail('Review not found.'); END IF;
  IF r.status = 'Released' THEN PERFORM pms_fail('This review has been released and is read-only.'); END IF;
  v_clean := pms_clean_cycle_answers(r.questions, p_answers);
  IF r.employee_id = a.uid THEN
    UPDATE pms_cycle_reviews SET self_answers = v_clean, updated_at = now(),
      status = CASE WHEN manager_answers IS NOT NULL THEN 'Manager submitted' ELSE 'Self submitted' END WHERE id = r.id;
    PERFORM pms_notify(a.tenant_id, pms_employee_approver(r.employee_id), a.uid, 'pms_self_submitted', 'Self-assessment submitted',
      COALESCE(pms_person_name(a.uid), 'An employee') || ' submitted a ' || r.period || ' self-assessment.', r.id);
    PERFORM pms_audit(a.tenant_id, 'cycle_review', r.id, 'self-submit', a.uid);
  ELSIF pms_can_manage_emp(a.uid, a.role, r.employee_id) THEN
    UPDATE pms_cycle_reviews SET manager_answers = v_clean, manager_by = a.uid, status = 'Manager submitted', updated_at = now() WHERE id = r.id;
    PERFORM pms_audit(a.tenant_id, 'cycle_review', r.id, 'manager-submit', a.uid);
  ELSE
    PERFORM pms_fail('Only the employee, their manager or HR can complete this assessment.');
  END IF;
  RETURN pms_workspace(r.fy);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_release_cycle_review(p_review uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; r pms_cycle_reviews; k pms_kpis; s pms_kpis; v_months int[]; v_due int[]; v_policy jsonb;
BEGIN
  SELECT * INTO a FROM pms_actor();
  IF NOT pms_is_hr(a.role) THEN PERFORM pms_fail('HR access is required to release results.'); END IF;
  PERFORM pms_require_feature(a.tenant_id, 'performance_reviews');
  SELECT * INTO r FROM pms_cycle_reviews WHERE id = p_review AND tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pms_fail('Review not found.'); END IF;
  IF r.employee_id = a.uid THEN PERFORM pms_fail('Another HR administrator must release your own result.'); END IF;
  IF r.status <> 'Manager submitted' OR r.self_answers IS NULL THEN PERFORM pms_fail('Self and manager assessments are required before release.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.questions) q WHERE q->>'type' = 'Rating' AND r.manager_answers->>(q->>'id') IN ('1','2','3','4','5')) THEN
    PERFORM pms_fail('The manager assessment needs at least one rating before release.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pms_scorecards WHERE tenant_id = a.tenant_id AND fy = r.fy AND owner_type = 'Employee'
                 AND owner_id = r.employee_id::text AND status = 'Locked') THEN
    PERFORM pms_fail('The employee''s scorecard must be approved and locked before release.');
  END IF;
  v_months := pms_period_months(r.period);
  IF NOT EXISTS (SELECT 1 FROM pms_kpis WHERE tenant_id = a.tenant_id AND fy = r.fy AND employee_id = r.employee_id) THEN
    PERFORM pms_fail('The employee has no KPIs for this year.');
  END IF;
  FOR k IN SELECT * FROM pms_kpis WHERE tenant_id = a.tenant_id AND fy = r.fy AND employee_id = r.employee_id LOOP
    IF k.shared_source_id IS NOT NULL THEN SELECT * INTO s FROM pms_kpis WHERE id = k.shared_source_id; ELSE s := k; END IF;
    v_due := pms_due_months(s.frequency, s.kind, v_months);
    IF cardinality(v_due) = 0 OR EXISTS (SELECT 1 FROM unnest(v_due) m WHERE NOT EXISTS (SELECT 1 FROM pms_kpi_updates u
         WHERE u.kpi_id = s.id AND u.month = m AND u.status = 'Confirmed' AND u.applicability = 'Measured')) THEN
      PERFORM pms_fail('Every KPI due in ' || r.period || ' needs a confirmed result before release (' || k.title || ').');
    END IF;
  END LOOP;
  SELECT jsonb_build_object('year', r.fy, 'kpiWeight', COALESCE(st.kpi_weight, 70), 'cap', COALESCE(st.cap, 120), 'deadline', st.deadline)
    INTO v_policy FROM (SELECT 1) x LEFT JOIN pms_settings st ON st.tenant_id = a.tenant_id;
  UPDATE pms_cycle_reviews SET status = 'Released', released_by = a.uid, released_at = now(), released_policy = v_policy,
    released_snapshot = pms_plan_snapshot(a.tenant_id, r.fy, 'Employee', r.employee_id::text) || jsonb_build_object('policy', v_policy, 'at', now()),
    updated_at = now() WHERE id = r.id;
  PERFORM pms_audit(a.tenant_id, 'cycle_review', r.id, 'release', a.uid);
  PERFORM pms_notify(a.tenant_id, r.employee_id, a.uid, 'pms_review_released', 'Performance review released',
    'Your ' || r.period || ' review result is available.', r.id);
  RETURN pms_workspace(r.fy);
END;
$$;

-- ═══ Independent review templates ═══════════════════════════════════════

-- p: {id?, family?, title, description, type, scored, questions}. Published
-- versions are immutable; editing one creates a new draft version.
CREATE OR REPLACE FUNCTION public.pms_save_template(p jsonb, p_publish boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; t pms_review_templates; v_family uuid; v_version int; v_q jsonb;
BEGIN
  SELECT * INTO a FROM pms_actor();
  IF NOT pms_is_hr(a.role) THEN PERFORM pms_fail('HR access is required.'); END IF;
  PERFORM pms_require_feature(a.tenant_id, 'performance_reviews');
  IF btrim(COALESCE(p->>'title', '')) = '' THEN PERFORM pms_fail('Give the template a name.'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', COALESCE(NULLIF(q->>'id', ''), gen_random_uuid()::text), 'text', btrim(COALESCE(q->>'text', '')),
           'type', q->>'type', 'required', COALESCE((q->>'required')::boolean, false),
           'weight', COALESCE(NULLIF(q->>'weight', '')::numeric, 0), 'options', COALESCE(q->>'options', ''))), '[]'::jsonb)
    INTO v_q FROM jsonb_array_elements(COALESCE(p->'questions', '[]'::jsonb)) q;
  IF p_publish THEN PERFORM pms_validate_template(p->>'title', p->>'type', COALESCE((p->>'scored')::boolean, false), v_q);
  ELSIF COALESCE(p->>'type', '') NOT IN ('Self','Manager','Peer','Upward','Interdepartmental','360','Project','Custom') THEN
    PERFORM pms_fail('Choose a review type.');
  END IF;
  SELECT * INTO t FROM pms_review_templates WHERE id = NULLIF(p->>'id', '')::uuid AND tenant_id = a.tenant_id FOR UPDATE;
  IF FOUND AND t.status = 'Draft' THEN
    UPDATE pms_review_templates SET title = btrim(p->>'title'), description = COALESCE(btrim(p->>'description'), ''), type = p->>'type',
      scored = COALESCE((p->>'scored')::boolean, false), questions = v_q, status = CASE WHEN p_publish THEN 'Published' ELSE 'Draft' END,
      updated_at = now() WHERE id = t.id;
  ELSE
    v_family := COALESCE(t.family, (SELECT family FROM pms_review_templates WHERE tenant_id = a.tenant_id AND family = NULLIF(p->>'family', '')::uuid LIMIT 1), gen_random_uuid());
    SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM pms_review_templates WHERE tenant_id = a.tenant_id AND family = v_family;
    INSERT INTO pms_review_templates (tenant_id, family, version, status, type, title, description, scored, questions, created_by)
    VALUES (a.tenant_id, v_family, v_version, CASE WHEN p_publish THEN 'Published' ELSE 'Draft' END, p->>'type', btrim(p->>'title'),
            COALESCE(btrim(p->>'description'), ''), COALESCE((p->>'scored')::boolean, false), v_q, a.uid)
    RETURNING * INTO t;
  END IF;
  PERFORM pms_audit(a.tenant_id, 'template', COALESCE(t.id, NULLIF(p->>'id', '')::uuid), CASE WHEN p_publish THEN 'publish' ELSE 'save-draft' END, a.uid);
  RETURN pms_workspace(NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_archive_template(p_template uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM pms_actor();
  IF NOT pms_is_hr(a.role) THEN PERFORM pms_fail('HR access is required.'); END IF;
  UPDATE pms_review_templates SET status = 'Archived', updated_at = now()
  WHERE id = p_template AND tenant_id = a.tenant_id AND status <> 'Archived';
  IF NOT FOUND THEN PERFORM pms_fail('Template not found or already archived.'); END IF;
  PERFORM pms_audit(a.tenant_id, 'template', p_template, 'archive', a.uid);
  RETURN pms_workspace(NULL);
END;
$$;

-- ═══ Independent review campaigns ═══════════════════════════════════════

-- p: {title, templateId, subject:{type,id,name,department}, reviewerIds[], recipientId, start, end, visibility}
CREATE OR REPLACE FUNCTION public.pms_create_campaign(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; t pms_review_templates; v_subject jsonb; v_type text := COALESCE(p->'subject'->>'type', ''); v_emp profiles;
  v_recipient uuid := NULLIF(p->>'recipientId', '')::uuid; v_start date := NULLIF(p->>'start', '')::date; v_end date := NULLIF(p->>'end', '')::date;
  v_reviewers uuid[]; v_r uuid; v_role text; v_rdept text; v_id uuid;
BEGIN
  SELECT * INTO a FROM pms_actor();
  IF NOT pms_is_hr(a.role) THEN PERFORM pms_fail('HR access is required.'); END IF;
  PERFORM pms_require_feature(a.tenant_id, 'performance_reviews');
  SELECT * INTO t FROM pms_review_templates WHERE id = NULLIF(p->>'templateId', '')::uuid AND tenant_id = a.tenant_id;
  IF NOT FOUND OR t.status <> 'Published' THEN PERFORM pms_fail('Choose a published template.'); END IF;
  PERFORM pms_validate_template(t.title, t.type, t.scored, t.questions);
  IF btrim(COALESCE(p->>'title', '')) = '' OR v_type NOT IN ('Employee','Department','Team','Project') THEN
    PERFORM pms_fail('Provide a campaign name and review subject.');
  END IF;
  IF v_start IS NULL OR v_end IS NULL OR v_end < v_start THEN PERFORM pms_fail('End date must be on or after the start date.'); END IF;
  IF COALESCE(p->>'visibility', '') NOT IN ('Named','Confidential') THEN PERFORM pms_fail('Choose a supported visibility policy.'); END IF;
  IF v_type = 'Employee' THEN
    SELECT * INTO v_emp FROM profiles WHERE id = NULLIF(p->'subject'->>'id', '')::uuid AND tenant_id = a.tenant_id AND status = 'Active';
    IF NOT FOUND THEN PERFORM pms_fail('Choose the employee being reviewed.'); END IF;
    v_subject := jsonb_build_object('type', 'Employee', 'id', v_emp.id, 'name', pms_person_name(v_emp.id), 'department', v_emp.department);
    v_recipient := v_emp.id;
  ELSE
    IF btrim(COALESCE(p->'subject'->>'name', '')) = '' THEN PERFORM pms_fail('Provide the review subject.'); END IF;
    v_subject := jsonb_build_object('type', v_type, 'id', btrim(p->'subject'->>'name'), 'name', btrim(p->'subject'->>'name'),
      'department', CASE WHEN v_type = 'Department' THEN btrim(p->'subject'->>'name') ELSE NULLIF(btrim(p->'subject'->>'department'), '') END);
  END IF;
  IF v_recipient IS NULL OR NOT pms_active_member(a.tenant_id, v_recipient) THEN PERFORM pms_fail('Choose a result recipient.'); END IF;
  IF t.type IN ('Self','Manager','Peer','Upward','360') AND v_type <> 'Employee' THEN PERFORM pms_fail('This review type requires an employee subject.'); END IF;
  IF t.type = 'Interdepartmental' AND NULLIF(v_subject->>'department', '') IS NULL THEN
    PERFORM pms_fail('Choose the subject''s department for interdepartmental reviews.');
  END IF;
  v_reviewers := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(COALESCE(p->'reviewerIds', '[]'::jsonb)) x);
  IF cardinality(v_reviewers) = 0 THEN PERFORM pms_fail('Choose at least one reviewer.'); END IF;
  IF cardinality(v_reviewers) > 200 THEN PERFORM pms_fail('Choose at most 200 reviewers.'); END IF;
  FOREACH v_r IN ARRAY v_reviewers LOOP
    IF NOT pms_active_member(a.tenant_id, v_r) THEN PERFORM pms_fail('Every reviewer must be an active employee of this company.'); END IF;
    v_role := pms_reviewer_role(t.type, v_subject, v_r);
    IF t.type IN ('Self','Manager','Peer','Upward') AND v_role <> t.type THEN
      PERFORM pms_fail(COALESCE(pms_person_name(v_r), 'A reviewer') || ' does not have the ' || lower(t.type)
        || ' relationship to this employee. Use Custom for a different relationship.');
    END IF;
    SELECT department INTO v_rdept FROM profiles WHERE id = v_r;
    IF t.type = 'Interdepartmental' AND lower(btrim(COALESCE(v_rdept, ''))) = lower(btrim(v_subject->>'department')) THEN
      PERFORM pms_fail('Interdepartmental reviewers must come from another department.');
    END IF;
  END LOOP;
  INSERT INTO pms_review_campaigns (tenant_id, title, template_id, template, subject, recipient_id, start_date, end_date, visibility, created_by)
  VALUES (a.tenant_id, btrim(p->>'title'), t.id, pms_template_json(t), v_subject, v_recipient, v_start, v_end, p->>'visibility', a.uid)
  RETURNING id INTO v_id;
  INSERT INTO pms_review_assignments (tenant_id, campaign_id, reviewer_id, role)
  SELECT a.tenant_id, v_id, r, pms_reviewer_role(t.type, v_subject, r) FROM unnest(v_reviewers) r;
  PERFORM pms_audit(a.tenant_id, 'campaign', v_id, 'Created', a.uid);
  RETURN pms_workspace(NULL);
END;
$$;

-- p_action: launch | save | submit | return | release | extend | cancel
CREATE OR REPLACE FUNCTION public.pms_campaign_action(p_campaign uuid, p_action text, p_assignment uuid DEFAULT NULL,
                                                      p_answers jsonb DEFAULT NULL, p_reason text DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; c pms_review_campaigns; s pms_review_assignments; v_hr boolean; v_res jsonb; v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_reviews');
  v_hr := pms_is_hr(a.role);
  SELECT * INTO c FROM pms_review_campaigns WHERE id = p_campaign AND tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pms_fail('Review not found.'); END IF;
  IF p_action IN ('launch','release','return','cancel','extend') AND NOT v_hr THEN PERFORM pms_fail('HR access is required.'); END IF;
  IF p_assignment IS NOT NULL THEN
    SELECT * INTO s FROM pms_review_assignments WHERE id = p_assignment AND campaign_id = c.id FOR UPDATE;
  END IF;

  IF p_action = 'launch' THEN
    IF c.status <> 'Draft' THEN PERFORM pms_fail('This campaign has already been launched.'); END IF;
    IF pms_today() < c.start_date OR pms_today() > c.end_date THEN PERFORM pms_fail('Launch within the configured date window.'); END IF;
    UPDATE pms_review_campaigns SET status = 'Active', updated_at = now() WHERE id = c.id;
    PERFORM pms_notify(a.tenant_id, x.reviewer_id, a.uid, 'pms_review_task', 'Review requested',
      c.title || ' — please respond by ' || to_char(c.end_date, 'DD Mon YYYY') || '.', c.id)
    FROM pms_review_assignments x WHERE x.campaign_id = c.id;
  ELSIF p_action IN ('save','submit') THEN
    IF s.id IS NULL OR s.reviewer_id <> a.uid OR c.status <> 'Active' OR s.status = 'Submitted' THEN
      PERFORM pms_fail('Only the assigned reviewer can update an open response.');
    END IF;
    IF pms_today() < c.start_date OR pms_today() > c.end_date THEN PERFORM pms_fail('This response window is closed.'); END IF;
    v_res := pms_campaign_answers(c.template, COALESCE(p_answers, '{}'::jsonb), p_action = 'submit');
    UPDATE pms_review_assignments SET answers = v_res->'answers', updated_at = now(),
      status = CASE WHEN p_action = 'submit' THEN 'Submitted' ELSE 'In progress' END,
      submitted_at = CASE WHEN p_action = 'submit' THEN now() ELSE submitted_at END,
      score = CASE WHEN p_action = 'submit' THEN (v_res->>'score')::numeric END
    WHERE id = s.id;
  ELSIF p_action = 'return' THEN
    IF c.status <> 'Active' OR s.id IS NULL OR s.status <> 'Submitted' OR s.reviewer_id = a.uid THEN
      PERFORM pms_fail('Only another reviewer''s submitted response can be returned before release.');
    END IF;
    IF v_reason = '' THEN PERFORM pms_fail('Give a reason for returning this response.'); END IF;
    UPDATE pms_review_assignments SET status = 'Returned', reason = left(v_reason, 2000), score = NULL, updated_at = now(),
      previous_submissions = previous_submissions || jsonb_build_array(jsonb_build_object('answers', answers, 'score', score, 'at', submitted_at))
    WHERE id = s.id;
    PERFORM pms_notify(a.tenant_id, s.reviewer_id, a.uid, 'pms_review_returned', 'Review response returned', c.title || ': ' || left(v_reason, 200), c.id);
  ELSIF p_action = 'release' THEN
    IF c.status <> 'Active' OR EXISTS (SELECT 1 FROM pms_review_assignments WHERE campaign_id = c.id AND status <> 'Submitted') THEN
      PERFORM pms_fail('Every assigned response must be submitted before release.');
    END IF;
    IF c.recipient_id = a.uid THEN PERFORM pms_fail('Another HR administrator must release your results.'); END IF;
    UPDATE pms_review_campaigns SET status = 'Released', released_at = now(), updated_at = now() WHERE id = c.id;
    PERFORM pms_notify(a.tenant_id, c.recipient_id, a.uid, 'pms_review_results', 'Review results released', c.title, c.id);
  ELSIF p_action = 'extend' THEN
    IF c.status NOT IN ('Draft','Active') OR p_end IS NULL OR p_end <= c.end_date OR v_reason = '' THEN
      PERFORM pms_fail('Choose a later deadline and provide a reason for an open campaign.');
    END IF;
    UPDATE pms_review_campaigns SET end_date = p_end, updated_at = now() WHERE id = c.id;
  ELSIF p_action = 'cancel' THEN
    IF c.status NOT IN ('Draft','Active') OR v_reason = '' THEN PERFORM pms_fail('Only draft or active campaigns can be cancelled, with a reason.'); END IF;
    UPDATE pms_review_campaigns SET status = 'Cancelled', cancel_reason = left(v_reason, 2000), updated_at = now() WHERE id = c.id;
  ELSE PERFORM pms_fail('Unknown review action.');
  END IF;
  PERFORM pms_audit(a.tenant_id, 'campaign', c.id, p_action, a.uid, v_reason, NULL,
    jsonb_strip_nulls(jsonb_build_object('assignmentId', p_assignment, 'end', p_end)));
  RETURN pms_workspace(NULL);
END;
$$;

-- ═══ Privileges: RPC surface only for signed-in users ═══════════════════

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'pms\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  public.pms_workspace(int),
  public.pms_save_settings(int, numeric, numeric, date, boolean, int),
  public.pms_save_questions(int, jsonb),
  public.pms_create_goal(int, jsonb),
  public.pms_update_goal_target(uuid, numeric, int),
  public.pms_delete_goal(uuid),
  public.pms_create_kpi(int, jsonb),
  public.pms_update_kpi_weights(jsonb),
  public.pms_update_kpi_targets(uuid, numeric[], int),
  public.pms_delete_kpi(uuid),
  public.pms_submit_update(uuid, int, jsonb),
  public.pms_decide_update(uuid, int, text, text),
  public.pms_scorecard_action(int, text, text, text, text),
  public.pms_launch_cycle_reviews(int, text, uuid[]),
  public.pms_submit_cycle_assessment(uuid, jsonb),
  public.pms_release_cycle_review(uuid),
  public.pms_save_template(jsonb, boolean),
  public.pms_archive_template(uuid),
  public.pms_create_campaign(jsonb),
  public.pms_campaign_action(uuid, text, uuid, jsonb, text, date)
TO authenticated;

-- Pin search_path on the non-SECURITY-DEFINER helpers too (advisor
-- function_search_path_mutable).
ALTER FUNCTION public.pms_fail(text) SET search_path = public;
ALTER FUNCTION public.pms_is_hr(text) SET search_path = public;
ALTER FUNCTION public.pms_is_mgr(text) SET search_path = public;
ALTER FUNCTION public.pms_current_fy() SET search_path = public;
ALTER FUNCTION public.pms_today() SET search_path = public;
ALTER FUNCTION public.pms_default_questions() SET search_path = public;
ALTER FUNCTION public.pms_period_months(text) SET search_path = public;
ALTER FUNCTION public.pms_due_months(text, text, int[]) SET search_path = public;
ALTER FUNCTION public.pms_goal_json(public.pms_goals) SET search_path = public;
ALTER FUNCTION public.pms_template_json(public.pms_review_templates) SET search_path = public;
ALTER FUNCTION public.pms_clean_cycle_answers(jsonb, jsonb) SET search_path = public;
ALTER FUNCTION public.pms_validate_template(text, text, boolean, jsonb) SET search_path = public;
ALTER FUNCTION public.pms_campaign_answers(jsonb, jsonb, boolean) SET search_path = public;
