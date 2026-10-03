-- =============================================================
-- Fix for 20260926_1: the insert-routing trigger runs as the employee,
-- whose RLS only shows their own profiles row, so its "is there an
-- active Management user?" check always came back false and >=6-day
-- leaves skipped the Management stage. The check now goes through a
-- SECURITY DEFINER helper. (20260926_1 was also updated in place so a
-- fresh setup gets the corrected version directly.)
-- =============================================================

CREATE OR REPLACE FUNCTION tenant_has_active_role(p_tenant_id uuid, p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE tenant_id = p_tenant_id AND role = p_role AND status = 'Active');
$$;

-- ── 3a. Insert routing (non-Raniwala branch verbatim from 20260921_2) ─────
CREATE OR REPLACE FUNCTION enforce_leave_request_approval_tier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant       record;
  v_quota        record;
  v_chain_role   text;
  v_self_limit   integer;
  v_tier         text;
  v_is_raniwala  boolean;
  v_mgr          uuid;
  v_hod          uuid;
  v_has_mgmt     boolean;
  v_duration     int;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN

    SELECT EXISTS (
      SELECT 1 FROM tenants WHERE id = NEW.tenant_id AND company_name ILIKE '%Raniwala%'
    ) INTO v_is_raniwala;

    IF v_is_raniwala THEN
      v_duration := (NEW.end_date - NEW.start_date) + 1;
      SELECT o_manager, o_hod INTO v_mgr, v_hod FROM resolve_leave_approvers(NEW.profile_id);
      -- Via a SECURITY DEFINER helper: this trigger runs as the employee,
      -- who can only see their own profiles row.
      v_has_mgmt := tenant_has_active_role(NEW.tenant_id, 'management');

      NEW.duration_days := v_duration;
      NEW.manager_id := v_mgr;
      NEW.hod_id := v_hod;
      NEW.status := 'Pending';
      NEW.approved_by := NULL;
      NEW.approval_level := NULL;
      NEW.short_notice := false;
      NEW.manager_status := CASE WHEN v_mgr IS NULL THEN 'Not Required' ELSE 'Pending' END;
      NEW.management_status := 'Not Required';

      IF v_duration <= 3 THEN
        -- Manager alone; the HOD steps in only when there's no manager.
        NEW.hod_status := CASE WHEN v_mgr IS NULL AND v_hod IS NOT NULL THEN 'Pending' ELSE 'Not Required' END;
        NEW.hr_status  := CASE WHEN v_mgr IS NULL AND v_hod IS NULL THEN 'Pending' ELSE 'Not Required' END;
      ELSIF v_duration <= 5 THEN
        -- No HOD above this employee (yet): HR stands in for the HOD, which
        -- is also exactly today's manager + HR behaviour.
        NEW.hod_status := CASE WHEN v_hod IS NULL THEN 'Not Required' ELSE 'Pending' END;
        NEW.hr_status  := CASE WHEN v_hod IS NULL THEN 'Pending' ELSE 'Not Required' END;
      ELSE
        NEW.hod_status := CASE WHEN v_hod IS NULL THEN 'Not Required' ELSE 'Pending' END;
        NEW.hr_status  := 'Pending';
        NEW.management_status := CASE WHEN v_has_mgmt THEN 'Pending' ELSE 'Not Required' END;
        NEW.short_notice := NEW.start_date - (now() AT TIME ZONE 'Asia/Kolkata')::date < 15;
      END IF;

      NEW.requires_hr_approval := NEW.hr_status = 'Pending';
      NEW.current_stage := leave_current_stage(NEW.manager_status, NEW.hod_status, NEW.hr_status, NEW.management_status);
      NEW.required_approver_role := CASE WHEN NEW.current_stage = 'hr' THEN 'admin' ELSE NEW.current_stage END;
      RETURN NEW;
    END IF;

    -- ---- Every other tenant: existing quota-based routing, unchanged ----
    SELECT leave_auto_approval_enabled, leave_auto_approval_limit
      INTO v_tenant
      FROM tenants WHERE id = NEW.tenant_id;

    SELECT self_approved_count, manager_approved_count
      INTO v_quota
      FROM request_quotas
      WHERE tenant_id = NEW.tenant_id AND profile_id = NEW.profile_id
        AND month = EXTRACT(MONTH FROM now())::smallint
        AND year  = EXTRACT(YEAR  FROM now())::int;

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


