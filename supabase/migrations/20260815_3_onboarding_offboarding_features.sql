-- Registers Onboarding and Offboarding in the per-tenant feature-toggle
-- registry, same idiom as 20260813_9_feature_toggles.sql's seed block.
-- No row in company_feature_toggles yet means both start enabled for every
-- existing tenant.

INSERT INTO features (key, name, category, description, sort_order) VALUES
  ('onboarding',  'Onboarding',  'General', 'New-hire onboarding checklists and tracking.', 95),
  ('offboarding', 'Offboarding', 'General', 'Employee exit checklists and tracking.', 96)
ON CONFLICT (key) DO UPDATE
  SET name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      sort_order = excluded.sort_order;
