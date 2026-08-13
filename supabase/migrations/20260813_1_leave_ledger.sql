-- =============================================================
-- Leave ledger: configurable leave types with accrual/carry-forward/
-- encashment, and an append-only balance ledger (Casual/Sick/Earned/etc).
--
-- Comp Off is intentionally left on its existing `profiles.comp_off_balance`
-- counter + `adjust_comp_off_balance` RPC (20260714_audit_fixes_batch1.sql) —
-- that mechanism already atomically drives the weekly-off settlement flow in
-- compOffService.js/PayrollPage, and rebuilding it on the ledger would be a
-- large, risky rewrite of a working feature for no real gain. This migration
-- only covers the leave types that currently have zero accrual: Casual,
-- Sick, Earned, and any custom types HR adds via LeaveTypesPage.
-- Run after supabase_migration.sql.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS leave_types (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  is_paid                boolean NOT NULL DEFAULT true,
  carry_forward          boolean NOT NULL DEFAULT false,
  max_carry_forward_days numeric NOT NULL DEFAULT 0,
  accrual_frequency      text NOT NULL DEFAULT 'none' CHECK (accrual_frequency IN ('none','monthly','yearly')),
  accrual_days           numeric NOT NULL DEFAULT 0,   -- days credited per accrual period
  annual_quota           numeric NOT NULL DEFAULT 0,   -- used for a one-time 'Allocation' at the start of a leave period
  encashable             boolean NOT NULL DEFAULT false,
  max_continuous_days    numeric,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_leave_types_tenant ON leave_types(tenant_id, is_active);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_types: tenant members can read"
  ON leave_types FOR SELECT
  USING (tenant_id = my_tenant_id());
CREATE POLICY "leave_types: admin can write"
  ON leave_types FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));


-- ── Append-only ledger — balance is always SUM(days), never a stored column.
CREATE TABLE IF NOT EXISTS leave_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES profiles(id)    ON DELETE CASCADE,
  leave_type_id   uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  entry_type      text NOT NULL CHECK (entry_type IN ('Allocation','Accrual','Deduction','Carry Forward','Encashment','Expiry')),
  days            numeric NOT NULL,               -- positive = credit, negative = debit
  effective_date  date NOT NULL DEFAULT CURRENT_DATE,
  leave_request_id uuid REFERENCES leave_requests(id) ON DELETE SET NULL,
  note            text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_balance ON leave_ledger(profile_id, leave_type_id);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_tenant   ON leave_ledger(tenant_id, effective_date);

ALTER TABLE leave_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_ledger: own or admin/manager can select"
  ON leave_ledger FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
-- No INSERT/UPDATE/DELETE policy for any role — every row is written by one
-- of the SECURITY DEFINER RPCs below, which apply their own authorization.
-- This keeps the ledger genuinely append-only and tamper-proof from the client.

-- Balance is always derived, never stored — one row per (profile, leave type).
CREATE OR REPLACE VIEW leave_balances AS
  SELECT tenant_id, profile_id, leave_type_id, SUM(days) AS balance
  FROM leave_ledger
  GROUP BY tenant_id, profile_id, leave_type_id;


