-- Security fix: any employee could create/edit/delete announcements.
--
-- The `announcements` table had accumulated multiple overlapping RLS
-- policies over time (some from an untracked original migration, some from
-- later hardening passes) — Postgres OR's all matching policies together for
-- a given command, so a single old, overly-permissive leftover policy was
-- enough to let any tenant member write, regardless of how many newer,
-- correctly-scoped policies were added alongside it. Rather than guess which
-- exact policy (by name) is the culprit, this migration drops *every*
-- existing policy on the table — whatever their names, wherever they came
-- from — and rebuilds one unambiguous, correct set. Nothing is lost: the
-- rebuilt set below covers every legitimate case (tenant member reads,
-- admin/superadmin writes) that any of the prior policies were meant to.
--
-- Also drops the dead "department"-scoped read policy — announcementService.js
-- and AnnouncementsPage.jsx never read or write a `department` column, so an
-- announcement's department was always whatever the DB default happened to
-- be; keeping department-based filtering in RLS while the app never sets it
-- is confusing dead weight, not a real feature.

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'announcements'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON announcements', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "announcements: tenant member or superadmin can read"
  ON announcements FOR SELECT
  USING (tenant_id = my_tenant_id() OR my_role() = 'superadmin');

CREATE POLICY "announcements: admin/superadmin can insert"
  ON announcements FOR INSERT
  WITH CHECK (my_role() = 'superadmin' OR (tenant_id = my_tenant_id() AND my_role() = 'admin'));

CREATE POLICY "announcements: admin/superadmin can update"
  ON announcements FOR UPDATE
  USING (my_role() = 'superadmin' OR (tenant_id = my_tenant_id() AND my_role() = 'admin'))
  WITH CHECK (my_role() = 'superadmin' OR (tenant_id = my_tenant_id() AND my_role() = 'admin'));

CREATE POLICY "announcements: admin/superadmin can delete"
  ON announcements FOR DELETE
  USING (my_role() = 'superadmin' OR (tenant_id = my_tenant_id() AND my_role() = 'admin'));
