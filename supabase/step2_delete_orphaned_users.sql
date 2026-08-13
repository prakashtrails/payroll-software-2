-- STEP 2 of 2 — ACTUALLY DELETES. Only run this after Step 1's results
-- looked correct (only the emails you expected — e.g. surajkosliya2004@gmail.com,
-- 22cd3031@rgipt.ac.in — nothing from Indwell Hotels).
--
-- Removes every login account with no company profile, freeing those
-- emails for reuse.
DELETE FROM auth.users
WHERE id IN (
  SELECT au.id
  FROM auth.users au
  LEFT JOIN profiles p ON p.id = au.id
  WHERE p.id IS NULL
);
