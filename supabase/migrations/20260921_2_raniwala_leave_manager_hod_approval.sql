-- =============================================================
-- Raniwala-only leave approval routing: reporting-manager + HR/HOD, by
-- leave duration, instead of the tenant-wide self/manager/admin QUOTA system
-- every tenant (including Raniwala, until now) shares for leave_requests.
--
-- Policy:
--   - Leave <= 3 days: the employee's actual reporting manager
--     (profiles.manager_id) approves. No more self-auto-approval for leave
--     requests at Raniwala.
--   - Leave > 3 days: the reporting manager approves FIRST, then HR/HOD
--     approves. Sequential -- HR cannot act until the manager has approved.
--   - An employee with no manager assigned routes straight to HR (edge case
--     -- someone still has to be able to approve it).
--
-- Scope: Raniwala only (WHERE tenants.company_name ILIKE '%Raniwala%'), by
-- explicit user decision -- every other tenant keeps today's exact quota
-- based routing (request_quotas / determineApproverRole / self-manager-admin
-- tiers), completely untouched. All new columns below are nullable and
-- unused by non-Raniwala rows.
--
-- This also closes a real visibility gap the existing design accepted on
-- purpose (see the comment this migration updates in
-- src/services/employeeService.js): today ANY `manager`-role user can see
-- and approve EVERY leave request tenant-wide, not just their own reports'.
-- For Raniwala, "manager" access to leave_requests is now scoped to
-- `manager_id = auth.uid()`. Every other tenant's manager RLS is unchanged.
-- =============================================================

-- ---- New columns (nullable; no-op for every non-Raniwala row) ------------
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS duration_days int,
  ADD COLUMN IF NOT EXISTS requires_hr_approval boolean,
  ADD COLUMN IF NOT EXISTS manager_status text,
  ADD COLUMN IF NOT EXISTS manager_decided_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS manager_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS hr_status text,
  ADD COLUMN IF NOT EXISTS hr_decided_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS hr_decided_at timestamptz;

-- ---- Insert trigger: extend the existing tier function with a Raniwala
-- early branch, ahead of the untouched quota logic every other tenant keeps
-- hitting. ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_leave_request_approval_tier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant       record;
  v_quota        record;
  v_chain_role   text;
  v_self_limit   integer;
  v_tier         text;
  v_is_raniwala  boolean;
  v_manager_id   uuid;
  v_duration     int;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN

    SELECT EXISTS (
      SELECT 1 FROM tenants WHERE id = NEW.tenant_id AND company_name ILIKE '%Raniwala%'
    ) INTO v_is_raniwala;

    IF v_is_raniwala THEN
      v_duration := (NEW.end_date - NEW.start_date) + 1;
      SELECT manager_id INTO v_manager_id FROM profiles WHERE id = NEW.profile_id;

      NEW.duration_days := v_duration;
      NEW.requires_hr_approval := v_duration > 3;
      NEW.manager_id := v_manager_id;
      NEW.status := 'Pending';
      NEW.approved_by := NULL;
      NEW.approval_level := NULL;

      IF v_manager_id IS NULL THEN
        -- No reporting manager assigned -- route straight to HR so the
        -- request can still be actioned by someone.
        NEW.manager_status := 'Not Required';
        NEW.hr_status := 'Pending';
        NEW.requires_hr_approval := true;
        NEW.required_approver_role := 'admin';
      ELSE
        NEW.manager_status := 'Pending';
        NEW.hr_status := CASE WHEN NEW.requires_hr_approval THEN 'Pending' ELSE 'Not Required' END;
        NEW.required_approver_role := 'manager';
      END IF;

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

