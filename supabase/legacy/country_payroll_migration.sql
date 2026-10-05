-- Country-based Payroll Separation
-- Run this AFTER supabase_migration.sql

-- 1. Add country_group column to payrolls
ALTER TABLE payrolls
  ADD COLUMN IF NOT EXISTS country_group TEXT NOT NULL DEFAULT 'India'
    CHECK (country_group IN ('India', 'International'));

-- 2. Drop old unique constraint (one payroll per month) and replace with
--    per-group unique constraint (one per month PER country group)
ALTER TABLE payrolls DROP CONSTRAINT IF EXISTS payrolls_tenant_id_month_year_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payrolls_tenant_month_year_group
  ON payrolls(tenant_id, month, year, country_group);

-- 3. Update the performance index to include country_group
DROP INDEX IF EXISTS idx_payrolls_tenant_month;
CREATE INDEX IF NOT EXISTS idx_payrolls_tenant_month
  ON payrolls(tenant_id, month, year, country_group);

-- 4. New atomic payroll RPC that supports country_group
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
      WHERE id = (v_adv->>'id')::uuid;
    END LOOP;
  END LOOP;

  RETURN v_payroll_id;
END;
$$;

GRANT EXECUTE ON FUNCTION process_payroll_by_country(uuid, int, int, text, jsonb) TO authenticated;
