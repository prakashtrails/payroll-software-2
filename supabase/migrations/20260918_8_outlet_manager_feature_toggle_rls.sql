-- Lets an outlet's `manager` (acting as that outlet's HR) toggle a curated,
-- safety-limited subset of features on/off for their own outlet only, so it
-- reflects immediately in that outlet's employees' portal -- without
-- granting them the full superadmin-only /toggle-services capability.
--
-- Today only superadmin can write to company_feature_toggles
-- (20260813_9_feature_toggles.sql: "company_feature_toggles: superadmin
-- manage"). There's no separate "outlet HR" role in this app -- `manager` is
-- already the outlet-scoped role everywhere else (see
-- src/context/FeatureContext.jsx and src/context/OutletViewContext.jsx,
-- which already treat non-admin/superadmin users as scoped to their own
-- profiles.outlet_id), so this reuses `manager` rather than adding a new
-- role value.
--
-- This is additive (a second policy alongside the existing superadmin one,
-- not a replacement) and enforces the curated allow-list AND the caller's
-- own outlet_id server-side in WITH CHECK -- not just hidden in the UI --
-- so a manager can't toggle payroll or any other feature, or another
-- outlet's rows, by crafting a direct request.
--
-- Allow-listed keys match src/lib/featureRegistry.js's "Performance" and
-- "Hiring" categories, plus `grievances`.

CREATE OR REPLACE FUNCTION outlet_hr_toggleable_feature_keys()
RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'performance_kras', 'performance_one_on_ones', 'performance_feedback',
    'performance_pip', 'performance_reviews',
    'hiring', 'recruitment_pipeline', 'headcount_requests', 'interviews',
    'offer_letters', 'refer',
    'grievances'
  ];
$$;

DROP POLICY IF EXISTS "company_feature_toggles: outlet manager can manage curated features" ON company_feature_toggles;
CREATE POLICY "company_feature_toggles: outlet manager can manage curated features"
  ON company_feature_toggles FOR ALL
  USING (
    my_role() = 'manager'
    AND tenant_id = my_tenant_id()
    AND outlet_id = (SELECT outlet_id FROM profiles WHERE id = auth.uid())
    AND outlet_id IS NOT NULL
    AND feature_key = ANY (outlet_hr_toggleable_feature_keys())
  )
  WITH CHECK (
    my_role() = 'manager'
    AND tenant_id = my_tenant_id()
    AND outlet_id = (SELECT outlet_id FROM profiles WHERE id = auth.uid())
    AND outlet_id IS NOT NULL
    AND feature_key = ANY (outlet_hr_toggleable_feature_keys())
  );
