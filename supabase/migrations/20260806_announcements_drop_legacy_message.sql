-- The announcements table carries a legacy `message` column (NOT NULL, no
-- default) from before this feature was rewritten to use `title` + `body`.
-- announcementService.js / AnnouncementsPage.jsx never set it, so every
-- insert failed with:
--   null value in column "message" of relation "announcements" violates
--   not-null constraint
--
-- Backfill any existing rows from body (belt and suspenders — the app never
-- actually wrote real announcements before this fix, since inserts always
-- failed), then drop the NOT NULL constraint so unrelated future inserts
-- can't be broken by an application-level column no code writes to.

UPDATE announcements SET message = body WHERE message IS NULL;

ALTER TABLE announcements ALTER COLUMN message DROP NOT NULL;
ALTER TABLE announcements ALTER COLUMN message SET DEFAULT '';

NOTIFY pgrst, 'reload schema';
