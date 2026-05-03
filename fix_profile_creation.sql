-- =============================================================
-- FIX: Robust Idempotent Profile Creation
-- Run this in your Supabase SQL Editor to fix the issue where
-- "Join My Company" results in empty profiles.
-- =============================================================

-- 1. Fix create_workspace (Admin/Company Creation)
CREATE OR REPLACE FUNCTION public.create_workspace(
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
  v_uid       uuid := COALESCE(p_user_id, auth.uid());
  v_email     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No authenticated user. Pass p_user_id explicitly.';
  END IF;

  -- If this user already has a profile AND it's already linked to a tenant,
  -- just return the existing join code.
  SELECT t.join_code INTO v_join_code
  FROM profiles p
  JOIN tenants t ON t.id = p.tenant_id
  WHERE p.id = v_uid;

  IF v_join_code IS NOT NULL THEN
    RETURN v_join_code;
  END IF;

  -- Generate a unique 6-char alphanumeric join code
  LOOP
    v_join_code := upper(substring(replace(gen_random_uuid()::text,'-','') FROM 1 FOR 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE upper(join_code) = v_join_code);
  END LOOP;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Create the tenant
  INSERT INTO tenants (company_name, join_code)
  VALUES (p_company_name, v_join_code)
  RETURNING id INTO v_tenant_id;

  -- Create or Update the profile
  -- Using ON CONFLICT handles cases where a trigger might have already
  -- created a "skeleton" profile when the user was first registered.
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

-- 2. Fix employee_join_workspace (Employee Joining)
CREATE OR REPLACE FUNCTION public.employee_join_workspace(
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
  v_uid       uuid := COALESCE(p_user_id, auth.uid());
  v_email     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No authenticated user. Pass p_user_id explicitly.';
  END IF;

  -- Find the tenant by org code
  SELECT id INTO v_tenant_id
  FROM   tenants
  WHERE  upper(join_code) = upper(trim(p_org_code));

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid organization code. Please check with your manager.';
  END IF;

  -- Check if user is already linked to a DIFFERENT tenant
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND tenant_id IS NOT NULL AND tenant_id != v_tenant_id) THEN
    RAISE EXCEPTION 'This account is already registered with another company.';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Create or Update the profile
  -- Using ON CONFLICT handles cases where a trigger might have already
  -- created a "skeleton" profile when the user was first registered.
  INSERT INTO profiles (id, tenant_id, first_name, last_name, email, role, status)
  VALUES (v_uid, v_tenant_id, p_first_name, p_last_name, COALESCE(v_email,''), 'employee', 'Active')
  ON CONFLICT (id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = 'employee',
    status = 'Active';

  RETURN 'ok';
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.create_workspace(text,text,text,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_join_workspace(text,text,text,uuid) TO anon, authenticated;
