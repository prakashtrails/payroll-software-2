-- =============================================================
-- Per-outlet shift timing overrides (start/end/late threshold)
-- Run this after supabase/migrations/20260805_outlet_attendance_settings.sql
-- NULL on any of these means "use the tenant-level default"
-- (tenants.shift_start / shift_end / late_threshold), same NULL-fallback
-- convention as the existing outlet geofencing/min-hours overrides.
-- =============================================================

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS shift_start text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS shift_end text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS late_threshold integer;
