-- =============================================================
-- Per-outlet Attendance & Geofencing overrides
-- Run this after supabase/migrations/20260725_super_admin_platform.sql (needs outlets)
-- NULL on any of these means "use the tenant-level default" (tenants.geofence_*,
-- tenants.min_half_day_hours / min_full_day_hours).
-- =============================================================

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS geofence_lat numeric;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS geofence_lng numeric;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS geofence_radius integer;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS min_half_day_hours numeric;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS min_full_day_hours numeric;
