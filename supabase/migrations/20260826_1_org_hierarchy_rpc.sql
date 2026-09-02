-- =============================================================
-- Hierarchy & Workflow Engine — Phase 1e: org-tree manager
-- assignment RPC (checkpoint 1 of the Org Hierarchy UI feature).
--
-- Single atomic entry point the new /org-structure page calls to
-- reassign an employee's direct manager. Keeps the dual-write
-- bridge intact (docs/hierarchy-workflow-engine-analysis.md §4.3):
-- every call updates reporting_relationships (new source of truth)
-- AND profiles.manager_id (legacy column still read by RLS/UI) in
-- the same transaction, so nothing existing can observe a partial
-- update. Purely additive — no existing function/table is altered.
--
-- Known gap (documented, accepted for checkpoint 1): EmployeesPage
-- still writes profiles.manager_id directly, bypassing this RPC,
-- so reporting_relationships can drift stale relative to it. A
-- follow-up should add a sync trigger; not done here to avoid
-- scope creep into this checkpoint.
-- =============================================================

CREATE OR REPLACE FUNCTION set_direct_manager(p_profile_id uuid, p_manager_id uuid)
RETURNS void AS $$
DECLARE
  v_caller_id      uuid := auth.uid();
  v_caller_role    text;
  v_caller_tenant  uuid;
  v_target_tenant  uuid;
  v_manager_tenant uuid;
BEGIN
  SELECT role, tenant_id INTO v_caller_role, v_caller_tenant FROM profiles WHERE id = v_caller_id;
  SELECT tenant_id INTO v_target_tenant FROM profiles WHERE id = p_profile_id;

  IF v_target_tenant IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin','manager','superadmin') THEN
    RAISE EXCEPTION 'Not authorized to assign managers';
  END IF;
  IF v_caller_role <> 'superadmin' AND v_caller_tenant IS DISTINCT FROM v_target_tenant THEN
    RAISE EXCEPTION 'Cannot modify a profile outside your tenant';
  END IF;

  IF p_manager_id IS NOT NULL THEN
    IF p_manager_id = p_profile_id THEN
      RAISE EXCEPTION 'An employee cannot manage themselves';
    END IF;

    SELECT tenant_id INTO v_manager_tenant FROM profiles WHERE id = p_manager_id;
    IF v_manager_tenant IS NULL OR v_manager_tenant IS DISTINCT FROM v_target_tenant THEN
      RAISE EXCEPTION 'Manager must belong to the same tenant';
    END IF;

    -- Reject a cycle: the proposed manager must not already be a
    -- report (direct or indirect) of the target profile.
    IF EXISTS (
      SELECT 1 FROM get_reporting_chain(p_manager_id) c WHERE c.profile_id = p_profile_id
    ) THEN
      RAISE EXCEPTION 'This assignment would create a reporting cycle';
    END IF;
  END IF;

  -- Close any existing active primary DIRECT_MANAGER edge.
  UPDATE reporting_relationships
     SET valid_to = current_date
   WHERE profile_id = p_profile_id
     AND relationship_type = 'DIRECT_MANAGER'
     AND is_primary
     AND valid_to IS NULL;

  IF p_manager_id IS NOT NULL THEN
    INSERT INTO reporting_relationships (tenant_id, profile_id, related_profile_id, relationship_type, is_primary, valid_from)
    VALUES (v_target_tenant, p_profile_id, p_manager_id, 'DIRECT_MANAGER', true, current_date);
  END IF;

  UPDATE profiles SET manager_id = p_manager_id WHERE id = p_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION set_direct_manager(uuid, uuid) TO authenticated;
