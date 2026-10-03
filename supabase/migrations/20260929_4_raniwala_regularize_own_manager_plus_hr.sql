-- =============================================================
-- Raniwala attendance regularization: own manager + HR copy (29 Sep 2026).
--
-- User rule: an employee's regularize request goes to THEIR reporting
-- manager for approval, with HR getting a copy — always, and no one else.
--
--   1. enforce_regularize_request_approval_tier: Raniwala never escalates
--      to the HR-only 'admin' tier after 5 manager approvals in a month;
--      it stays 'manager' (HR can still approve any request).
--   2. trg_team_only_request_notifications: for regularize_attendance, a
--      manager / HOD only gets the notification if they are the requester's
--      own approver = COALESCE(manager_id, hod_id) — the same approver rule
--      as app-punch approval. No other manager, and not the HOD above the
--      manager. HR (admin) copies are untouched. Leave and every other
--      request type keep the existing team-chain rule.
--
-- Other tenants unchanged. Both functions are the live definitions with
-- only the marked changes.
-- =============================================================

CREATE OR REPLACE FUNCTION public.enforce_regularize_request_approval_tier()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tenant     record;
  v_quota      record;
  v_self_limit integer;
  v_tier       text;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    SELECT regularize_auto_approval_enabled, regularize_auto_approval_limit, company_name
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
    ELSIF COALESCE(v_quota.manager_approved_count, 0) < 5
          OR v_tenant.company_name ILIKE '%raniwala%' THEN  -- (1) Raniwala: always the manager
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
$function$;


CREATE OR REPLACE FUNCTION public.trg_team_only_request_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  IF NEW.actor_id IS NULL OR NEW.actor_id = NEW.profile_id
     OR NEW.link_key IS NULL
     OR NEW.link_key NOT IN ('leave_requests', 'regularize_attendance', 'wfh_requests', 'special_requests',
                             'expense_claims', 'travel_requests', 'verification_requests') THEN
    RETURN NEW;
  END IF;

  SELECT p.role INTO v_role
  FROM profiles p JOIN tenants t ON t.id = p.tenant_id
  WHERE p.id = NEW.profile_id AND t.company_name ILIKE '%Raniwala%';

  IF v_role IN ('manager', 'hod') THEN
    IF NEW.link_key = 'verification_requests' THEN
      RETURN NULL;
    END IF;
    -- (2) Regularize: only the requester's own approver (manager, else HOD).
    IF NEW.link_key = 'regularize_attendance' THEN
      IF NEW.profile_id IS DISTINCT FROM
         (SELECT COALESCE(a.manager_id, a.hod_id) FROM profiles a WHERE a.id = NEW.actor_id) THEN
        RETURN NULL;
      END IF;
      RETURN NEW;
    END IF;
    IF NOT is_in_team_of(NEW.actor_id, NEW.profile_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
