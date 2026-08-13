-- =============================================================
-- Fix: ensure announcements/policies tables have all required
-- columns (in case the tables pre-existed without them), then
-- force PostgREST to reload its schema cache.
-- Safe to run multiple times.
-- =============================================================

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id);
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE policies ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS pdf_url text NOT NULL DEFAULT '';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS pdf_name text NOT NULL DEFAULT '';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id);
ALTER TABLE policies ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Force PostgREST (Supabase's API layer) to reload its schema cache
-- so it picks up the new column immediately instead of waiting.
NOTIFY pgrst, 'reload schema';
