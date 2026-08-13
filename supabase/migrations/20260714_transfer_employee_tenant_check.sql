-- transfer_employee authorized the caller against p_from_tenant_id's group,
-- but its UPDATE never verified that p_profile_id actually belongs to
-- p_from_tenant_id. Any admin of a legitimate multi-outlet group could pass
-- an arbitrary profile id from a totally unrelated company and pull that
-- employee — with their full profile (bank_acc, pan, aadhar, ctc) — into
-- their own tenant. Fix: require the source row to exist under
-- p_from_tenant_id before doing anything, and scope the UPDATE to it.

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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee does not belong to the source tenant';
  END IF;

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
  WHERE id = p_profile_id AND tenant_id = p_from_tenant_id;

  RETURN jsonb_build_object(
    'success',         true,
    'old_employee_id', v_old_employee_id,
    'new_employee_id', p_new_employee_id
  );
END;
$$;
