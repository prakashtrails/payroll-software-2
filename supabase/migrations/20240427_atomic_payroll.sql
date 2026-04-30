-- Atomic Payroll & Advance Repayments Migration

-- 1. Create advance_repayments table
CREATE TABLE IF NOT EXISTS advance_repayments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  advance_id      uuid NOT NULL REFERENCES advances(id) ON DELETE CASCADE,
  payslip_id      uuid REFERENCES payslips(id) ON DELETE CASCADE,
  amount          numeric NOT NULL DEFAULT 0,
  month           int NOT NULL,
  year            int NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE advance_repayments ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "repayments: admin sees tenant" 
  ON advance_repayments FOR SELECT 
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "repayments: employee sees own" 
  ON advance_repayments FOR SELECT 
  USING (advance_id IN (SELECT id FROM advances WHERE profile_id = auth.uid()));


-- 2. Atomic Revert Payroll RPC
CREATE OR REPLACE FUNCTION revert_payroll_atomic(p_payroll_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repayment RECORD;
BEGIN
  -- 1. Restore advance balances from repayments
  FOR v_repayment IN 
    SELECT advance_id, amount 
    FROM advance_repayments 
    WHERE payslip_id IN (SELECT id FROM payslips WHERE payroll_id = p_payroll_id)
  LOOP
    UPDATE advances 
    SET 
      paid = paid - v_repayment.amount,
      balance = balance + v_repayment.amount,
      status = 'Active'
    WHERE id = v_repayment.advance_id;
  END LOOP;

  -- 2. Delete repayments (will happen automatically via ON DELETE CASCADE if linked to payslips, 
  -- but we'll be explicit or rely on cascade from payslips)
  
  -- 3. Delete payslips (this will cascade to repayments if linked)
  DELETE FROM payslips WHERE payroll_id = p_payroll_id;

  -- 4. Delete the payroll record
  DELETE FROM payrolls WHERE id = p_payroll_id;
END;
$$;


-- 3. Atomic Process Payroll RPC
-- This is a bit complex to pass all employees/components as JSON, 
-- but it's the only way to ensure atomicity.
CREATE OR REPLACE FUNCTION process_payroll_atomic(
  p_tenant_id uuid,
  p_month int,
  p_year int,
  p_data jsonb -- Array of { profile_id, work_days, total_work_days, gross, deductions, net, breakdown, advances: [{id, amount}] }
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payroll_id uuid;
  v_emp record;
  v_adv record;
  v_payslip_id uuid;
BEGIN
  -- 1. Check if exists
  IF EXISTS (SELECT 1 FROM payrolls WHERE tenant_id = p_tenant_id AND month = p_month AND year = p_year) THEN
    RAISE EXCEPTION 'Payroll for this month is already processed.';
  END IF;

  -- 2. Create payroll record
  INSERT INTO payrolls (tenant_id, month, year, status)
  VALUES (p_tenant_id, p_month, p_year, 'Processed')
  RETURNING id INTO v_payroll_id;

  -- 3. Loop through employees in JSON
  FOR v_emp IN SELECT * FROM jsonb_to_recordset(p_data) AS x(
    profile_id uuid, 
    emp_name text,
    department text,
    designation text,
    ctc numeric,
    work_days numeric, 
    total_work_days int, 
    gross_earnings numeric, 
    total_deductions numeric, 
    advance_deduction numeric,
    net_pay numeric, 
    breakdown jsonb,
    advances jsonb -- [{id, amount}]
  )
  LOOP
    -- Insert Payslip
    INSERT INTO payslips (
      payroll_id, tenant_id, profile_id, emp_name, department, designation, 
      ctc, work_days, total_work_days, gross_earnings, total_deductions, 
      advance_deduction, net_pay, breakdown
    )
    VALUES (
      v_payroll_id, p_tenant_id, v_emp.profile_id, v_emp.emp_name, v_emp.department, v_emp.designation,
      v_emp.ctc, v_emp.work_days, v_emp.total_work_days, v_emp.gross_earnings, v_emp.total_deductions,
      v_emp.advance_deduction, v_emp.net_pay, v_emp.breakdown
    )
    RETURNING id INTO v_payslip_id;

    -- Update Advances and log Repayments
    IF v_emp.advances IS NOT NULL AND jsonb_array_length(v_emp.advances) > 0 THEN
      FOR v_adv IN SELECT * FROM jsonb_to_recordset(v_emp.advances) AS a(id uuid, amount numeric)
      LOOP
        -- Update advance balance
        UPDATE advances 
        SET 
          paid = paid + v_adv.amount,
          balance = balance - v_adv.amount,
          status = CASE WHEN (balance - v_adv.amount) <= 0 THEN 'Completed' ELSE 'Active' END
        WHERE id = v_adv.id;

        -- Log repayment
        INSERT INTO advance_repayments (tenant_id, advance_id, payslip_id, amount, month, year)
        VALUES (p_tenant_id, v_adv.id, v_payslip_id, v_adv.amount, p_month, p_year);
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_payroll_id;
END;
$$;

GRANT EXECUTE ON FUNCTION revert_payroll_atomic(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION process_payroll_atomic(uuid, int, int, jsonb) TO authenticated;
