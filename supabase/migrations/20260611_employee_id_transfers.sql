-- Employee IDs, outlet location codes, and branch transfer history
-- Adds employee_id / outlet_location to profiles, location_code to tenants,
-- creates employee_transfers audit table, and SECURITY DEFINER RPCs for
-- cross-tenant group operations.

-- 1. Profiles: employee_id (HR-assigned, e.g. "MCMU1042")
--             outlet_location (branch location name, e.g. "Mumbai")
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS outlet_location TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_employee_id
  ON profiles(employee_id)
  WHERE employee_id IS NOT NULL;

-- 2. Tenants: location_code (2-letter branch code, e.g. "MU" for Mumbai)
--    Used to auto-generate new employee IDs on transfer.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS location_code TEXT;

-- 3. Employee transfers — full audit trail for branch moves
CREATE TABLE IF NOT EXISTS employee_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_tenant_id   UUID NOT NULL REFERENCES tenants(id),
  to_tenant_id     UUID NOT NULL REFERENCES tenants(id),
  from_employee_id TEXT,
  to_employee_id   TEXT,
  from_location    TEXT,
  to_location      TEXT,
  transferred_by   UUID REFERENCES profiles(id),
  notes            TEXT,
  transferred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_transfers_profile    ON employee_transfers(profile_id);
CREATE INDEX IF NOT EXISTS idx_emp_transfers_from_tenant ON employee_transfers(from_tenant_id);
CREATE INDEX IF NOT EXISTS idx_emp_transfers_to_tenant   ON employee_transfers(to_tenant_id);

ALTER TABLE employee_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins see transfers involving their tenant"
  ON employee_transfers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE  p.id   = auth.uid()
        AND  p.role IN ('admin', 'superadmin', 'manager')
        AND  (p.tenant_id = from_tenant_id OR p.tenant_id = to_tenant_id)
    )
  );

CREATE POLICY "admins insert transfers from their tenant"
  ON employee_transfers FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE  p.id   = auth.uid()
        AND  p.role IN ('admin', 'superadmin')
        AND  p.tenant_id = from_tenant_id
    )
  );

-- 4. Update fetch_group_dashboard to also return location_code per outlet
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
  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    JOIN   tenants  t ON t.id = p.tenant_id
    WHERE  p.id        = auth.uid()
      AND  p.role      IN ('admin', 'superadmin')
      AND  t.group_code = p_group_code
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT group_name INTO v_group_name FROM tenants WHERE group_code = p_group_code LIMIT 1;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                 t.id,
      'company_name',       t.company_name,
      'location_code',      COALESCE(t.location_code, ''),
      'currency',           COALESCE(t.currency, '₹'),
      'employee_count',     ( SELECT count(*)::int FROM profiles  p WHERE p.tenant_id = t.id AND p.role = 'employee' AND p.status = 'Active' ),
      'present_today',      ( SELECT count(*)::int FROM attendance a WHERE a.tenant_id = t.id AND a.date = CURRENT_DATE AND a.status IN ('Present','Late') ),
      'late_today',         ( SELECT count(*)::int FROM attendance a WHERE a.tenant_id = t.id AND a.date = CURRENT_DATE AND a.status = 'Late' ),
      'absent_today',       ( SELECT count(*)::int FROM attendance a WHERE a.tenant_id = t.id AND a.date = CURRENT_DATE AND a.status = 'Absent' ),
      'payrolls_processed', ( SELECT count(*)::int FROM payrolls   pr WHERE pr.tenant_id = t.id AND pr.status = 'Processed' ),
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

-- 5. fetch_group_employees: all employees across group tenants (cross-tenant, SECURITY DEFINER)
CREATE OR REPLACE FUNCTION fetch_group_employees(p_group_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    JOIN   tenants t ON t.id = p.tenant_id
    WHERE  p.id   = auth.uid()
      AND  p.role IN ('admin', 'superadmin')
      AND  t.group_code = p_group_code
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',              pr.id,
      'first_name',      pr.first_name,
      'last_name',       pr.last_name,
      'email',           pr.email,
      'phone',           pr.phone,
      'department',      pr.department,
      'designation',     pr.designation,
      'employee_id',     pr.employee_id,
      'outlet_location', pr.outlet_location,
      'tenant_id',       pr.tenant_id,
      'company_name',    t.company_name,
      'location_code',   t.location_code,
      'status',          pr.status,
      'ctc',             pr.ctc,
      'join_date',       pr.join_date,
      'role',            pr.role
    )
    ORDER BY t.company_name, pr.first_name
  )
  INTO v_result
  FROM profiles pr
  JOIN tenants t ON t.id = pr.tenant_id
  WHERE t.group_code = p_group_code
    AND pr.role IN ('employee', 'admin', 'manager');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION fetch_group_employees(text) TO authenticated;

