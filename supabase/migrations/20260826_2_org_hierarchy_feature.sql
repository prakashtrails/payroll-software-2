-- Registers Org Hierarchy in the per-tenant feature-toggle registry,
-- same idiom as 20260815_6_assets_projects_features.sql's seed block.
-- No row in company_feature_toggles yet means it starts enabled for
-- every tenant.

INSERT INTO features (key, name, category, description, sort_order) VALUES
  ('org_hierarchy', 'Org Hierarchy', 'General', 'Visual reporting-structure tree and manager assignment.', 99)
ON CONFLICT (key) DO UPDATE
  SET name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      sort_order = excluded.sort_order;
