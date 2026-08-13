-- =============================================================
-- Announcements & Policy Roll-outs
-- Run this after supabase_migration.sql (relies on my_tenant_id(), my_role())
-- =============================================================

-- ── announcements (admin-authored, visible to whole tenant) ──────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON announcements(tenant_id, created_at DESC);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcements: tenant members can read"
  ON announcements FOR SELECT
  USING (tenant_id = my_tenant_id());

CREATE POLICY "announcements: admin can insert"
  ON announcements FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "announcements: admin can delete"
  ON announcements FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

-- ── policies (admin-authored policy roll-outs, with an optional PDF) ─────────
CREATE TABLE IF NOT EXISTS policies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  pdf_url     text NOT NULL DEFAULT '',
  pdf_name    text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policies_tenant ON policies(tenant_id, created_at DESC);

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policies: tenant members can read"
  ON policies FOR SELECT
  USING (tenant_id = my_tenant_id());

CREATE POLICY "policies: admin can insert"
  ON policies FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "policies: admin can delete"
  ON policies FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

-- ── Storage bucket for policy PDFs ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('policy-pdfs', 'policy-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Files are stored under a per-tenant folder: policy-pdfs/<tenant_id>/<file>
CREATE POLICY "policy-pdfs: tenant members can read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'policy-pdfs' AND (storage.foldername(name))[1] = my_tenant_id()::text);

CREATE POLICY "policy-pdfs: admin can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'policy-pdfs'
    AND (storage.foldername(name))[1] = my_tenant_id()::text
    AND my_role() IN ('admin','superadmin')
  );

CREATE POLICY "policy-pdfs: admin can delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'policy-pdfs'
    AND (storage.foldername(name))[1] = my_tenant_id()::text
    AND my_role() IN ('admin','superadmin')
  );
