-- STEP 1 of 2 — PREVIEW ONLY. This does not delete anything.
--
-- Lists every login account (auth.users row) that has no matching company
-- profile at all. These are leftover logins from a deleted tenant —
-- their company/employee record is gone, but Supabase Auth still holds
-- their email as "in use" until this login row is deleted too.
SELECT au.id, au.email, au.created_at
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE p.id IS NULL
ORDER BY au.created_at DESC;