-- 6. transfer_employee: atomically move employee between tenants in the same group
CREATE OR REPLACE FUNCTION transfer_employee(
  p_profile_id      uuid,
  p_from_tenant_id  uuid,
  p_to_tenant_id    uuid,
  p_new_employee_id text,
  p_outlet_location text,
  p_notes           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_employee_id text;
  v_old_location    text;
  v_group_code      text;
BEGIN
  SELECT group_code INTO v_group_code FROM tenants WHERE id = p_from_tenant_id;
  IF v_group_code IS NULL THEN
    RAISE EXCEPTION 'Source tenant is not part of any group';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_to_tenant_id AND group_code = v_group_code) THEN
    RAISE EXCEPTION 'Destination tenant is not in the same group';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    JOIN   tenants t ON t.id = p.tenant_id
    WHERE  p.id   = auth.uid()
      AND  p.role IN ('admin', 'superadmin')
      AND  t.group_code = v_group_code
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT employee_id, outlet_location INTO v_old_employee_id, v_old_location
  FROM   profiles
  WHERE  id = p_profile_id AND tenant_id = p_from_tenant_id;

  INSERT INTO employee_transfers (
    profile_id, from_tenant_id, to_tenant_id,
    from_employee_id, to_employee_id,
    from_location, to_location,
    transferred_by, notes
  ) VALUES (
    p_profile_id, p_from_tenant_id, p_to_tenant_id,
    v_old_employee_id, NULLIF(p_new_employee_id, ''),
    v_old_location, p_outlet_location,
    auth.uid(), p_notes
  );

  UPDATE profiles
  SET tenant_id       = p_to_tenant_id,
      employee_id     = NULLIF(p_new_employee_id, ''),
      outlet_location = p_outlet_location
  WHERE id = p_profile_id;

  RETURN jsonb_build_object(
    'success',         true,
    'old_employee_id', v_old_employee_id,
    'new_employee_id', p_new_employee_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_employee(uuid, uuid, uuid, text, text, text) TO authenticated;

-- 7. fetch_employee_transfer_history: transfer audit trail for one employee
CREATE OR REPLACE FUNCTION fetch_employee_transfer_history(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_history jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles caller
    WHERE  caller.id   = auth.uid()
      AND  caller.role IN ('admin', 'superadmin', 'manager')
      AND  (
        caller.tenant_id = (SELECT tenant_id FROM profiles WHERE id = p_profile_id)
        OR caller.tenant_id IN (SELECT from_tenant_id FROM employee_transfers WHERE profile_id = p_profile_id)
        OR caller.tenant_id IN (SELECT to_tenant_id   FROM employee_transfers WHERE profile_id = p_profile_id)
      )
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',               et.id,
      'from_branch',      ft.company_name,
      'to_branch',        tt.company_name,
      'from_employee_id', et.from_employee_id,
      'to_employee_id',   et.to_employee_id,
      'from_location',    et.from_location,
      'to_location',      et.to_location,
      'transferred_by',   COALESCE(tb.first_name || ' ' || tb.last_name, 'System'),
      'notes',            et.notes,
      'transferred_at',   et.transferred_at
    )
    ORDER BY et.transferred_at DESC
  )
  INTO v_history
  FROM employee_transfers et
  JOIN   tenants  ft ON ft.id = et.from_tenant_id
  JOIN   tenants  tt ON tt.id = et.to_tenant_id
  LEFT JOIN profiles tb ON tb.id = et.transferred_by
  WHERE et.profile_id = p_profile_id;

  RETURN COALESCE(v_history, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION fetch_employee_transfer_history(uuid) TO authenticated;
