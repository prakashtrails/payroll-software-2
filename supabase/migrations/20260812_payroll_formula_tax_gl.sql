-- =============================================================
-- Payroll engine depth: formula-based salary components, India
-- TDS engine (slabs + declarations), one-off pay items, salary
-- withholding, GL journal export, bank payout account number.
-- Run after supabase_migration.sql + 20260607_salary_overtime.sql.
-- =============================================================

-- ── 1. Formula-based salary components ────────────────────────
-- Additive: existing percent_ctc / percent_basic / fixed rows and the JS
-- that reads them keep working unchanged. 'formula' is a new option only.
ALTER TABLE salary_components ADD COLUMN IF NOT EXISTS formula     text NOT NULL DEFAULT '';
ALTER TABLE salary_components ADD COLUMN IF NOT EXISTS depends_on  text[] NOT NULL DEFAULT '{}';

ALTER TABLE salary_components
  DROP CONSTRAINT IF EXISTS salary_components_calc_type_check;
ALTER TABLE salary_components
  ADD CONSTRAINT salary_components_calc_type_check
  CHECK (calc_type IN ('percent_ctc','percent_basic','fixed','formula'));


-- ── 2. Income tax (TDS) engine ─────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_slabs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  regime          text NOT NULL DEFAULT 'New' CHECK (regime IN ('New','Old')),
  financial_year  text NOT NULL,                      -- e.g. '2026-27'
  standard_deduction numeric NOT NULL DEFAULT 75000,
  rebate_threshold   numeric NOT NULL DEFAULT 1200000, -- Sec 87A: taxable income at/under this ⇒ zero tax
  cess_percent       numeric NOT NULL DEFAULT 4,
  slabs           jsonb NOT NULL DEFAULT '[]',         -- [{ "from":0, "to":400000, "rate":0 }, { "from":400000,"to":800000,"rate":5 }, ...]
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, financial_year, regime)
);
CREATE INDEX IF NOT EXISTS idx_tax_slabs_tenant ON tax_slabs(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS tax_declarations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  financial_year         text NOT NULL,
  category               text NOT NULL,                -- '80C' | '80D' | 'HRA' | 'Home Loan Interest' | 'Other'
  sub_category           text NOT NULL DEFAULT '',
  declared_amount        numeric NOT NULL DEFAULT 0,
  proof_submitted_amount numeric,                       -- NULL until proof stage; capped against declared_amount when computing TDS
  proof_url              text NOT NULL DEFAULT '',
  status                 text NOT NULL DEFAULT 'Declared' CHECK (status IN ('Declared','Proof Submitted','Verified','Rejected')),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tax_declarations_profile ON tax_declarations(profile_id, financial_year);
CREATE INDEX IF NOT EXISTS idx_tax_declarations_tenant  ON tax_declarations(tenant_id, financial_year);

ALTER TABLE tax_slabs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_declarations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_slabs: tenant members can read"
  ON tax_slabs FOR SELECT
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tax_slabs: admin can write"
  ON tax_slabs FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "tax_declarations: own or admin/manager can select"
  ON tax_declarations FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "tax_declarations: employee can insert own"
  ON tax_declarations FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND profile_id = auth.uid());
CREATE POLICY "tax_declarations: employee can update own while Declared"
  ON tax_declarations FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "tax_declarations: employee can delete own while Declared"
  ON tax_declarations FOR DELETE
  USING (tenant_id = my_tenant_id() AND profile_id = auth.uid() AND status = 'Declared');


-- ── 3. One-off / recurring pay items (arrears, incentives, retention bonus,
--      gratuity payout, leave encashment) — generalizes the old inline
--      "manual overtime line" into one reusable mechanism processPayroll
--      folds in the same way it already folds `advances`. ──────────────
CREATE TABLE IF NOT EXISTS salary_additions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  component_name   text NOT NULL,                        -- e.g. 'Arrears', 'Retention Bonus', 'Leave Encashment'
  category         text NOT NULL CHECK (category IN ('earning','deduction')),
  amount           numeric NOT NULL DEFAULT 0,
  is_recurring     boolean NOT NULL DEFAULT false,
  effective_month  int NOT NULL CHECK (effective_month BETWEEN 1 AND 12),
  effective_year   int NOT NULL,
  reason           text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Paid','Rejected')),
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_additions_tenant  ON salary_additions(tenant_id, effective_year, effective_month);
CREATE INDEX IF NOT EXISTS idx_salary_additions_profile ON salary_additions(profile_id);

ALTER TABLE salary_additions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salary_additions: own or admin/manager can select"
  ON salary_additions FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "salary_additions: admin/manager can write"
  ON salary_additions FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));


-- ── 4. Salary withholding (hold/release) ───────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_withheld     boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS withheld_reason text    NOT NULL DEFAULT '';
-- Bank payout reuses the existing profiles.bank_acc / bank_name / ifsc_code
-- columns (base schema + 20260803_bank_name_ifsc.sql) — no new column needed.


