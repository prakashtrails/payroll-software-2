-- Registers Assets and Projects in the per-tenant feature-toggle registry,
-- same idiom as 20260813_9_feature_toggles.sql's seed block. No row in
-- company_feature_toggles yet means both start enabled for every tenant.

INSERT INTO features (key, name, category, description, sort_order) VALUES
  ('assets',   'Assets',   'General', 'Company equipment inventory and assignment tracking.', 97),
  ('projects', 'Projects', 'General', 'Project tracking and task assignment.', 98)
ON CONFLICT (key) DO UPDATE
  SET name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      sort_order = excluded.sort_order;