-- ---- Update trigger: Raniwala's manager -> HR sequential dual approval.
-- No-ops for any row where manager_status IS NULL (every non-Raniwala row,
-- and every row inserted before this migration) -- updateLeaveStatus() in
-- src/services/leaveService.js keeps working exactly as before for those.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_leave_dual_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_role text;
BEGIN
  IF OLD.manager_status IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  IF v_role = 'manager' THEN
    IF OLD.manager_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Not this leave request''s reporting manager';
    END IF;
    IF NEW.manager_status IS DISTINCT FROM OLD.manager_status AND OLD.manager_status <> 'Pending' THEN
      RAISE EXCEPTION 'This request has already been reviewed by its manager';
    END IF;
    -- A manager may only ever move their own manager_status/decided_* --
    -- silently discard any attempt (via a crafted request) to touch the HR
    -- stage instead.
    NEW.hr_status       := OLD.hr_status;
    NEW.hr_decided_by   := OLD.hr_decided_by;
    NEW.hr_decided_at   := OLD.hr_decided_at;
  ELSIF v_role IN ('admin', 'superadmin') THEN
    IF NEW.hr_status IS DISTINCT FROM OLD.hr_status THEN
      IF OLD.manager_status NOT IN ('Approved', 'Not Required') THEN
        RAISE EXCEPTION 'Reporting manager approval is required before HR can act';
      END IF;
      IF OLD.hr_status <> 'Pending' THEN
        RAISE EXCEPTION 'This request has already been reviewed by HR';
      END IF;
    END IF;
    -- HR may only ever move the HR stage -- discard any attempt to also
    -- change the manager's decision through this path.
    NEW.manager_status     := OLD.manager_status;
    NEW.manager_decided_by := OLD.manager_decided_by;
    NEW.manager_decided_at := OLD.manager_decided_at;
  END IF;

  -- Recompute the single derived status/approved_by every other page
  -- (payroll leave ledger, MyLeavesPage, comp-off decrement) already reads.
  IF NEW.manager_status = 'Rejected' THEN
    NEW.status := 'Rejected';
    NEW.approved_by := NEW.manager_decided_by;
  ELSIF NEW.hr_status = 'Rejected' THEN
    NEW.status := 'Rejected';
    NEW.approved_by := NEW.hr_decided_by;
  ELSIF NEW.manager_status IN ('Approved', 'Not Required') AND NEW.hr_status IN ('Approved', 'Not Required') THEN
    NEW.status := 'Approved';
    NEW.approved_by := COALESCE(NEW.hr_decided_by, NEW.manager_decided_by);
  ELSE
    NEW.status := 'Pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_leave_dual_approval ON leave_requests;
CREATE TRIGGER trg_enforce_leave_dual_approval
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_leave_dual_approval();

-- ---- RLS: consolidate the manager-visibility policies ---------------------
-- Drops every existing policy (across both migration eras -- 20260614's
-- original names and 20260810's wrap_functions renames) that grants
-- `manager` role blanket tenant-wide SELECT/UPDATE on leave_requests, and
-- replaces each with one policy: admin/superadmin unchanged (full tenant);
-- manager scoped to their own team ONLY for Raniwala rows, unchanged (full
-- tenant) for every other tenant's manager. Postgres RLS policies OR
-- together, so leaving even one of the old broad policies active would
-- defeat this -- all of them must go.
DROP POLICY IF EXISTS "Admins can view all leaves" ON leave_requests;
DROP POLICY IF EXISTS "leaves: admin sees tenant" ON leave_requests;
DROP POLICY IF EXISTS "Admins can update leave status" ON leave_requests;
DROP POLICY IF EXISTS "leaves: admin can update tenant" ON leave_requests;

CREATE POLICY "leaves: admin sees tenant, manager sees own team" ON leave_requests
  FOR SELECT
  USING (
    tenant_id = (select my_tenant_id()) AND (
      (select my_role()) IN ('admin', 'superadmin')
      OR (
        (select my_role()) = 'manager'
        AND (
          NOT EXISTS (
            SELECT 1 FROM tenants t WHERE t.id = leave_requests.tenant_id AND t.company_name ILIKE '%Raniwala%'
          )
          OR leave_requests.manager_id = (select auth.uid())
        )
      )
    )
  );

CREATE POLICY "leaves: admin updates tenant, manager updates own team" ON leave_requests
  FOR UPDATE
  USING (
    tenant_id = (select my_tenant_id()) AND (
      (select my_role()) IN ('admin', 'superadmin')
      OR (
        (select my_role()) = 'manager'
        AND (
          NOT EXISTS (
            SELECT 1 FROM tenants t WHERE t.id = leave_requests.tenant_id AND t.company_name ILIKE '%Raniwala%'
          )
          OR leave_requests.manager_id = (select auth.uid())
        )
      )
    )
  );
