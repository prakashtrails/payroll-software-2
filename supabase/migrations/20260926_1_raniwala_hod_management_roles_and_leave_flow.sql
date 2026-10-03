-- =============================================================
-- Raniwala: HOD + Management roles, 4-stage leave approval, and
-- team-scoped visibility for managers / HODs (26 Sep 2026).
--
-- Web app and mobile app share this DB, so every rule lives here.
--
--   1. profiles.role gains 'hod' and 'management'. Role changes are now
--      admin/superadmin-only (closes a hole where any manager could
--      rewrite any profile's role, including promoting themselves).
--   2. Hierarchy: Employee -> Manager -> HOD, via profiles.manager_id.
--      An employee's approving MANAGER is the first role='manager'
--      ancestor; their HOD is the first role='hod' ancestor. Employee-role
--      people in between (team leads) are skipped -- only role=manager
--      gets the manager portal.
--   3. Raniwala leave routing, sequential Manager -> HOD -> HR -> Management:
--        <= 3 days : manager only
--        4-5 days  : manager + HOD (HR told of the outcome)
--        >= 6 days : manager + HOD + HR + Management; short_notice flagged
--                    when applied < 15 days ahead (still approvable)
--      A missing stage (no manager / no HOD / no management user) is
--      'Not Required'; HR stands in for a missing HOD on 4-5 day leaves,
--      and approves anything that would otherwise have no approver.
--   4. Stage notifications are sent from the DB (app + web both get them);
--      a short dedupe guard on app_notifications swallows the duplicate
--      that already-installed app builds still send client-side.
--   5. Raniwala managers/HODs only see their own team (all levels below
--      them) in profiles, attendance, requests and leave ledger; Raniwala
--      managers lose payroll/salary/advance access (HR only).
--   6. Birthdays/anniversaries (list_upcoming_celebrations): HR sees all
--      upcoming; manager sees team birthdays; HOD sees team birthdays that
--      fall today; everyone else sees nothing.
--
-- Every other tenant: routing, RLS and celebrations are unchanged (the
-- restrictive policies below pass through for non-Raniwala tenants).
-- =============================================================


-- ── 1. Roles ──────────────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['superadmin','admin','manager','employee','hod','management']));

CREATE OR REPLACE FUNCTION guard_profile_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- auth.uid() is NULL for service-role callers (edge functions, cron).
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND COALESCE(my_role(), '') NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only HR can change a user''s role';
  END IF;
  IF NEW.role = 'superadmin' AND OLD.role IS DISTINCT FROM 'superadmin'
     AND auth.uid() IS NOT NULL AND my_role() <> 'superadmin' THEN
    RAISE EXCEPTION 'Not authorized to assign the superadmin role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_role_change ON profiles;
CREATE TRIGGER trg_guard_profile_role_change
  BEFORE UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_role_change();


-- ── 2. Helpers ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION my_is_raniwala()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.id = auth.uid() AND t.company_name ILIKE '%Raniwala%'
  );
$$;

-- Everyone below the caller in the manager_id tree (any depth, capped).
-- Used as `x = ANY((select my_team_ids())::uuid[])` so it runs once per query.
CREATE OR REPLACE FUNCTION my_team_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE tree(id, depth) AS (
    SELECT p.id, 1 FROM profiles p
    WHERE p.manager_id = auth.uid() AND p.id <> auth.uid()
    UNION
    SELECT p.id, t.depth + 1 FROM profiles p JOIN tree t ON p.manager_id = t.id
    WHERE t.depth < 6 AND p.id <> auth.uid()
  )
  SELECT COALESCE(array_agg(DISTINCT id), '{}'::uuid[]) FROM tree;
$$;

