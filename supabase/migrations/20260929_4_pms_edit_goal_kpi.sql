-- PMS: edit goals and KPIs after creation, and fix pms_card_issues.
--
-- 1. pms_card_issues appended an untyped literal to a text[]
--    (`v_issues || 'KRA weights must total 100%'`), which Postgres reads as
--    array || array and fails with "malformed array literal" whenever KRA
--    weights do not total 100%. The literal is now typed text.
-- 2. pms_update_goal: title, objective, owner, annual target and unit.
--    Scope, parent, department, team and allocation mode stay fixed (they
--    decide who may manage the goal and how targets roll up; delete and
--    recreate to change them).
-- 3. pms_update_kpi: every field set by pms_create_kpi except the owner.
--    Measurement type and frequency are frozen once results exist.
--
-- Both edits follow the existing rules: only while the scorecard is Draft
-- (pms_kpi_editable / pms_goal_protected), optimistic row_version checks,
-- audit rows, and they return the refreshed workspace. Additive only.

-- ═══ 1. pms_card_issues: typed literal ═══════════════════════════════════

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
    v_issues := v_issues || 'KRA weights must total 100%'::text;
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

-- ═══ 2. Edit a goal ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pms_update_goal(p_goal uuid, p jsonb, p_expected_version int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; g pms_goals; v_parent pms_goals;
  v_title text := btrim(COALESCE(p->>'title', ''));
  v_desc text := COALESCE(btrim(p->>'description'), '');
  v_owner uuid := NULLIF(p->>'ownerId', '')::uuid;
  v_target numeric := NULLIF(p->>'annualTarget', '')::numeric;
  v_unit text := NULLIF(btrim(p->>'unit'), '');
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  SELECT * INTO g FROM pms_goals WHERE id = p_goal AND tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pms_fail('Goal not found.'); END IF;
  IF NOT (pms_is_hr(a.role) OR (pms_is_mgr(a.role) AND (g.created_by = a.uid OR g.owner_id = a.uid))) THEN
    PERFORM pms_fail('Only HR or the goal''s owner can edit it.');
  END IF;
  IF p_expected_version IS NULL OR g.row_version <> p_expected_version THEN
    PERFORM pms_fail('This goal was changed by someone else. Reload and try again.');
  END IF;
  IF pms_goal_protected(g.id) THEN
    PERFORM pms_fail('This goal supports a submitted or locked scorecard. Open a revision before editing it.');
  END IF;
  IF length(v_title) NOT BETWEEN 1 AND 160 THEN PERFORM pms_fail('Enter a goal title of up to 160 characters.'); END IF;
  IF length(v_desc) > 2000 THEN PERFORM pms_fail('Keep the objective under 2000 characters.'); END IF;
  IF v_owner IS NULL OR NOT pms_active_member(a.tenant_id, v_owner) THEN PERFORM pms_fail('Choose an accountable owner from this company.'); END IF;
  IF g.scope = 'Individual' AND v_owner IS DISTINCT FROM g.owner_id
     AND NOT (pms_can_manage_emp(a.uid, a.role, v_owner) OR v_owner = a.uid) THEN
    PERFORM pms_fail('You can only set individual goals for people in your team.');
  END IF;
  IF v_target IS NOT NULL AND v_target <= 0 THEN PERFORM pms_fail('Annual targets must be positive.'); END IF;

  IF g.allocation = 'Allocated' THEN
    -- An allocated share keeps its parent's unit.
    SELECT * INTO v_parent FROM pms_goals WHERE id = g.parent_id;
    IF v_target IS NULL THEN PERFORM pms_fail('Enter the allocated annual target.'); END IF;
    v_unit := v_parent.unit;
  ELSIF EXISTS (SELECT 1 FROM pms_goals WHERE parent_id = g.id AND allocation = 'Allocated') THEN
    -- Children are allocated from this target in this unit.
    IF v_target IS NULL THEN PERFORM pms_fail('Child goals are allocated from this target, so it cannot be blank.'); END IF;
    v_unit := g.unit;
  END IF;
  IF length(COALESCE(v_unit, '')) > 40 THEN PERFORM pms_fail('Keep the unit under 40 characters.'); END IF;
  IF (v_target IS DISTINCT FROM g.annual_target OR v_unit IS DISTINCT FROM g.unit) AND pms_goal_protected(g.parent_id) THEN
    PERFORM pms_fail('The parent goal supports a submitted or locked scorecard. Open a revision before changing this allocation.');
  END IF;

  UPDATE pms_goals SET title = v_title, description = v_desc, owner_id = v_owner, annual_target = v_target, unit = v_unit,
    row_version = row_version + 1, updated_at = now() WHERE id = g.id;
  PERFORM pms_audit(a.tenant_id, 'goal', g.id, 'update', a.uid, NULL, NULL, jsonb_build_object(
    'from', jsonb_build_object('title', g.title, 'ownerId', g.owner_id, 'annualTarget', g.annual_target, 'unit', g.unit),
    'to', jsonb_build_object('title', v_title, 'ownerId', v_owner, 'annualTarget', v_target, 'unit', v_unit)));
  RETURN pms_workspace(g.fy);
END;
$$;

-- ═══ 3. Edit a KPI ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pms_update_kpi(p_kpi uuid, p jsonb, p_expected_version int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; k pms_kpis; c pms_scorecards;
  v_kra text := btrim(COALESCE(p->>'kra', '')); v_title text := btrim(COALESCE(p->>'title', ''));
  v_kraw numeric := NULLIF(p->>'kraWeight', '')::numeric; v_weight numeric := NULLIF(p->>'weight', '')::numeric;
  v_goal uuid := NULLIF(p->>'goalId', '')::uuid; v_existing numeric;
  v_kind text; v_freq text; v_target numeric; v_unit text; v_dir text; v_src text;
  v_sub uuid; v_app uuid; v_ms jsonb := '[]'::jsonb; v_targets numeric[];
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_kras');
  SELECT * INTO k FROM pms_kpis WHERE id = p_kpi AND tenant_id = a.tenant_id;
  IF NOT FOUND THEN PERFORM pms_fail('KPI not found.'); END IF;
  PERFORM pms_require_owner_manage(a.uid, a.role, a.tenant_id, k.fy, k.owner_type, k.owner_id);
  c := pms_lock_card(a.tenant_id, k.fy, k.owner_type, k.owner_id);
  SELECT * INTO k FROM pms_kpis WHERE id = p_kpi FOR UPDATE;
  IF p_expected_version IS NULL OR k.row_version <> p_expected_version THEN
    PERFORM pms_fail('This KPI was changed by someone else. Reload and try again.');
  END IF;
  IF c.status <> 'Draft' OR NOT pms_kpi_editable(k.id) THEN
    PERFORM pms_fail('This scorecard is read-only. An approved change request is required.');
  END IF;
  IF v_kra = '' OR v_title = '' THEN PERFORM pms_fail('Enter the KRA and KPI title.'); END IF;
  IF v_weight IS NULL OR v_weight <= 0 OR v_weight > 100 THEN PERFORM pms_fail('KPI weight within the KRA must be between 1 and 100.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pms_goals WHERE id = v_goal AND tenant_id = a.tenant_id AND fy = k.fy) THEN
    PERFORM pms_fail('Choose an aligned goal.');
  END IF;

  -- A KRA shared with other KPIs keeps its weight; change it with Edit weights.
  SELECT min(kra_weight) INTO v_existing FROM pms_kpis WHERE tenant_id = k.tenant_id AND fy = k.fy
    AND owner_type = k.owner_type AND owner_id = k.owner_id AND kra = v_kra AND id <> k.id;
  v_kraw := COALESCE(v_existing, v_kraw);
  IF v_kraw IS NULL OR v_kraw <= 0 OR v_kraw > 100 THEN PERFORM pms_fail('KRA weight must be between 1 and 100.'); END IF;

  IF k.shared_source_id IS NOT NULL THEN
    -- Measurement comes from the shared source; only placement changes here.
    v_kind := k.kind; v_freq := k.frequency; v_target := k.target; v_unit := k.unit; v_dir := k.direction;
    v_src := k.data_source; v_sub := k.submitter_id; v_app := k.approver_id; v_ms := k.milestones; v_targets := k.targets;
  ELSE
    v_kind := COALESCE(NULLIF(p->>'kind', ''), k.kind);
    v_freq := CASE WHEN p->>'frequency' IN ('Monthly','Quarterly','Annual') THEN p->>'frequency' ELSE k.frequency END;
    IF v_kind NOT IN ('Volume','Rate','Weighted average','Snapshot','Milestone','Rubric','Zero incidents') THEN PERFORM pms_fail('Choose a measurement type.'); END IF;
    IF (v_kind <> k.kind OR v_freq <> k.frequency) AND EXISTS (SELECT 1 FROM pms_kpi_updates WHERE kpi_id = k.id) THEN
      PERFORM pms_fail('Results were already entered for this KPI, so its measurement type and frequency cannot change. Remove it and assign a new KPI instead.');
    END IF;
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
    IF length(v_unit) > 40 THEN PERFORM pms_fail('Keep the unit under 40 characters.'); END IF;
    IF v_kind = 'Milestone' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', COALESCE(NULLIF(m->>'id', ''), gen_random_uuid()::text),
               'title', btrim(m->>'title'), 'weight', (m->>'weight')::numeric)), '[]'::jsonb)
        INTO v_ms FROM jsonb_array_elements(COALESCE(p->'milestones', '[]'::jsonb)) m;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ms) m WHERE btrim(COALESCE(m->>'title', '')) = '' OR (m->>'weight')::numeric <= 0)
         OR abs(COALESCE((SELECT sum((m->>'weight')::numeric) FROM jsonb_array_elements(v_ms) m), 0) - 100) > 0.001 THEN
        PERFORM pms_fail('Every milestone needs a title, and milestone weights must total 100%.');
      END IF;
    END IF;
    v_dir := CASE WHEN p->>'direction' = 'Lower' THEN 'Lower' ELSE 'Higher' END;
    v_src := CASE WHEN p->>'dataSource' = 'Imported report reference' THEN p->>'dataSource' ELSE 'Manual' END;
    -- Phased monthly targets split the old target; drop them when it changes.
    v_targets := CASE WHEN v_kind = 'Volume' AND v_freq = 'Monthly' AND v_target IS NOT DISTINCT FROM k.target THEN k.targets END;
  END IF;

  UPDATE pms_kpis SET kra = v_kra, kra_weight = v_kraw, title = v_title, weight = v_weight, goal_id = v_goal,
    kind = v_kind, frequency = v_freq, target = v_target, unit = COALESCE(v_unit, ''), direction = v_dir,
    data_source = v_src, submitter_id = v_sub, approver_id = v_app, milestones = v_ms, targets = v_targets,
    row_version = row_version + 1, updated_at = now()
  WHERE id = k.id;
  PERFORM pms_audit(a.tenant_id, 'kpi', k.id, 'update', a.uid, NULL, c.revision, jsonb_build_object(
    'from', jsonb_build_object('title', k.title, 'kra', k.kra, 'kind', k.kind, 'target', k.target, 'weight', k.weight),
    'to', jsonb_build_object('title', v_title, 'kra', v_kra, 'kind', v_kind, 'target', v_target, 'weight', v_weight)));
  RETURN pms_workspace(k.fy);
END;
$$;

-- ═══ Privileges ═════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.pms_update_goal(uuid, jsonb, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pms_update_kpi(uuid, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_update_goal(uuid, jsonb, int), public.pms_update_kpi(uuid, jsonb, int) TO authenticated;
