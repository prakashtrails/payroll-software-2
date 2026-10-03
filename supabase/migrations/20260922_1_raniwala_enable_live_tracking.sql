-- Enables the Live Tracking premium feature for Raniwala tenant-wide.
--
-- Without this, the mobile app's location-access consent prompt
-- (D:\CrewCore\components\LocationConsentGate.tsx) and the background
-- capture task (D:\CrewCore\hooks\useLiveTrackingCapture.ts) both correctly
-- gate on FeatureContext's isEnabled('live_tracking') -- but with the
-- feature off, that gate never opens, so neither the permission prompt nor
-- any capture would ever fire, on either platform, no matter how correct
-- the client code is. Per 20260917_10_live_tracking.sql, this is a
-- PREMIUM feature (features.is_premium = true) that defaults OFF for every
-- tenant absent an explicit toggle row -- Raniwala had none.
--
-- This only turns the feature ON tenant-wide. Actual GPS capture for any
-- one employee still requires an admin to separately flip that employee's
-- own employee_tracking_toggles row via the Live Tracking page (now scoped
-- to the B2B Sales outlet, see LiveTrackingPage.jsx) -- this migration does
-- not enable tracking for anyone by itself, only makes the feature (and
-- therefore the consent prompt) visible.
DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  INSERT INTO company_feature_toggles (tenant_id, outlet_id, feature_key, enabled)
  VALUES (v_tenant, NULL, 'live_tracking', true)
  ON CONFLICT (tenant_id, feature_key) WHERE outlet_id IS NULL
  DO UPDATE SET enabled = true, updated_at = now();
END $$;
