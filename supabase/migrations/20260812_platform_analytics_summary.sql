-- Cross-tenant analytics for the superadmin Master Dashboard. Only tenants/
-- profiles/outlets have a superadmin RLS bypass (20260725_super_admin_platform.sql) —
-- attendance/payrolls/payslips/leave_requests/wfh_requests all still restrict
-- SELECT to tenant_id = my_tenant_id(), which for the superadmin's own session
-- only covers their own home tenant. Rather than widening RLS on those
-- (which would let the superadmin's browser session pull raw payroll/
-- attendance rows for every company), this SECURITY DEFINER function returns
-- one pre-aggregated jsonb blob of counts/sums only — never raw rows.

CREATE OR REPLACE FUNCTION platform_analytics_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result      jsonb;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_month       int  := EXTRACT(MONTH FROM CURRENT_DATE)::int;
  v_year        int  := EXTRACT(YEAR  FROM CURRENT_DATE)::int;
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT jsonb_build_object(
    'companies', jsonb_build_object(
      'total',          (SELECT count(*) FROM tenants),
      'new_this_month', (SELECT count(*) FROM tenants WHERE created_at >= v_month_start)
    ),

    'employees', jsonb_build_object(
      'total',          (SELECT count(*) FROM profiles WHERE role <> 'superadmin'),
      'active',         (SELECT count(*) FROM profiles WHERE role <> 'superadmin' AND status = 'Active'),
      'inactive',       (SELECT count(*) FROM profiles WHERE role <> 'superadmin' AND status = 'Inactive'),
      'new_this_month', (SELECT count(*) FROM profiles WHERE role <> 'superadmin' AND created_at >= v_month_start),
      'by_role', jsonb_build_object(
        'admin',    (SELECT count(*) FROM profiles WHERE role = 'admin'),
        'manager',  (SELECT count(*) FROM profiles WHERE role = 'manager'),
        'employee', (SELECT count(*) FROM profiles WHERE role = 'employee')
      )
    ),

    'attendance_today', jsonb_build_object(
      'present',  (SELECT count(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Present'),
      'absent',   (SELECT count(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Absent'),
      'late',     (SELECT count(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Late'),
      'half_day', (SELECT count(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Half Day'),
      'leave',    (SELECT count(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Leave'),
      'total',    (SELECT count(*) FROM attendance WHERE date = CURRENT_DATE)
    ),

    'payroll_this_month', jsonb_build_object(
      'runs_processed', (
        SELECT count(*) FROM payrolls
        WHERE status = 'Processed' AND month = v_month AND year = v_year
      ),
      'total_net_pay', (
        SELECT COALESCE(sum(ps.net_pay), 0) FROM payslips ps
        JOIN payrolls pr ON pr.id = ps.payroll_id
        WHERE pr.month = v_month AND pr.year = v_year
      )
    ),

    'pending', jsonb_build_object(
      'leave_requests', (SELECT count(*) FROM leave_requests WHERE status = 'Pending'),
      'wfh_requests',   (SELECT count(*) FROM wfh_requests   WHERE status = 'Pending')
    ),

    'top_companies', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT t.id, t.company_name,
               (SELECT count(*) FROM profiles p
                WHERE p.tenant_id = t.id AND p.role <> 'superadmin' AND p.status = 'Active') AS active_employees
        FROM tenants t
        ORDER BY active_employees DESC
        LIMIT 5
      ) x
    ),

    'recent_signups', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT id, company_name, created_at
        FROM tenants
        ORDER BY created_at DESC
        LIMIT 5
      ) x
    ),

    'growth_trend', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('month', month, 'companies_added', companies_added, 'employees_added', employees_added)
          ORDER BY month_start
        ), '[]'::jsonb
      ) FROM (
        SELECT
          to_char(m.month_start, 'YYYY-MM') AS month,
          (SELECT count(*) FROM tenants t
             WHERE t.created_at >= m.month_start AND t.created_at < m.month_start + interval '1 month') AS companies_added,
          (SELECT count(*) FROM profiles p
             WHERE p.role <> 'superadmin'
               AND p.created_at >= m.month_start AND p.created_at < m.month_start + interval '1 month') AS employees_added,
          m.month_start
        FROM generate_series(
          date_trunc('month', CURRENT_DATE) - interval '5 months',
          date_trunc('month', CURRENT_DATE),
          interval '1 month'
        ) AS m(month_start)
      ) x
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION platform_analytics_summary() TO authenticated;

-- The RPC scans attendance by date with no tenant filter; the existing
-- (tenant_id, date) index doesn't serve that, so add a standalone one.
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
