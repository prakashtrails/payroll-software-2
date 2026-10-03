-- Policy acknowledgements: tracks which employees have read & acknowledged
-- each policy roll-out, and when. Mirrors the announcement_acknowledgements
-- pattern from 20260813_10_notification_center.sql exactly, so it inherits
-- the same already-reviewed RLS shape.

CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_acks_policy ON policy_acknowledgements(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_acks_tenant ON policy_acknowledgements(tenant_id);

ALTER TABLE policy_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_acks: tenant select" ON policy_acknowledgements;
CREATE POLICY "policy_acks: tenant select"
  ON policy_acknowledgements FOR SELECT
  USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS "policy_acks: self insert" ON policy_acknowledgements;
CREATE POLICY "policy_acks: self insert"
  ON policy_acknowledgements FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND tenant_id = my_tenant_id());