-- Walks up manager_id from an employee: first active role='manager'
-- ancestor (below any HOD) and first active role='hod' ancestor.
CREATE OR REPLACE FUNCTION resolve_leave_approvers(p_profile_id uuid, OUT o_manager uuid, OUT o_hod uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur  uuid;
  v_next uuid;
  v_role text;
  v_status text;
  i int := 0;
BEGIN
  SELECT manager_id INTO v_cur FROM profiles WHERE id = p_profile_id;
  WHILE v_cur IS NOT NULL AND v_cur <> p_profile_id AND i < 8 LOOP
    SELECT role, status, manager_id INTO v_role, v_status, v_next FROM profiles WHERE id = v_cur;
    IF COALESCE(v_status, 'Active') = 'Active' THEN
      IF v_role = 'manager' AND o_manager IS NULL THEN
        o_manager := v_cur;
      ELSIF v_role = 'hod' THEN
        o_hod := v_cur;
        EXIT;
      ELSIF v_role IN ('management', 'admin', 'superadmin') THEN
        EXIT;
      END IF;
    END IF;
    v_cur := v_next;
    i := i + 1;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION tenant_has_active_role(p_tenant_id uuid, p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE tenant_id = p_tenant_id AND role = p_role AND status = 'Active');
$$;

-- First stage still waiting, in approval order. NULL = nothing pending.
CREATE OR REPLACE FUNCTION leave_current_stage(p_manager text, p_hod text, p_hr text, p_management text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_manager = 'Pending' THEN 'manager'
    WHEN COALESCE(p_hod, 'Not Required') = 'Pending' THEN 'hod'
    WHEN p_hr = 'Pending' THEN 'hr'
    WHEN COALESCE(p_management, 'Not Required') = 'Pending' THEN 'management'
  END;
$$;


-- ── 3. Leave columns ──────────────────────────────────────────────────────
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS hod_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS hod_status text,
  ADD COLUMN IF NOT EXISTS hod_decided_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS hod_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS management_status text,
  ADD COLUMN IF NOT EXISTS management_decided_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS management_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS short_notice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_stage text;


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


-- ── 3b. Stage decisions. Each role may only move its own stage, only when
-- it's that stage's turn. decided_by/at are stamped here, not trusted from
-- the client. Rows with manager_status NULL (non-Raniwala) pass through. ───
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

    IF v_role = 'manager' AND v_want_mgr IS DISTINCT FROM OLD.manager_status THEN
      IF OLD.manager_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Not this leave request''s reporting manager';
      END IF;
      IF v_stage IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'This request has already been reviewed by its manager';
      END IF;
      IF v_want_mgr NOT IN ('Approved', 'Rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
      NEW.manager_status := v_want_mgr; NEW.manager_decided_by := v_uid; NEW.manager_decided_at := now();

    ELSIF v_role = 'hod' AND v_want_hod IS DISTINCT FROM OLD.hod_status THEN
      IF OLD.hod_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Not this leave request''s HOD';
      END IF;
      IF v_stage IS DISTINCT FROM 'hod' THEN
        RAISE EXCEPTION 'It''s not the HOD''s turn to review this request';
      END IF;
      IF v_want_hod NOT IN ('Approved', 'Rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
      NEW.hod_status := v_want_hod; NEW.hod_decided_by := v_uid; NEW.hod_decided_at := now();

    ELSIF v_role IN ('admin', 'superadmin') AND v_want_hr IS DISTINCT FROM OLD.hr_status THEN
      IF v_stage IS DISTINCT FROM 'hr' THEN
        RAISE EXCEPTION 'Manager/HOD approval is required before HR can act';
      END IF;
      IF v_want_hr NOT IN ('Approved', 'Rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
      NEW.hr_status := v_want_hr; NEW.hr_decided_by := v_uid; NEW.hr_decided_at := now();

    ELSIF v_role = 'management' AND v_want_mgmt IS DISTINCT FROM OLD.management_status THEN
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


-- ── 4. Stage notifications (DB-side, so app + web both get them) ──────────
CREATE OR REPLACE FUNCTION leave_stage_recipients(p_row leave_requests, p_stage text)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_stage
    WHEN 'manager' THEN ARRAY[p_row.manager_id]
    WHEN 'hod'     THEN ARRAY[p_row.hod_id]
    WHEN 'hr' THEN (SELECT COALESCE(array_agg(id), '{}') FROM profiles
                    WHERE tenant_id = p_row.tenant_id AND role = 'admin' AND status = 'Active')
    WHEN 'management' THEN (SELECT COALESCE(array_agg(id), '{}') FROM profiles
                    WHERE tenant_id = p_row.tenant_id AND role = 'management' AND status = 'Active')
    ELSE '{}'::uuid[]
  END;
$$;

CREATE OR REPLACE FUNCTION trg_notify_leave_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name   text;
  v_desc   text;
  v_new_stage text := leave_current_stage(NEW.manager_status, NEW.hod_status, NEW.hr_status, NEW.management_status);
  v_old_stage text;
  v_ids    uuid[];
  v_actor  uuid := COALESCE(auth.uid(), NEW.profile_id);
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
  END IF;

  -- Whoever's turn it now is.
  IF NEW.status = 'Pending' AND v_new_stage IS NOT NULL
     AND (TG_OP = 'INSERT' OR v_new_stage IS DISTINCT FROM v_old_stage) THEN
    v_ids := leave_stage_recipients(NEW, v_new_stage);
    INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
    SELECT NEW.tenant_id, r, v_actor, 'leave_request_submitted',
           CASE WHEN TG_OP = 'INSERT' THEN 'New leave request' ELSE 'Leave request needs your approval' END,
           v_name || ' — ' || v_desc
             || CASE WHEN TG_OP = 'UPDATE' THEN '. Approved by '
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

DROP TRIGGER IF EXISTS trg_notify_leave_stage ON leave_requests;
CREATE TRIGGER trg_notify_leave_stage
  AFTER INSERT OR UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION trg_notify_leave_stage();

-- Installed app builds still insert their own "new leave request" row right
-- after the DB one above. Drop an identical leave notification to the same
-- person for the same request within 10 minutes.
CREATE OR REPLACE FUNCTION trg_dedupe_leave_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.related_id IS NOT NULL AND NEW.type LIKE 'leave_request%' AND EXISTS (
    SELECT 1 FROM app_notifications
    WHERE profile_id = NEW.profile_id AND related_id = NEW.related_id AND type = NEW.type
      AND created_at > now() - interval '10 minutes'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dedupe_leave_notification ON app_notifications;
CREATE TRIGGER trg_dedupe_leave_notification
  BEFORE INSERT ON app_notifications
  FOR EACH ROW EXECUTE FUNCTION trg_dedupe_leave_notification();


-- ── 5a. leave_requests visibility ─────────────────────────────────────────
DROP POLICY IF EXISTS "leaves: admin sees tenant, manager sees own team" ON leave_requests;
DROP POLICY IF EXISTS "leaves: admin updates tenant, manager updates own team" ON leave_requests;

CREATE POLICY "leaves: admin sees tenant, manager/hod see own team" ON leave_requests
  FOR SELECT USING (
    tenant_id = (select my_tenant_id()) AND (
      (select my_role()) IN ('admin', 'superadmin')
      OR ((select my_role()) = 'manager' AND (
            NOT (select my_is_raniwala())
            OR manager_id = (select auth.uid())
            OR profile_id = ANY ((select my_team_ids())::uuid[])))
      OR ((select my_role()) = 'hod' AND (
            hod_id = (select auth.uid())
            OR profile_id = ANY ((select my_team_ids())::uuid[])))
      OR ((select my_role()) = 'management' AND (select my_is_raniwala()))
    )
  );

-- Stage enforcement is in enforce_leave_dual_approval; this only limits
-- which rows each role can attempt to update.
CREATE POLICY "leaves: admin updates tenant, approvers update own stage" ON leave_requests
  FOR UPDATE USING (
    tenant_id = (select my_tenant_id()) AND (
      (select my_role()) IN ('admin', 'superadmin')
      OR ((select my_role()) = 'manager' AND (NOT (select my_is_raniwala()) OR manager_id = (select auth.uid())))
      OR ((select my_role()) = 'hod' AND hod_id = (select auth.uid()))
      OR ((select my_role()) = 'management' AND (select my_is_raniwala()))
    )
  );


-- ── 5b. Raniwala manager/HOD team scope on per-employee tables ────────────
-- RESTRICTIVE policies AND with every existing permissive one, so the
-- tenant-wide manager grants stay as they are for other tenants but are cut
-- down to self + team for Raniwala managers/HODs.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('profiles', 'id'),
    ('attendance', 'profile_id'),
    ('attendance_audit_log', 'profile_id'),
    ('regularize_requests', 'profile_id'),
    ('wfh_requests', 'profile_id'),
    ('special_requests', 'profile_id'),
    ('leave_ledger', 'profile_id'),
    ('profile_details', 'profile_id')
  ) AS t(tbl, col)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || ': raniwala team scope', r.tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL
      USING (
        NOT ((select my_role()) IN ('manager', 'hod') AND (select my_is_raniwala()))
        OR %I = (select auth.uid())
        OR %I = ANY ((select my_team_ids())::uuid[])
      )
      WITH CHECK (
        NOT ((select my_role()) IN ('manager', 'hod') AND (select my_is_raniwala()))
        OR %I = (select auth.uid())
        OR %I = ANY ((select my_team_ids())::uuid[])
      )$f$, r.tbl || ': raniwala team scope', r.tbl, r.col, r.col, r.col, r.col);
  END LOOP;
END $$;

-- HODs get read access to their team (the generic policies only name
-- admin/manager), plus approve rights on single-stage request types.
DROP POLICY IF EXISTS "profiles: hod sees team" ON profiles;
CREATE POLICY "profiles: hod sees team" ON profiles FOR SELECT
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND id = ANY ((select my_team_ids())::uuid[]));

DROP POLICY IF EXISTS "attendance: hod sees team" ON attendance;
CREATE POLICY "attendance: hod sees team" ON attendance FOR SELECT
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND profile_id = ANY ((select my_team_ids())::uuid[]));

DROP POLICY IF EXISTS "leave_ledger: hod sees team" ON leave_ledger;
CREATE POLICY "leave_ledger: hod sees team" ON leave_ledger FOR SELECT
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND profile_id = ANY ((select my_team_ids())::uuid[]));

DROP POLICY IF EXISTS "regularize_requests: hod sees team" ON regularize_requests;
CREATE POLICY "regularize_requests: hod sees team" ON regularize_requests FOR SELECT
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND profile_id = ANY ((select my_team_ids())::uuid[]));
DROP POLICY IF EXISTS "regularize_requests: hod updates team" ON regularize_requests;
CREATE POLICY "regularize_requests: hod updates team" ON regularize_requests FOR UPDATE
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND profile_id = ANY ((select my_team_ids())::uuid[]));

