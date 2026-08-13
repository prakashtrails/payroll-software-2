-- Bulk variant of adjust_comp_off_balance so settleWeeklyOffForMonth can credit
-- every employee's comp-off balance in one statement instead of one RPC call
-- per employee. Same authorization (caller must be admin/manager/superadmin)
-- and same atomic GREATEST(0, balance + delta) semantics as the single-row
-- version; out-of-tenant profile_ids are silently skipped rather than erroring,
-- which is the correct behavior for a batch op (no existence-probing via errors).
CREATE OR REPLACE FUNCTION bulk_adjust_comp_off_balance(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role   text;
  v_caller_tenant uuid;
BEGIN
  SELECT role, tenant_id INTO v_caller_role, v_caller_tenant FROM profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin','manager','superadmin') THEN
    RAISE EXCEPTION 'Not authorized to adjust comp-off balances';
  END IF;

  UPDATE profiles p
  SET comp_off_balance = GREATEST(0, COALESCE(p.comp_off_balance, 0) + x.delta)
  FROM jsonb_to_recordset(p_items) AS x(profile_id uuid, delta numeric)
  WHERE p.id = x.profile_id
    AND p.tenant_id = v_caller_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_adjust_comp_off_balance(jsonb) TO authenticated;
