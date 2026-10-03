-- =============================================================
-- Server-side enforcement of the leave-request approval tier.
--
-- Problem: requestLeave() (src/services/leaveService.js) decides client-side
-- whether a leave request is self-approved (status: 'Approved',
-- required_approver_role: 'self') based on the tenant's
-- leave_auto_approval_enabled/limit and the employee's current-month
-- self_approved_count, then just inserts that payload as-is. The RLS INSERT
-- policies on leave_requests ("Employees can insert own leaves" / "leaves:
-- employee can insert own") only check profile_id = auth.uid() and tenant
-- match -- neither checks `status`. So nothing in the database stops an
-- employee's own leave_requests insert from carrying status='Approved'
-- regardless of what the tenant's auto-approval setting actually is right
-- now:
--   - a browser tab/session that fetched `tenant` before a superadmin
--     toggled leave_auto_approval_enabled off still computes tier='self'
--     from its stale in-memory copy and inserts a self-approved row, even
--     though the setting is correctly off in the database by the time the
--     insert lands
--   - a request made directly against the REST API (bypassing the app
--     entirely) can just set status: 'Approved' outright, no matter the
--     employee's real quota or the tenant's setting
--
-- Confirmed in the field: an `employee`-role user's own leave request came
-- back status='Approved' with no approver, despite the tenant having
-- leave_auto_approval_enabled turned off.
--
-- This mirrors the exact gap 20260827_1_server_side_geofence_enforcement.sql
-- closed for clock-in: the app's decision was correct, but only the app
-- enforced it.
--
-- Fix: a BEFORE INSERT trigger that re-derives the tier server-side from the
-- tenant's *current* leave_auto_approval_enabled/limit, the profile's
-- *current* request_quotas row, and any active approval_chains override --
-- the same inputs requestLeave()/determineApproverRole() use -- and
-- overwrites status/required_approver_role/approval_level/approved_by with
-- that authoritative result, discarding whatever the client claimed. Only
-- applies when an employee inserts their own row (auth.uid() = NEW.profile_id)
-- -- admin-entered/imported/service-role writes are untouched, same scoping
-- as the geofence trigger.
-- =============================================================

CREATE OR REPLACE FUNCTION enforce_leave_request_approval_tier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant     record;
  v_quota      record;
  v_chain_role text;
  v_self_limit integer;
  v_tier       text;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    SELECT leave_auto_approval_enabled, leave_auto_approval_limit
      INTO v_tenant
      FROM tenants WHERE id = NEW.tenant_id;

    SELECT self_approved_count, manager_approved_count
      INTO v_quota
      FROM request_quotas
      WHERE tenant_id = NEW.tenant_id AND profile_id = NEW.profile_id
        AND month = EXTRACT(MONTH FROM now())::smallint
        AND year  = EXTRACT(YEAR  FROM now())::int;

    -- Same override as getFirstApproverRole(): an active chain's first step
    -- wins over self/manager/admin quota routing entirely.
    SELECT step ->> 'role'
      INTO v_chain_role
      FROM approval_chains ac,
           LATERAL jsonb_array_elements(ac.steps) AS step
      WHERE ac.tenant_id = NEW.tenant_id AND ac.entity_type = 'leave_requests' AND ac.is_active = true
      ORDER BY (step ->> 'order')::int
      LIMIT 1;

    v_self_limit := CASE WHEN COALESCE(v_tenant.leave_auto_approval_enabled, true)
                          THEN COALESCE(v_tenant.leave_auto_approval_limit, 3)
                          ELSE 0 END;

    IF v_chain_role IS NOT NULL THEN
      v_tier := v_chain_role;
    ELSIF v_self_limit > 0 AND COALESCE(v_quota.self_approved_count, 0) < v_self_limit THEN
      v_tier := 'self';
    ELSIF COALESCE(v_quota.manager_approved_count, 0) < 5 THEN
      v_tier := 'manager';
    ELSE
      v_tier := 'admin';
    END IF;

    NEW.required_approver_role := v_tier;
    IF v_tier = 'self' THEN
      NEW.status := 'Approved';
      NEW.approval_level := 'self';
    ELSE
      NEW.status := 'Pending';
      NEW.approval_level := NULL;
      NEW.approved_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_leave_request_approval_tier ON leave_requests;
CREATE TRIGGER trg_enforce_leave_request_approval_tier
  BEFORE INSERT ON leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_leave_request_approval_tier();
