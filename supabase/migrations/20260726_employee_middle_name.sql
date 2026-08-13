-- Some employees have a middle name that first/last name alone can't capture.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS middle_name text NOT NULL DEFAULT '';

-- fetch_group_employees returns an explicit column list (not SELECT *), so it
-- needs to be redefined to surface the new column to the group dashboard.
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
      'middle_name',     pr.middle_name,
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
