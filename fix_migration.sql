-- ============================================================
-- Fix 1: Create leave_requests table (missing from live DB)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leave_type   text NOT NULL,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  reason       text,
  status       text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by  uuid REFERENCES public.profiles(id),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leave_requests_tenant_idx   ON public.leave_requests(tenant_id);
CREATE INDEX IF NOT EXISTS leave_requests_profile_idx  ON public.leave_requests(profile_id);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx   ON public.leave_requests(status);

-- Enable RLS
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Employees can view own leaves"    ON public.leave_requests;
DROP POLICY IF EXISTS "Employees can insert own leaves"  ON public.leave_requests;
DROP POLICY IF EXISTS "Admins can view all leaves"       ON public.leave_requests;
DROP POLICY IF EXISTS "Admins can update leave status"   ON public.leave_requests;

-- Employees can see their own requests
CREATE POLICY "Employees can view own leaves"
  ON public.leave_requests FOR SELECT
  USING (profile_id = auth.uid());

-- Employees can submit leave requests
CREATE POLICY "Employees can insert own leaves"
  ON public.leave_requests FOR INSERT
  WITH CHECK (profile_id = auth.uid());

-- Admins/managers can view all leaves in their tenant
CREATE POLICY "Admins can view all leaves"
  ON public.leave_requests FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin','manager')
    )
  );

-- Admins/managers can approve/reject
CREATE POLICY "Admins can update leave status"
  ON public.leave_requests FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin','manager')
    )
  );

-- ============================================================
-- Fix 2: Make create_workspace idempotent
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_workspace(
  p_company_name text,
  p_first_name   text,
  p_last_name    text,
  p_user_id      uuid DEFAULT NULL
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

  -- Idempotent: if this user already has a profile+workspace, return their existing join code
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
    SELECT t.join_code INTO v_join_code
    FROM profiles p
    JOIN tenants t ON t.id = p.tenant_id
    WHERE p.id = v_uid;
    IF v_join_code IS NOT NULL THEN
      RETURN v_join_code;
    ELSE
      RAISE EXCEPTION 'An account already exists for this email. Please log in instead.';
    END IF;
  END IF;

  -- Generate a unique 6-char alphanumeric join code
  LOOP
    v_join_code := upper(substring(replace(gen_random_uuid()::text,'-','') FROM 1 FOR 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE upper(join_code) = v_join_code);
  END LOOP;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO tenants (company_name, join_code)
  VALUES (p_company_name, v_join_code)
  RETURNING id INTO v_tenant_id;

  INSERT INTO profiles (id, tenant_id, first_name, last_name, email, role, status)
  VALUES (v_uid, v_tenant_id, p_first_name, p_last_name, COALESCE(v_email,''), 'admin', 'Active');

  RETURN v_join_code;
END;
$$;