DROP POLICY IF EXISTS "wfh_requests: hod sees team" ON wfh_requests;
CREATE POLICY "wfh_requests: hod sees team" ON wfh_requests FOR SELECT
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND profile_id = ANY ((select my_team_ids())::uuid[]));
DROP POLICY IF EXISTS "wfh_requests: hod updates team" ON wfh_requests;
CREATE POLICY "wfh_requests: hod updates team" ON wfh_requests FOR UPDATE
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND profile_id = ANY ((select my_team_ids())::uuid[]));

DROP POLICY IF EXISTS "special_requests: hod sees team" ON special_requests;
CREATE POLICY "special_requests: hod sees team" ON special_requests FOR SELECT
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND profile_id = ANY ((select my_team_ids())::uuid[]));
DROP POLICY IF EXISTS "special_requests: hod updates team" ON special_requests;
CREATE POLICY "special_requests: hod updates team" ON special_requests FOR UPDATE
  USING ((select my_role()) = 'hod' AND tenant_id = (select my_tenant_id()) AND profile_id = ANY ((select my_team_ids())::uuid[]));


-- ── 5c. Payroll is HR-only at Raniwala ────────────────────────────────────
-- Own payslips/advances/additions stay visible (profile_id = self).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('payslips', 'profile_id'),
    ('advances', 'profile_id'),
    ('salary_additions', 'profile_id'),
    ('payrolls', NULL),
    ('salary_components', NULL),
    ('payroll_gl_entries', NULL)
  ) AS t(tbl, col)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || ': raniwala hr only', r.tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL
      USING (NOT ((select my_role()) = 'manager' AND (select my_is_raniwala()))%s)
      WITH CHECK (NOT ((select my_role()) = 'manager' AND (select my_is_raniwala())))$f$,
      r.tbl || ': raniwala hr only', r.tbl,
      CASE WHEN r.col IS NULL THEN '' ELSE format(' OR %I = (select auth.uid())', r.col) END);
  END LOOP;
