-- =============================================================
-- Expense claims (against an advance or straight reimbursement) and
-- travel requests. Run after supabase_migration.sql +
-- 20260812_payroll_formula_tax_gl.sql (approved claims feed salary_additions).
-- =============================================================

CREATE TABLE IF NOT EXISTS expense_claims (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  advance_id    uuid REFERENCES advances(id) ON DELETE SET NULL,
  total_amount  numeric NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Paid')),
  approved_by   uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_claims_tenant  ON expense_claims(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_profile ON expense_claims(profile_id);

CREATE TABLE IF NOT EXISTS expense_claim_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id     uuid NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  category     text NOT NULL DEFAULT 'Other',
  amount       numeric NOT NULL DEFAULT 0,
  description  text NOT NULL DEFAULT '',
  receipt_path text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_claim_items_claim ON expense_claim_items(claim_id);

ALTER TABLE expense_claims      ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claim_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_claims: own or admin/manager can select"
  ON expense_claims FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "expense_claims: tenant member can insert own"
  ON expense_claims FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND profile_id = auth.uid());
CREATE POLICY "expense_claims: admin/manager can update"
  ON expense_claims FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "expense_claims: owner can delete while pending"
  ON expense_claims FOR DELETE
  USING (profile_id = auth.uid() AND status = 'Pending');

CREATE POLICY "expense_claim_items: select via parent claim"
  ON expense_claim_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM expense_claims c WHERE c.id = expense_claim_items.claim_id AND c.tenant_id = my_tenant_id()
      AND (c.profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin'))
  ));
CREATE POLICY "expense_claim_items: owner can insert while parent pending"
  ON expense_claim_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM expense_claims c WHERE c.id = expense_claim_items.claim_id
      AND c.tenant_id = my_tenant_id() AND c.profile_id = auth.uid() AND c.status = 'Pending'
  ));
CREATE POLICY "expense_claim_items: owner can delete while parent pending"
  ON expense_claim_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM expense_claims c WHERE c.id = expense_claim_items.claim_id
      AND c.profile_id = auth.uid() AND c.status = 'Pending'
  ));

INSERT INTO storage.buckets (id, name, public) VALUES ('expense-receipts', 'expense-receipts', false) ON CONFLICT (id) DO NOTHING;

-- Path convention: {tenant_id}/{profile_id}/{timestamp}-{filename} — same shape as referral-resumes.
CREATE POLICY "expense-receipts: tenant member can upload own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = (select my_tenant_id())::text
    AND (storage.foldername(name))[2] = (select auth.uid())::text
  );
CREATE POLICY "expense-receipts: uploader or admin/manager can read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = (select my_tenant_id())::text
    AND (
      (storage.foldername(name))[2] = (select auth.uid())::text
      OR (select my_role()) IN ('admin','manager','superadmin')
    )
  );

-- On approval, either net the claim against the linked advance's balance, or
-- (no advance linked) push it into salary_additions as a reimbursable earning
-- for the current payroll month — same pattern as leave encashment / F&F.
CREATE OR REPLACE FUNCTION approve_expense_claim(p_claim_id uuid, p_month int, p_year int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_claim RECORD;
BEGIN
  SELECT * INTO v_claim FROM expense_claims WHERE id = p_claim_id;
  IF v_claim IS NULL THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_claim.tenant_id AND role IN ('admin','manager','superadmin')) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF v_claim.status <> 'Pending' THEN RAISE EXCEPTION 'Claim is not Pending'; END IF;

  UPDATE expense_claims SET status = 'Approved', approved_by = auth.uid() WHERE id = p_claim_id;

  IF v_claim.advance_id IS NOT NULL THEN
    UPDATE advances
    SET balance = GREATEST(0, balance - v_claim.total_amount),
        paid    = paid + v_claim.total_amount,
        status  = CASE WHEN balance - v_claim.total_amount <= 0 THEN 'Completed' ELSE 'Active' END
    WHERE id = v_claim.advance_id AND tenant_id = v_claim.tenant_id;
  ELSE
    INSERT INTO salary_additions (tenant_id, profile_id, component_name, category, amount, is_recurring, effective_month, effective_year, reason, status, created_by)
    VALUES (v_claim.tenant_id, v_claim.profile_id, 'Expense Reimbursement', 'earning', v_claim.total_amount, false, p_month, p_year, 'Approved expense claim', 'Approved', auth.uid());
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION approve_expense_claim(uuid, int, int) TO authenticated;


-- ── Travel requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS travel_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purpose         text NOT NULL,
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  estimated_cost  numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by     uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_travel_requests_tenant  ON travel_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_travel_requests_profile ON travel_requests(profile_id);

CREATE TABLE IF NOT EXISTS travel_legs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  travel_request_id uuid NOT NULL REFERENCES travel_requests(id) ON DELETE CASCADE,
  from_city         text NOT NULL,
  to_city           text NOT NULL,
  travel_date       date NOT NULL,
  mode              text NOT NULL DEFAULT 'Flight' CHECK (mode IN ('Flight','Train','Bus','Cab','Own Vehicle','Other')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_travel_legs_request ON travel_legs(travel_request_id);

ALTER TABLE travel_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_legs     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "travel_requests: own or admin/manager can select"
  ON travel_requests FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "travel_requests: tenant member can insert own"
  ON travel_requests FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND profile_id = auth.uid());
CREATE POLICY "travel_requests: admin/manager can update"
  ON travel_requests FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "travel_requests: owner can delete while pending"
  ON travel_requests FOR DELETE
  USING (profile_id = auth.uid() AND status = 'Pending');

CREATE POLICY "travel_legs: select via parent request"
  ON travel_legs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM travel_requests r WHERE r.id = travel_legs.travel_request_id AND r.tenant_id = my_tenant_id()
      AND (r.profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin'))
  ));
CREATE POLICY "travel_legs: owner can insert while parent pending"
  ON travel_legs FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM travel_requests r WHERE r.id = travel_legs.travel_request_id
      AND r.tenant_id = my_tenant_id() AND r.profile_id = auth.uid() AND r.status = 'Pending'
  ));
CREATE POLICY "travel_legs: owner can delete while parent pending"
  ON travel_legs FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM travel_requests r WHERE r.id = travel_legs.travel_request_id
      AND r.profile_id = auth.uid() AND r.status = 'Pending'
  ));
