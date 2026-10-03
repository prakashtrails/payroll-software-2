-- =============================================================
-- Raniwala leave approvals: decide by person, not by role (26 Sep 2026).
--
-- Bug: RAJUL JAIN's leave (submitted 25 Sep, before the 4-stage flow and
-- before HR's HOD sheet gave ARZOO JAIMINY the 'hod' role) had ARZOO as its
-- manager-stage approver. The stage trigger only let a role='manager' user
-- move manager_status, so once ARZOO became an HOD nobody could act on it.
--
--   1. The Manager / HOD stages are decided by whoever is assigned to them
--      (leave_requests.manager_id / hod_id), whatever their current role --
--      so a role change never strands a request, and an HOD who is also
--      someone's direct manager can act on it from the HOD portal. HR and
--      Management stages stay role-based.
--   2. Routing moved into raniwala_leave_route() so the insert trigger and
--      the one-off re-route below use the exact same rules.
--   3. Pending Raniwala leaves from before 20260926_1 (current_stage NULL,
--      nothing decided yet) are re-routed with today's rules.
-- =============================================================


-- ── 1. Shared routing rules ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION raniwala_leave_route(
  p_profile_id uuid, p_tenant_id uuid, p_start date, p_end date, p_applied_on date,
  OUT o_manager uuid, OUT o_hod uuid, OUT o_duration int,
  OUT o_manager_status text, OUT o_hod_status text, OUT o_hr_status text, OUT o_management_status text,
  OUT o_short_notice boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  o_duration := (p_end - p_start) + 1;
  SELECT r.o_manager, r.o_hod INTO o_manager, o_hod FROM resolve_leave_approvers(p_profile_id) r;

  o_manager_status := CASE WHEN o_manager IS NULL THEN 'Not Required' ELSE 'Pending' END;
  o_management_status := 'Not Required';
  o_short_notice := false;

  IF o_duration <= 3 THEN
    -- Manager alone; the HOD steps in only when there's no manager.
    o_hod_status := CASE WHEN o_manager IS NULL AND o_hod IS NOT NULL THEN 'Pending' ELSE 'Not Required' END;
    o_hr_status  := CASE WHEN o_manager IS NULL AND o_hod IS NULL THEN 'Pending' ELSE 'Not Required' END;
  ELSIF o_duration <= 5 THEN
    -- No HOD: HR stands in for the HOD.
    o_hod_status := CASE WHEN o_hod IS NULL THEN 'Not Required' ELSE 'Pending' END;
    o_hr_status  := CASE WHEN o_hod IS NULL THEN 'Pending' ELSE 'Not Required' END;
  ELSE
    o_hod_status := CASE WHEN o_hod IS NULL THEN 'Not Required' ELSE 'Pending' END;
    o_hr_status  := 'Pending';
    o_management_status := CASE WHEN tenant_has_active_role(p_tenant_id, 'management') THEN 'Pending' ELSE 'Not Required' END;
    o_short_notice := p_start - p_applied_on < 15;
  END IF;
END;
$$;


-- ── 2. Insert trigger uses it (non-Raniwala branch unchanged) ─────────────
CREATE OR REPLACE FUNCTION enforce_leave_request_approval_tier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant       record;
  v_quota        record;
  v_chain_role   text;
  v_self_limit   integer;
  v_tier         text;
  v_is_raniwala  boolean;
  v_route        record;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN

    SELECT EXISTS (
      SELECT 1 FROM tenants WHERE id = NEW.tenant_id AND company_name ILIKE '%Raniwala%'
    ) INTO v_is_raniwala;

    IF v_is_raniwala THEN
      SELECT * INTO v_route FROM raniwala_leave_route(
        NEW.profile_id, NEW.tenant_id, NEW.start_date, NEW.end_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);

      NEW.duration_days := v_route.o_duration;
      NEW.manager_id := v_route.o_manager;
      NEW.hod_id := v_route.o_hod;
      NEW.status := 'Pending';
      NEW.approved_by := NULL;
      NEW.approval_level := NULL;
      NEW.manager_status := v_route.o_manager_status;
      NEW.hod_status := v_route.o_hod_status;
      NEW.hr_status := v_route.o_hr_status;
      NEW.management_status := v_route.o_management_status;
      NEW.short_notice := v_route.o_short_notice;
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


-- ── 3. Stage decisions by person for Manager / HOD ────────────────────────
CREATE OR REPLACE FUNCTION enforce_leave_dual_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_role  text;
  v_uid   uuid := auth.uid();
  v_stage text;
  v_want_mgr  text := NEW.manager_status;
  v_want_hod  text := NEW.hod_status;
  v_want_hr   text := NEW.hr_status;
  v_want_mgmt text := NEW.management_status;
BEGIN
  IF OLD.manager_status IS NULL THEN
    RETURN NEW;
  END IF;

  v_stage := leave_current_stage(OLD.manager_status, OLD.hod_status, OLD.hr_status, OLD.management_status);

  IF v_uid IS NOT NULL THEN
    v_role := my_role();

    -- Start from the stored stage state; re-apply only the caller's stage.
    NEW.manager_status := OLD.manager_status; NEW.manager_decided_by := OLD.manager_decided_by; NEW.manager_decided_at := OLD.manager_decided_at;
    NEW.hod_status := OLD.hod_status;         NEW.hod_decided_by := OLD.hod_decided_by;         NEW.hod_decided_at := OLD.hod_decided_at;
    NEW.hr_status := OLD.hr_status;           NEW.hr_decided_by := OLD.hr_decided_by;           NEW.hr_decided_at := OLD.hr_decided_at;
    NEW.management_status := OLD.management_status; NEW.management_decided_by := OLD.management_decided_by; NEW.management_decided_at := OLD.management_decided_at;
    NEW.hod_id := OLD.hod_id; NEW.manager_id := OLD.manager_id;
    NEW.duration_days := OLD.duration_days; NEW.short_notice := OLD.short_notice;
    NEW.requires_hr_approval := OLD.requires_hr_approval;

    IF v_want_mgr IS DISTINCT FROM OLD.manager_status THEN
      IF OLD.manager_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Not this leave request''s reporting manager';
      END IF;
      IF v_stage IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'This request has already been reviewed by its manager';
      END IF;
      IF v_want_mgr NOT IN ('Approved', 'Rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
      NEW.manager_status := v_want_mgr; NEW.manager_decided_by := v_uid; NEW.manager_decided_at := now();

    ELSIF v_want_hod IS DISTINCT FROM OLD.hod_status THEN
      IF OLD.hod_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Not this leave request''s HOD';
      END IF;
      IF v_stage IS DISTINCT FROM 'hod' THEN
        RAISE EXCEPTION 'It''s not the HOD''s turn to review this request';
      END IF;
      IF v_want_hod NOT IN ('Approved', 'Rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
      NEW.hod_status := v_want_hod; NEW.hod_decided_by := v_uid; NEW.hod_decided_at := now();

    ELSIF v_want_hr IS DISTINCT FROM OLD.hr_status THEN
      IF v_role NOT IN ('admin', 'superadmin') THEN
        RAISE EXCEPTION 'Only HR can decide the HR stage';
      END IF;
      IF v_stage IS DISTINCT FROM 'hr' THEN
        RAISE EXCEPTION 'Manager/HOD approval is required before HR can act';
      END IF;
      IF v_want_hr NOT IN ('Approved', 'Rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
      NEW.hr_status := v_want_hr; NEW.hr_decided_by := v_uid; NEW.hr_decided_at := now();

    ELSIF v_want_mgmt IS DISTINCT FROM OLD.management_status THEN
      IF v_role <> 'management' THEN
        RAISE EXCEPTION 'Only Management can decide the Management stage';
      END IF;
      IF v_stage IS DISTINCT FROM 'management' THEN
        RAISE EXCEPTION 'Manager/HOD/HR approval is required before Management can act';
      END IF;
      IF v_want_mgmt NOT IN ('Approved', 'Rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
      NEW.management_status := v_want_mgmt; NEW.management_decided_by := v_uid; NEW.management_decided_at := now();
    END IF;
  END IF;

  -- Derive the single status every other page (payroll, ledger, apps) reads.
  IF NEW.manager_status = 'Rejected' THEN
    NEW.status := 'Rejected'; NEW.approved_by := NEW.manager_decided_by;
  ELSIF NEW.hod_status = 'Rejected' THEN
    NEW.status := 'Rejected'; NEW.approved_by := NEW.hod_decided_by;
  ELSIF NEW.hr_status = 'Rejected' THEN
    NEW.status := 'Rejected'; NEW.approved_by := NEW.hr_decided_by;
  ELSIF NEW.management_status = 'Rejected' THEN
    NEW.status := 'Rejected'; NEW.approved_by := NEW.management_decided_by;
  ELSIF leave_current_stage(NEW.manager_status, NEW.hod_status, NEW.hr_status, NEW.management_status) IS NULL THEN
    NEW.status := 'Approved';
    NEW.approved_by := COALESCE(NEW.management_decided_by, NEW.hr_decided_by, NEW.hod_decided_by, NEW.manager_decided_by);
  ELSE
    NEW.status := 'Pending';
  END IF;

  NEW.current_stage := CASE WHEN NEW.status = 'Pending'
    THEN leave_current_stage(NEW.manager_status, NEW.hod_status, NEW.hr_status, NEW.management_status) END;
  NEW.required_approver_role := CASE WHEN NEW.current_stage = 'hr' THEN 'admin'
    ELSE COALESCE(NEW.current_stage, NEW.required_approver_role) END;

  RETURN NEW;
END;
$$;


-- ── 4. RLS: an assigned approver can see and act on their row ─────────────
DROP POLICY IF EXISTS "leaves: admin sees tenant, manager/hod see own team" ON leave_requests;
CREATE POLICY "leaves: admin sees tenant, manager/hod see own team" ON leave_requests
  FOR SELECT USING (
    tenant_id = (select my_tenant_id()) AND (
      (select my_role()) IN ('admin', 'superadmin')
      OR manager_id = (select auth.uid())
      OR hod_id = (select auth.uid())
      OR ((select my_role()) = 'manager' AND (
            NOT (select my_is_raniwala())
            OR profile_id = ANY ((select my_team_ids())::uuid[])))
      OR ((select my_role()) = 'hod' AND profile_id = ANY ((select my_team_ids())::uuid[]))
      OR ((select my_role()) = 'management' AND (select my_is_raniwala()))
    )
  );

DROP POLICY IF EXISTS "leaves: admin updates tenant, approvers update own stage" ON leave_requests;
CREATE POLICY "leaves: admin updates tenant, approvers update own stage" ON leave_requests
  FOR UPDATE USING (
    tenant_id = (select my_tenant_id()) AND (
      (select my_role()) IN ('admin', 'superadmin')
      OR manager_id = (select auth.uid())
      OR hod_id = (select auth.uid())
      OR ((select my_role()) = 'manager' AND NOT (select my_is_raniwala()))
      OR ((select my_role()) = 'management' AND (select my_is_raniwala()))
    )
  );


-- ── 5. A re-routed pre-flow request is announced as new, not as
-- "Approved by Manager" (it wasn't). Otherwise as in 20260926_1. ──────────
CREATE OR REPLACE FUNCTION trg_notify_leave_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name   text;
  v_desc   text;
  v_new_stage text := leave_current_stage(NEW.manager_status, NEW.hod_status, NEW.hr_status, NEW.management_status);
  v_old_stage text;
  v_ids    uuid[];
  v_actor  uuid := COALESCE(auth.uid(), NEW.profile_id);
  v_fresh  boolean := TG_OP = 'INSERT'; -- new request, or a pre-flow one just re-routed
BEGIN
  IF NEW.manager_status IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT trim(concat_ws(' ', first_name, last_name))
         || CASE WHEN COALESCE(outlet_location, '') <> '' THEN ' (' || outlet_location || ')' ELSE '' END
    INTO v_name FROM profiles WHERE id = NEW.profile_id;

  v_desc := COALESCE(NEW.leave_type, 'Leave') || ', ' || to_char(NEW.start_date, 'DD Mon') || ' – '
            || to_char(NEW.end_date, 'DD Mon') || ' (' || COALESCE(NEW.duration_days, NEW.end_date - NEW.start_date + 1) || ' day'
            || CASE WHEN COALESCE(NEW.duration_days, 2) = 1 THEN '' ELSE 's' END || ')'
            || CASE WHEN NEW.short_notice THEN ' — applied less than 15 days in advance' ELSE '' END;

  IF TG_OP = 'UPDATE' THEN
    v_old_stage := leave_current_stage(OLD.manager_status, OLD.hod_status, OLD.hr_status, OLD.management_status);
    v_fresh := OLD.status = 'Pending' AND OLD.current_stage IS NULL;
  END IF;

  -- Whoever's turn it now is.
  IF NEW.status = 'Pending' AND v_new_stage IS NOT NULL
     AND (v_fresh OR v_new_stage IS DISTINCT FROM v_old_stage) THEN
    v_ids := leave_stage_recipients(NEW, v_new_stage);
    INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
    SELECT NEW.tenant_id, r, v_actor, 'leave_request_submitted',
           CASE WHEN v_fresh THEN 'New leave request' ELSE 'Leave request needs your approval' END,
           v_name || ' — ' || v_desc
             || CASE WHEN NOT v_fresh THEN '. Approved by '
                  || CASE v_old_stage WHEN 'manager' THEN 'Manager' WHEN 'hod' THEN 'HOD' WHEN 'hr' THEN 'HR' ELSE 'previous approver' END
                  || ', now needs yours.' ELSE '.' END,
           'leave_requests', NEW.id
    FROM unnest(v_ids) r WHERE r IS NOT NULL AND r <> NEW.profile_id;
  END IF;

  -- Final outcome FYIs: HOD for their team's leaves they didn't sign;
  -- HR for 4-5 day leaves that never needed HR's own approval.
  IF TG_OP = 'UPDATE' AND NEW.status IN ('Approved', 'Rejected') AND OLD.status = 'Pending' THEN
    IF NEW.hod_id IS NOT NULL AND COALESCE(NEW.hod_status, 'Not Required') = 'Not Required' THEN
      INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
      VALUES (NEW.tenant_id, NEW.hod_id, v_actor, 'leave_request_fyi',
              'Team leave ' || lower(NEW.status), v_name || ' — ' || v_desc || '.', 'leave_requests', NEW.id);
    END IF;
    IF COALESCE(NEW.duration_days, 0) >= 4 AND NEW.hr_status = 'Not Required' THEN
      INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
      SELECT NEW.tenant_id, r, v_actor, 'leave_request_fyi', 'Leave ' || lower(NEW.status),
             v_name || ' — ' || v_desc || '.', 'leave_requests', NEW.id
      FROM unnest(leave_stage_recipients(NEW, 'hr')) r;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ── 6. Re-route stranded pre-flow requests ────────────────────────────────
-- Only rows nobody has decided anything on yet. Runs without auth.uid(), so
-- enforce_leave_dual_approval just recomputes status/current_stage, and
-- trg_notify_leave_stage tells the new approver.
UPDATE leave_requests lr
SET manager_id = x.o_manager,
    hod_id = x.o_hod,
    duration_days = x.o_duration,
    manager_status = x.o_manager_status,
    hod_status = x.o_hod_status,
    hr_status = x.o_hr_status,
    management_status = x.o_management_status,
    short_notice = x.o_short_notice,
    requires_hr_approval = x.o_hr_status = 'Pending'
FROM (
  SELECT l.id, r.*
  FROM leave_requests l
  JOIN tenants t ON t.id = l.tenant_id AND t.company_name ILIKE '%Raniwala%'
  CROSS JOIN LATERAL raniwala_leave_route(l.profile_id, l.tenant_id, l.start_date, l.end_date,
                                          (l.created_at AT TIME ZONE 'Asia/Kolkata')::date) r
  WHERE l.status = 'Pending'
    AND l.current_stage IS NULL
    AND l.manager_status IS NOT NULL
    AND l.manager_decided_by IS NULL AND l.hr_decided_by IS NULL
) x
WHERE lr.id = x.id;
