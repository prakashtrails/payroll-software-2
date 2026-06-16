-- Multi-outlet / branch grouping for tenants
-- Admins who own multiple outlets set the same group_code on each tenant.
-- A SECURITY DEFINER RPC then aggregates stats across all tenants in the group.

-- 1. Add group columns to tenants (nullable — NULL means standalone)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS group_code TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS group_name TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_group_code ON tenants(group_code) WHERE group_code IS NOT NULL;

-- 2. Cross-tenant aggregate stats RPC.
--    SECURITY DEFINER runs as the function owner (postgres), bypassing RLS.
--    Authorization is enforced manually: caller must be admin/superadmin
--    in at least one tenant that belongs to the requested group.
CREATE OR REPLACE FUNCTION fetch_group_dashboard(p_group_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_name text;
  v_outlets    jsonb;
BEGIN
  -- Security: verify caller is admin/superadmin in a tenant that owns this group_code
  IF NOT EXISTS (
    SELECT 1
    FROM   profiles p
    JOIN   tenants  t ON t.id = p.tenant_id
    WHERE  p.id         = auth.uid()
      AND  p.role       IN ('admin', 'superadmin')
      AND  t.group_code  = p_group_code
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT group_name INTO v_group_name
  FROM   tenants
  WHERE  group_code = p_group_code
  LIMIT  1;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                 t.id,
      'company_name',       t.company_name,
      'currency',           COALESCE(t.currency, '₹'),
      'employee_count',     ( SELECT count(*)::int  FROM profiles  p WHERE p.tenant_id = t.id AND p.role = 'employee' AND p.status = 'Active' ),
      'present_today',      ( SELECT count(*)::int  FROM attendance a WHERE a.tenant_id = t.id AND a.date = CURRENT_DATE AND a.status IN ('Present','Late') ),
      'late_today',         ( SELECT count(*)::int  FROM attendance a WHERE a.tenant_id = t.id AND a.date = CURRENT_DATE AND a.status = 'Late' ),
      'absent_today',       ( SELECT count(*)::int  FROM attendance a WHERE a.tenant_id = t.id AND a.date = CURRENT_DATE AND a.status = 'Absent' ),
      'payrolls_processed', ( SELECT count(*)::int  FROM payrolls   pr WHERE pr.tenant_id = t.id AND pr.status = 'Processed' ),
      'last_payroll',       (
        SELECT to_char(to_date(pr.month::text, 'MM'), 'Mon') || ' ' || pr.year
        FROM   payrolls pr
        WHERE  pr.tenant_id = t.id AND pr.status = 'Processed'
        ORDER  BY pr.year DESC, pr.month DESC
        LIMIT  1
      ),
      'pending_leaves',     ( SELECT count(*)::int     FROM leave_requests lr WHERE lr.tenant_id = t.id AND lr.status = 'Pending' ),
      'advances_balance',   ( SELECT COALESCE(sum(a.balance), 0)::numeric FROM advances a WHERE a.tenant_id = t.id AND a.status = 'Active' )
    )
    ORDER BY t.company_name
  )
  INTO v_outlets
  FROM tenants t
  WHERE t.group_code = p_group_code;

  RETURN jsonb_build_object(
    'group_code', p_group_code,
    'group_name', COALESCE(v_group_name, 'My Group'),
    'outlets',    COALESCE(v_outlets, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fetch_group_dashboard(text) TO authenticated;