END $$;

-- Company settings: Raniwala managers can no longer edit the tenant row.
DROP POLICY IF EXISTS "tenant: raniwala hr only update" ON tenants;
CREATE POLICY "tenant: raniwala hr only update" ON tenants AS RESTRICTIVE FOR UPDATE
  USING (NOT ((select my_role()) = 'manager' AND (select my_is_raniwala())));


-- ── 6. Birthdays / anniversaries ──────────────────────────────────────────
-- Raniwala: HR all upcoming; manager team birthdays (upcoming); HOD team
-- birthdays today only; everyone else nothing. Other tenants unchanged.
CREATE OR REPLACE FUNCTION list_upcoming_celebrations(p_days integer DEFAULT 5)
RETURNS TABLE(kind text, profile_id uuid, first_name text, middle_name text, last_name text, division text, outlet_location text, event_date date, next_date date, days_away integer, years integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_tenant uuid := my_tenant_id();
  v_role text := my_role();
  v_outlet uuid;
  v_days int := LEAST(GREATEST(COALESCE(p_days, 5), 0), 366);
  v_raniwala boolean := my_is_raniwala();
  v_team uuid[];
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  IF v_raniwala THEN
    IF v_role IN ('employee', 'management') OR v_role IS NULL THEN
      RETURN;
    ELSIF v_role IN ('manager', 'hod') THEN
      v_team := my_team_ids();
      IF v_role = 'hod' THEN
        v_days := 0;
      END IF;
    END IF;
  END IF;

  SELECT p.outlet_id INTO v_outlet FROM profiles p WHERE p.id = auth.uid();

  RETURN QUERY
  WITH scoped AS (
    SELECT p.id, p.first_name, p.middle_name, p.last_name, p.division, p.outlet_location,
           COALESCE(p.date_of_birth, pd.date_of_birth) AS dob,
           p.join_date
    FROM profiles p
    LEFT JOIN profile_details pd ON pd.profile_id = p.id
    WHERE p.tenant_id = v_tenant
      AND p.status = 'Active'
      AND (
        CASE WHEN v_team IS NOT NULL THEN p.id = ANY (v_team)
             WHEN v_raniwala THEN true
             ELSE (v_role IN ('admin', 'manager', 'superadmin') OR p.outlet_id IS NOT DISTINCT FROM v_outlet)
        END
      )
  ),
  events AS (
    SELECT 'birthday'::text AS kind, s.*, s.dob AS event_date FROM scoped s WHERE s.dob IS NOT NULL
    UNION ALL
    SELECT 'anniversary'::text, s.*, s.join_date FROM scoped s
    WHERE s.join_date IS NOT NULL AND v_team IS NULL
  ),
  nexts AS (
    SELECT e.*,
           CASE
             WHEN (e.event_date + make_interval(years => EXTRACT(YEAR FROM v_today)::int - EXTRACT(YEAR FROM e.event_date)::int))::date >= v_today
               THEN (e.event_date + make_interval(years => EXTRACT(YEAR FROM v_today)::int - EXTRACT(YEAR FROM e.event_date)::int))::date
             ELSE (e.event_date + make_interval(years => EXTRACT(YEAR FROM v_today)::int + 1 - EXTRACT(YEAR FROM e.event_date)::int))::date
           END AS next_date
    FROM events e
  )
  SELECT n.kind, n.id, n.first_name, n.middle_name, n.last_name, n.division, n.outlet_location,
         n.event_date, n.next_date,
         (n.next_date - v_today)::int,
         (EXTRACT(YEAR FROM n.next_date) - EXTRACT(YEAR FROM n.event_date))::int
  FROM nexts n
  WHERE n.next_date - v_today <= v_days
    AND (n.kind = 'birthday' OR EXTRACT(YEAR FROM n.next_date) > EXTRACT(YEAR FROM n.event_date))
  ORDER BY n.next_date, n.first_name;
END;
$function$;
