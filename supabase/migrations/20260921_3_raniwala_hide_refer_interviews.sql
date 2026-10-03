-- Raniwala: hide Refer a Candidate and Interviews from employees for now.
-- Both are already-toggleable features (see 20260813_9_feature_toggles.sql —
-- `company_feature_toggles`, no row = enabled by default). This uses that
-- existing mechanism rather than new code — both the mobile app's "More
-- Tools" list (MORE_TOOLS.filter(t => isEnabled(t.featureKey)), see
-- D:\CrewCore\app\more.tsx / app\(tabs)\index.tsx) and the equivalent web
-- pages already read from it. The toggle is tenant-wide by design (no
-- "mobile only" concept exists), so this also hides the web pages for
-- Raniwala — reversible later via Toggle Services if that's ever unwanted.
DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  INSERT INTO company_feature_toggles (tenant_id, outlet_id, feature_key, enabled)
  VALUES
    (v_tenant, NULL, 'refer', false),
    (v_tenant, NULL, 'interviews', false)
  ON CONFLICT (tenant_id, feature_key) WHERE outlet_id IS NULL
  DO UPDATE SET enabled = false, updated_at = now();
END $$;
