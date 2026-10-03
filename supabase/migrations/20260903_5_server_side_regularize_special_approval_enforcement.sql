-- =============================================================
-- Server-side enforcement of the approval tier for regularize_requests and
-- special_requests -- the same gap 20260903_3_server_side_leave_approval_
-- enforcement.sql closed for leave_requests, applied to the other two
-- request types that use the identical client-computes-then-inserts pattern
-- (submitRegularizeRequest / submitSpecialRequest in
-- src/services/attendanceService.js and src/services/specialRequestService.js).
--
-- Same problem: the RLS INSERT policies ("employee_insert_own" on
-- regularize_requests, "employee_insert_special_requests" on
-- special_requests) only check profile_id = auth.uid() -- neither checks
-- `status`. So a stale client (regularize_auto_approval_enabled/
-- special_auto_approval_enabled toggled off in another session that never
-- refetched) or a direct REST call can still insert status='Approved'
-- regardless of the tenant's actual current setting or the employee's real
-- quota usage.
--
-- Fix: BEFORE INSERT triggers, one per table, that re-derive the tier
-- server-side from the tenant's *current* auto-approval settings and the
-- profile's *current* request_quotas row, and overwrite
-- status/required_approver_role/approval_level (and reviewed_by/approved_by)
-- with that authoritative result. Neither submitRegularizeRequest nor
-- submitSpecialRequest consults approval_chains (unlike requestLeave), so
-- these triggers don't either -- pure self/manager/admin quota routing,
-- matching determineApproverRole() exactly. Scoped to
-- auth.uid() = NEW.profile_id only, same as the leave/geofence triggers, so
-- admin-entered rows and service-role writes are untouched.
--
-- NOTE -- scope: this closes the request-row status-spoofing gap, i.e. what
-- listAllRegularizeRequests/listAllSpecialRequests and the approval pages
-- show. For regularize specifically, a self-tier submission also directly
-- applies the attendance change via regularizeAttendance() *before* this
-- row is even inserted (a separate write to the `attendance` table) -- that
-- underlying attendance mutation is a distinct, pre-existing gap this
-- migration does not address and would need its own trigger on `attendance`
-- if it needs closing too.
-- =============================================================

CREATE OR REPLACE FUNCTION enforce_regularize_request_approval_tier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant     record;
  v_quota      record;
  v_self_limit integer;
  v_tier       text;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    SELECT regularize_auto_approval_enabled, regularize_auto_approval_limit
      INTO v_tenant
      FROM tenants WHERE id = NEW.tenant_id;

    SELECT self_approved_count, manager_approved_count
      INTO v_quota
      FROM request_quotas
      WHERE tenant_id = NEW.tenant_id AND profile_id = NEW.profile_id
        AND month = EXTRACT(MONTH FROM now())::smallint
        AND year  = EXTRACT(YEAR  FROM now())::int;

    v_self_limit := CASE WHEN COALESCE(v_tenant.regularize_auto_approval_enabled, true)
                          THEN COALESCE(v_tenant.regularize_auto_approval_limit, 3)
                          ELSE 0 END;

    IF v_self_limit > 0 AND COALESCE(v_quota.self_approved_count, 0) < v_self_limit THEN
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
      NEW.reviewed_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_regularize_request_approval_tier ON regularize_requests;
CREATE TRIGGER trg_enforce_regularize_request_approval_tier
  BEFORE INSERT ON regularize_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_regularize_request_approval_tier();


CREATE OR REPLACE FUNCTION enforce_special_request_approval_tier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant     record;
  v_quota      record;
  v_self_limit integer;
  v_tier       text;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    SELECT special_auto_approval_enabled, special_auto_approval_limit
      INTO v_tenant
      FROM tenants WHERE id = NEW.tenant_id;

    SELECT self_approved_count, manager_approved_count
      INTO v_quota
      FROM request_quotas
      WHERE tenant_id = NEW.tenant_id AND profile_id = NEW.profile_id
        AND month = EXTRACT(MONTH FROM now())::smallint
        AND year  = EXTRACT(YEAR  FROM now())::int;

    v_self_limit := CASE WHEN COALESCE(v_tenant.special_auto_approval_enabled, true)
                          THEN COALESCE(v_tenant.special_auto_approval_limit, 3)
                          ELSE 0 END;

    IF v_self_limit > 0 AND COALESCE(v_quota.self_approved_count, 0) < v_self_limit THEN
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

DROP TRIGGER IF EXISTS trg_enforce_special_request_approval_tier ON special_requests;
CREATE TRIGGER trg_enforce_special_request_approval_tier
  BEFORE INSERT ON special_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_special_request_approval_tier();