-- ── Admin: manual allocation / adjustment (top-ups, corrections) ──────────
CREATE OR REPLACE FUNCTION allocate_leave(
  p_profile_id    uuid,
  p_leave_type_id uuid,
  p_days          numeric,
  p_entry_type    text DEFAULT 'Allocation',
  p_note          text DEFAULT ''
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF p_entry_type NOT IN ('Allocation','Accrual','Carry Forward') THEN
    RAISE EXCEPTION 'Use record_leave_deduction / record_leave_encashment for those entry types';
  END IF;
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = p_profile_id;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_tenant AND role IN ('admin','manager','superadmin')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, note, created_by)
  VALUES (v_tenant, p_profile_id, p_leave_type_id, p_entry_type, p_days, p_note, auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION allocate_leave(uuid, uuid, numeric, text, text) TO authenticated;


-- ── Deduct ledger days when a (non-Comp-Off) leave request is approved.
-- Callable by the approving admin/manager, OR by the employee themselves
-- only for their own self-approved request (required_approver_role='self')
-- — mirrors the auto-approval tier in requestQuotaService/leaveService. ──
CREATE OR REPLACE FUNCTION record_leave_deduction(p_leave_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req    RECORD;
  v_type   uuid;
  v_days   numeric;
BEGIN
  SELECT * INTO v_req FROM leave_requests WHERE id = p_leave_request_id;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF v_req.status <> 'Approved' THEN RAISE EXCEPTION 'Leave request is not Approved'; END IF;
  IF v_req.leave_type = 'Comp Off' THEN RETURN; END IF; -- handled by adjust_comp_off_balance instead

  IF NOT (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_req.tenant_id AND role IN ('admin','manager','superadmin'))
    OR (auth.uid() = v_req.profile_id AND v_req.required_approver_role = 'self')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Idempotent — a second call for the same request is a no-op.
  IF EXISTS (SELECT 1 FROM leave_ledger WHERE leave_request_id = p_leave_request_id) THEN RETURN; END IF;

  SELECT id INTO v_type FROM leave_types WHERE tenant_id = v_req.tenant_id AND name = v_req.leave_type LIMIT 1;
  IF v_type IS NULL THEN RETURN; END IF; -- no matching configured leave type — nothing to ledger

  v_days := (v_req.end_date - v_req.start_date) + 1;

  INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, effective_date, leave_request_id, created_by)
  VALUES (v_req.tenant_id, v_req.profile_id, v_type, 'Deduction', -v_days, v_req.start_date, p_leave_request_id, auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION record_leave_deduction(uuid) TO authenticated;


-- ── Encashment: convert unused balance into a payroll payout ─────────────
CREATE OR REPLACE FUNCTION record_leave_encashment(
  p_profile_id    uuid,
  p_leave_type_id uuid,
  p_days          numeric,
  p_amount        numeric,
  p_month         int,
  p_year          int
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant  uuid;
  v_balance numeric;
  v_type    RECORD;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = p_profile_id;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_tenant AND role IN ('admin','manager','superadmin')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_type FROM leave_types WHERE id = p_leave_type_id AND tenant_id = v_tenant;
  IF v_type IS NULL OR NOT v_type.encashable THEN RAISE EXCEPTION 'This leave type is not encashable'; END IF;

  SELECT COALESCE(SUM(days), 0) INTO v_balance FROM leave_ledger WHERE profile_id = p_profile_id AND leave_type_id = p_leave_type_id;
  IF p_days > v_balance THEN RAISE EXCEPTION 'Cannot encash more than the current balance (%.1f)', v_balance; END IF;

  INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, note, created_by)
  VALUES (v_tenant, p_profile_id, p_leave_type_id, 'Encashment', -p_days, format('%s days encashed', p_days), auth.uid());

  INSERT INTO salary_additions (tenant_id, profile_id, component_name, category, amount, is_recurring, effective_month, effective_year, reason, status, created_by)
  VALUES (v_tenant, p_profile_id, v_type.name || ' Encashment', 'earning', p_amount, false, p_month, p_year, format('%s days encashed', p_days), 'Approved', auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION record_leave_encashment(uuid, uuid, numeric, numeric, int, int) TO authenticated;


-- ── Scheduled accrual (monthly) and carry-forward (yearly) — pg_cron only.
-- Deliberately NOT granted to authenticated/anon: EXECUTE defaults to PUBLIC
-- on function creation in Postgres, so both explicitly REVOKE that before
-- scheduling — these should only ever run as the function owner via cron,
-- never be triggerable by a logged-in user (which could over-credit leave
-- by being called repeatedly). ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION run_monthly_leave_accrual()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lt  RECORD;
  v_emp RECORD;
BEGIN
  FOR v_lt IN SELECT * FROM leave_types WHERE accrual_frequency = 'monthly' AND is_active AND accrual_days > 0 LOOP
    FOR v_emp IN SELECT id FROM profiles WHERE tenant_id = v_lt.tenant_id AND status = 'Active' LOOP
      IF NOT EXISTS (
        SELECT 1 FROM leave_ledger
        WHERE profile_id = v_emp.id AND leave_type_id = v_lt.id AND entry_type = 'Accrual'
          AND date_trunc('month', effective_date) = date_trunc('month', CURRENT_DATE)
      ) THEN
        INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, note)
        VALUES (v_lt.tenant_id, v_emp.id, v_lt.id, 'Accrual', v_lt.accrual_days, 'Monthly accrual');
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION run_monthly_leave_accrual() FROM PUBLIC;

CREATE OR REPLACE FUNCTION run_yearly_leave_carry_forward()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lt  RECORD;
  v_bal RECORD;
  v_carry numeric;
BEGIN
  FOR v_lt IN SELECT * FROM leave_types WHERE carry_forward AND is_active LOOP
    FOR v_bal IN
      SELECT profile_id, SUM(days) AS balance
      FROM leave_ledger
      WHERE leave_type_id = v_lt.id
      GROUP BY profile_id
      HAVING SUM(days) > 0
    LOOP
      IF EXISTS (
        SELECT 1 FROM leave_ledger
        WHERE profile_id = v_bal.profile_id AND leave_type_id = v_lt.id AND entry_type = 'Carry Forward'
          AND date_trunc('year', effective_date) = date_trunc('year', CURRENT_DATE)
      ) THEN
        CONTINUE;
      END IF;

      v_carry := LEAST(v_bal.balance, v_lt.max_carry_forward_days);
      -- Zero out anything above the carry-forward cap (Expiry), then re-credit
      -- the carried amount as a fresh 'Carry Forward' entry for the new period.
      IF v_bal.balance > v_carry THEN
        INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, note)
        VALUES (v_lt.tenant_id, v_bal.profile_id, v_lt.id, 'Expiry', -(v_bal.balance - v_carry), 'Unused balance above carry-forward cap expired');
      END IF;
      IF v_carry > 0 THEN
        INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, note)
        VALUES (v_lt.tenant_id, v_bal.profile_id, v_lt.id, 'Carry Forward', v_carry, 'Carried forward from previous period');
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION run_yearly_leave_carry_forward() FROM PUBLIC;

-- Schedule both jobs. If pg_cron isn't available on this Supabase plan, this
-- section will error harmlessly on its own — the RPCs above still work fine
-- called manually/from a Supabase Edge Function on a schedule instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'leave-monthly-accrual') THEN
    PERFORM cron.unschedule('leave-monthly-accrual');
  END IF;
  PERFORM cron.schedule('leave-monthly-accrual', '0 1 1 * *', 'SELECT run_monthly_leave_accrual();');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'leave-yearly-carry-forward') THEN
    PERFORM cron.unschedule('leave-yearly-carry-forward');
  END IF;
  PERFORM cron.schedule('leave-yearly-carry-forward', '0 2 1 4 *', 'SELECT run_yearly_leave_carry_forward();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (extension may not be available on this plan): %', SQLERRM;
END $$;
