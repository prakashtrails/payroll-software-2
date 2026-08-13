-- process_payroll_by_country (country_payroll_migration.sql) is SECURITY
-- DEFINER, GRANTed to `authenticated`, and had NO authorization check at
-- all — any logged-in user, including a plain 'employee' account, could call
-- it directly via supabase.rpc() with an arbitrary p_tenant_id to insert
-- fabricated payrolls/payslips, or rewrite any advances row's paid/balance/
-- status by id, for ANY tenant on the platform. Fixed by requiring the
-- caller to be an admin/manager of p_tenant_id, and scoping the advances
-- update to that same tenant so it can't touch another company's records.

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
  END LOOP;

  RETURN v_payroll_id;
END;
$$;
