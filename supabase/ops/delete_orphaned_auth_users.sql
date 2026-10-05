-- =========================================================================
-- Cleans up login accounts left behind after a tenant delete.
--
-- Deleting a tenant cascades to its profiles, but NOT to the underlying
-- auth.users login row (profiles.id -> auth.users.id is ON DELETE CASCADE
-- only in that direction). So after deleting CrewCore tester / CrewCore
-- Testers / aa, the emails used there (e.g. surajkosliya2004@gmail.com)
-- still exist as login accounts with no company attached to them —
-- which is why Supabase Auth rejects them as "already in use" when you
-- try to reuse the email for a new company's admin.
--
-- This finds every auth.users row that has NO matching profile at all
-- (i.e. truly orphaned — not attached to any company, including the
-- superadmin, whose profile still exists). Run STEP 1 first and check the
-- list only contains emails you expect (the deleted test companies'
-- members) before running STEP 2.
-- =========================================================================

-- ---- STEP 1: preview — these are the orphaned login accounts ----
SELECT au.id, au.email, au.created_at
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE p.id IS NULL
ORDER BY au.created_at DESC;

-- ---- STEP 2: only after STEP 1 looks correct, run this ----
DELETE FROM auth.users
WHERE id IN (
  SELECT au.id
  FROM auth.users au
  LEFT JOIN profiles p ON p.id = au.id
  WHERE p.id IS NULL
);
