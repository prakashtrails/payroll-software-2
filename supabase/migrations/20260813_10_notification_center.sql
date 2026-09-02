-- Notification center: in-app bell + full notifications page, plus
-- announcement acknowledgement receipts.
--
-- Note: this project already has a live `notifications` + `push_tokens`
-- schema (referenced by RLS policies in 20260810_rls_wrap_functions.sql,
-- backing the unused supabase/functions/send-notification mobile-push edge
-- function) whose CREATE TABLE isn't tracked in this repo, so its exact
-- columns are unknown. Rather than guess at that schema, this migration adds
-- a fresh, fully-specified table (`app_notifications`) for the web in-app
-- center and leaves the existing mobile-push groundwork untouched.

-- ---- 1. app_notifications ----
CREATE TABLE IF NOT EXISTS app_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link_key    text,
  related_id  uuid,
  is_read     boolean NOT NULL DEFAULT false,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_notifications_profile_created ON app_notifications(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_notifications_profile_unread ON app_notifications(profile_id, is_read);

ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_notifications: user sees own" ON app_notifications;
CREATE POLICY "app_notifications: user sees own"
  ON app_notifications FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "app_notifications: user marks own read" ON app_notifications;
CREATE POLICY "app_notifications: user marks own read"
  ON app_notifications FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- Deliberately not restricted to profile_id = auth.uid() — the whole point is
-- one tenant member (a submitter) creating a notification row for a
-- different member (their approver), and vice versa. Bounded to the caller's
-- own tenant, so the worst case is a bad actor spamming their own coworkers,
-- not a cross-tenant leak — mirrors how this codebase already trusts
-- client-side service functions to write rows they don't "own" (e.g.
-- updateLeaveStatus adjusting another profile's comp_off_balance).
DROP POLICY IF EXISTS "app_notifications: tenant member can insert" ON app_notifications;
CREATE POLICY "app_notifications: tenant member can insert"
  ON app_notifications FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id());

-- ---- 2. announcement_acknowledgements ----
CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id  uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_acks_announcement ON announcement_acknowledgements(announcement_id);

ALTER TABLE announcement_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcement_acks: tenant select" ON announcement_acknowledgements;
CREATE POLICY "announcement_acks: tenant select"
  ON announcement_acknowledgements FOR SELECT
  USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS "announcement_acks: self insert" ON announcement_acknowledgements;
CREATE POLICY "announcement_acks: self insert"
  ON announcement_acknowledgements FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND tenant_id = my_tenant_id());