-- ── 5. Payroll GL export ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_gl_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id     uuid NOT NULL REFERENCES payrolls(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  department     text NOT NULL DEFAULT '',
  entry_side     text NOT NULL CHECK (entry_side IN ('debit','credit')),
  account_name   text NOT NULL,
  amount         numeric NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_gl_entries_payroll ON payroll_gl_entries(payroll_id);
CREATE INDEX IF NOT EXISTS idx_payroll_gl_entries_tenant  ON payroll_gl_entries(tenant_id);

ALTER TABLE payroll_gl_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_gl_entries: admin/manager can select"
  ON payroll_gl_entries FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
-- No INSERT/UPDATE/DELETE policy for regular roles — rows are only ever
-- written by process_payroll_by_country (SECURITY DEFINER), and removed
-- via the payrolls ON DELETE CASCADE when a run is reverted.


-- ── 6. Extend process_payroll_by_country to also post a department-level
--      GL journal (Debit: Salary Expense, Credit: Salary Payable +
--      Deductions Payable) alongside the payslips it already inserts. ──
CREATE OR REPLACE FUNCTION process_payroll_by_country(
  p_tenant_id     uuid,
  p_month         int,
  p_year          int,
  p_country_group text,
  p_data          jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payroll_id uuid;
  v_slip       jsonb;
  v_adv        jsonb;
  v_dept       RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND tenant_id = p_tenant_id
      AND role IN ('admin', 'manager', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO payrolls (tenant_id, month, year, country_group, status)
  VALUES (p_tenant_id, p_month, p_year, p_country_group, 'Processed')
  RETURNING id INTO v_payroll_id;

  FOR v_slip IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    INSERT INTO payslips (
      payroll_id, tenant_id, profile_id,
      emp_name, department, designation,
      ctc, work_days, total_work_days,
      gross_earnings, total_deductions, advance_deduction,
      net_pay, breakdown
    ) VALUES (
      v_payroll_id,
      p_tenant_id,
      (v_slip->>'profile_id')::uuid,
      v_slip->>'emp_name',
      COALESCE(v_slip->>'department', ''),
      COALESCE(v_slip->>'designation', ''),
      (v_slip->>'ctc')::numeric,
      (v_slip->>'work_days')::numeric,
      (v_slip->>'total_work_days')::numeric,
      (v_slip->>'gross_earnings')::numeric,
      (v_slip->>'total_deductions')::numeric,
      (v_slip->>'advance_deduction')::numeric,
      (v_slip->>'net_pay')::numeric,
      v_slip->'breakdown'
    );

    FOR v_adv IN SELECT * FROM jsonb_array_elements(COALESCE(v_slip->'advances', '[]'::jsonb)) LOOP
      UPDATE advances
      SET
        paid    = paid + (v_adv->>'amount')::numeric,
        balance = GREATEST(0, balance - (v_adv->>'amount')::numeric),
        status  = CASE
                    WHEN balance - (v_adv->>'amount')::numeric <= 0 THEN 'Completed'
                    ELSE 'Active'
                  END
      WHERE id = (v_adv->>'id')::uuid AND tenant_id = p_tenant_id;
    END LOOP;

    -- Mark any salary_additions rows this slip paid out as 'Paid' so they
    -- aren't picked up again in a future month's payroll.
    IF v_slip ? 'salary_addition_ids' THEN
      UPDATE salary_additions
      SET status = 'Paid'
      WHERE id IN (SELECT (jsonb_array_elements_text(v_slip->'salary_addition_ids'))::uuid)
        AND tenant_id = p_tenant_id;
    END IF;
  END LOOP;

  -- Department-level GL journal, aggregated straight from the payload
  -- that was just inserted as payslips — one small debit/credit set per
  -- department rather than a full ledger UI.
  FOR v_dept IN
    SELECT
      COALESCE(s->>'department', '(Unassigned)') AS department,
      SUM((s->>'gross_earnings')::numeric)                                    AS gross,
      SUM((s->>'net_pay')::numeric)                                           AS net,
      SUM((s->>'total_deductions')::numeric + (s->>'advance_deduction')::numeric) AS deductions
    FROM jsonb_array_elements(p_data) s
    GROUP BY COALESCE(s->>'department', '(Unassigned)')
  LOOP
    IF v_dept.gross > 0 THEN
      INSERT INTO payroll_gl_entries (payroll_id, tenant_id, department, entry_side, account_name, amount)
      VALUES (v_payroll_id, p_tenant_id, v_dept.department, 'debit', 'Salary Expense', v_dept.gross);
    END IF;
    IF v_dept.net > 0 THEN
      INSERT INTO payroll_gl_entries (payroll_id, tenant_id, department, entry_side, account_name, amount)
      VALUES (v_payroll_id, p_tenant_id, v_dept.department, 'credit', 'Salary Payable', v_dept.net);
    END IF;
    IF v_dept.deductions > 0 THEN
      INSERT INTO payroll_gl_entries (payroll_id, tenant_id, department, entry_side, account_name, amount)
      VALUES (v_payroll_id, p_tenant_id, v_dept.department, 'credit', 'Statutory & Other Deductions Payable', v_dept.deductions);
    END IF;
  END LOOP;

  RETURN v_payroll_id;
END;
$$;

-- payroll_gl_entries cascades away automatically via its payroll_id FK
-- (ON DELETE CASCADE) whenever the existing revert_payroll_atomic RPC
-- deletes the payrolls row — no change needed to that function.
