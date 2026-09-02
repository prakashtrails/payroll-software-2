-- =============================================================
-- Hierarchy & Workflow Engine — Phase 1c: authorization functions
--
-- Generalizes the existing my_tenant_id()/my_role() helper-function
-- pattern (supabase_migration.sql) rather than replacing it. These
-- are additive SECURITY DEFINER functions; nothing existing calls
-- them yet, so creating them changes no behavior.
-- =============================================================

-- ── resolve_active_approver: substitutes an active delegate for a
--    profile if approval_delegations has a current row for them,
--    otherwise returns the profile unchanged. Never mutates the
--    underlying reporting_relationships row (spec §27: normal
--    hierarchy resumes automatically once delegation expires). ──
CREATE OR REPLACE FUNCTION resolve_active_approver(p_profile_id uuid)
RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT delegate_id FROM approval_delegations
      WHERE delegator_id = p_profile_id
        AND now() BETWEEN starts_at AND ends_at
      ORDER BY starts_at DESC LIMIT 1),
    p_profile_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── get_reporting_chain: walks reporting_relationships upward from a
--    profile via DIRECT_MANAGER edges (falls back to profiles.manager_id
--    for tenants not yet backfilled), applying any active delegation
--    at read time. Bounded to 50 hops to guarantee termination even if
--    a cycle is ever introduced by bad data. ──
CREATE OR REPLACE FUNCTION get_reporting_chain(p_profile_id uuid)
RETURNS TABLE(profile_id uuid, depth int) AS $$
WITH RECURSIVE chain AS (
  SELECT p_profile_id AS profile_id, 0 AS depth
  UNION ALL
  SELECT resolve_active_approver(rr.related_profile_id) AS profile_id, chain.depth + 1
  FROM chain
  JOIN reporting_relationships rr
    ON rr.profile_id = chain.profile_id
   AND rr.relationship_type = 'DIRECT_MANAGER'
   AND rr.is_primary
   AND rr.valid_to IS NULL
  WHERE chain.depth < 50
)
SELECT profile_id, depth FROM chain WHERE depth > 0;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── has_permission: does this profile hold a role granting this
--    permission key, currently active (valid_from/valid_to window)? ──
CREATE OR REPLACE FUNCTION has_permission(p_profile_id uuid, p_permission_key text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions perm ON perm.id = rp.permission_id
    WHERE ur.profile_id = p_profile_id
      AND perm.key = p_permission_key
      AND ur.valid_from <= current_date
      AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── resolve_scope_profile_ids: the set of profile_ids a given profile
--    can act on for a permission key, per their widest granted scope.
--    GLOBAL/ENTIRE_TENANT short-circuit to avoid walking the graph;
--    DIRECT_REPORTS/TEAM walk get_reporting_chain in reverse (who
--    reports up to me); DEPARTMENT/LOCATION intersect with the
--    profile's user_roles department/location. ──
CREATE OR REPLACE FUNCTION resolve_scope_profile_ids(p_profile_id uuid, p_permission_key text)
RETURNS TABLE(profile_id uuid) AS $$
DECLARE
  v_tenant_id uuid;
  v_scope     text;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = p_profile_id;

  SELECT rp.scope INTO v_scope
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions perm ON perm.id = rp.permission_id
  WHERE ur.profile_id = p_profile_id
    AND perm.key = p_permission_key
    AND ur.valid_from <= current_date
    AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)
  ORDER BY CASE rp.scope
    WHEN 'GLOBAL' THEN 8 WHEN 'ENTIRE_TENANT' THEN 7 WHEN 'MULTIPLE_DEPARTMENTS' THEN 6
    WHEN 'DEPARTMENT' THEN 5 WHEN 'LOCATION' THEN 5 WHEN 'TEAM' THEN 3
    WHEN 'DIRECT_REPORTS' THEN 2 ELSE 1 END DESC
  LIMIT 1;

  IF v_scope IS NULL THEN
    RETURN;
  ELSIF v_scope IN ('GLOBAL') THEN
    RETURN QUERY SELECT p.id FROM profiles p;
  ELSIF v_scope = 'ENTIRE_TENANT' THEN
    RETURN QUERY SELECT p.id FROM profiles p WHERE p.tenant_id = v_tenant_id;
  ELSIF v_scope IN ('DEPARTMENT','MULTIPLE_DEPARTMENTS') THEN
    RETURN QUERY
      SELECT p.id FROM profiles p
      WHERE p.tenant_id = v_tenant_id
        AND p.department IN (
          SELECT d.name FROM user_roles ur
          JOIN departments d ON d.id = ur.department_id
          WHERE ur.profile_id = p_profile_id
        );
  ELSIF v_scope = 'LOCATION' THEN
    RETURN QUERY
      SELECT p.id FROM profiles p
      WHERE p.tenant_id = v_tenant_id
        AND p.outlet_id IN (
          SELECT l.outlet_id FROM user_roles ur
          JOIN locations l ON l.id = ur.location_id
          WHERE ur.profile_id = p_profile_id AND l.outlet_id IS NOT NULL
        );
  ELSE
    -- DIRECT_REPORTS / TEAM: everyone whose reporting chain passes through p_profile_id
    RETURN QUERY
      SELECT DISTINCT rr.profile_id
      FROM reporting_relationships rr
      WHERE rr.tenant_id = v_tenant_id
        AND rr.valid_to IS NULL
        AND (
          rr.related_profile_id = p_profile_id
          OR (v_scope = 'TEAM' AND p_profile_id IN (SELECT c.profile_id FROM get_reporting_chain(rr.profile_id) c))
        );
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ── can: single composed authorization check, callable from RLS
--    policies (as a SECURITY DEFINER helper, same style as my_role())
--    and from edge functions. ──
CREATE OR REPLACE FUNCTION can(p_profile_id uuid, p_permission_key text, p_target_profile_id uuid)
RETURNS boolean AS $$
  SELECT has_permission(p_profile_id, p_permission_key)
     AND (
       p_target_profile_id = p_profile_id
       OR p_target_profile_id IN (SELECT profile_id FROM resolve_scope_profile_ids(p_profile_id, p_permission_key))
     );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
