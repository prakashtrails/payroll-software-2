-- create_workspace / employee_join_workspace both resolve the target user as
-- COALESCE(p_user_id, auth.uid()) to support the (legacy) case where no
-- session exists yet right after signUp. But both are GRANTed to
-- `authenticated`, and neither ever required p_user_id to match the caller's
-- own session when one exists — so any logged-in user could pass a
-- coworker's profile id as p_user_id.
--
-- For create_workspace this was a real account-hijack: the ON CONFLICT DO
-- UPDATE branch would reassign an ALREADY-ONBOARDED victim's profile to a
-- brand-new attacker-named tenant with role='admin', displacing them from
-- their real company. Fixed by (a) binding p_user_id to auth.uid() whenever
-- a session exists, and (b) refusing to touch a profile that already has a
-- tenant_id (only the auth trigger's skeleton {id,email} row may be filled in).
--
-- employee_join_workspace already refused to touch any existing profile row,
-- so it was not exploitable the same way, but we bind p_user_id the same way
-- for consistency/defense-in-depth.

CREATE OR REPLACE FUNCTION create_workspace(
  p_company_name  text,
  p_first_name    text,
  p_last_name     text,
  p_user_id       uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_join_code text;
  v_uid       uuid;
  v_email     text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'p_user_id must match the authenticated caller.';
    END IF;
    v_uid := auth.uid();
  ELSE
    v_uid := p_user_id;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No authenticated user. Pass p_user_id explicitly.';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND tenant_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An account already exists for this user.';
  END IF;

  LOOP
    v_join_code := upper(substring(replace(gen_random_uuid()::text,'-','') FROM 1 FOR 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE upper(join_code) = v_join_code);
  END LOOP;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO tenants (company_name, join_code)
  VALUES (p_company_name, v_join_code)
  RETURNING id INTO v_tenant_id;

  INSERT INTO profiles (id, tenant_id, first_name, last_name, email, role, status)
  VALUES (v_uid, v_tenant_id, p_first_name, p_last_name, COALESCE(v_email,''), 'admin', 'Active')
  ON CONFLICT (id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = 'admin',
    status = 'Active';

  RETURN v_join_code;
END;
$$;

CREATE OR REPLACE FUNCTION employee_join_workspace(
  p_org_code   text,
  p_first_name text,
  p_last_name  text,
  p_user_id    uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_uid       uuid;
  v_email     text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'p_user_id must match the authenticated caller.';
    END IF;
    v_uid := auth.uid();
  ELSE
    v_uid := p_user_id;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No authenticated user. Pass p_user_id explicitly.';
  END IF;

  SELECT id INTO v_tenant_id
  FROM   tenants
  WHERE  upper(join_code) = upper(trim(p_org_code));

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid organization code. Please check with your manager.';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'An account already exists for this email. Please log in instead.';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO profiles (id, tenant_id, first_name, last_name, email, role, status, must_change_password)
  VALUES (v_uid, v_tenant_id, p_first_name, p_last_name, COALESCE(v_email,''), 'employee', 'Active', false);

  RETURN 'ok';
END;
$$;

-- Dead code, unused by the client, GRANTed to `authenticated` with no check
-- that the caller is an admin/manager of p_tenant_id or owns p_user_id —
-- callable directly via supabase.rpc() to plant a fabricated employee
-- profile (arbitrary tenant_id/bank_acc/pan/aadhar) under any user id.
DROP FUNCTION IF EXISTS insert_employee_profile(uuid,uuid,text,text,text,text,text,text,numeric,date,text,text,text,text);
