-- =========================================================================
-- Delete the 3 test companies only: "CrewCore tester", "CrewCore Testers",
-- "aa". Indwell Hotels (either spelling) is NOT matched by this WHERE
-- clause and will not be touched.
--
-- Run STEP 1 first and check the output — it must show exactly 3 rows,
-- none of them Indwell Hotels — before running STEP 2.
-- =========================================================================

-- ---- STEP 1: preview — confirm this is exactly what you expect ----
SELECT id, company_name, created_at
FROM tenants
WHERE trim(company_name) IN ('CrewCore tester', 'CrewCore Testers', 'aa');

-- ---- STEP 2: only after STEP 1 looks correct, run this ----
-- Cascades to every profile/employee/payroll/leave/etc. row under these
-- 3 tenants only, freeing up their emails (22cd3031@rgipt.ac.in, etc.)
-- for reuse on a new company.
DELETE FROM tenants
WHERE trim(company_name) IN ('CrewCore tester', 'CrewCore Testers', 'aa');
