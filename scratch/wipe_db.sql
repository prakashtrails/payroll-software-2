-- =============================================================
-- Final Database Wipe Script (Total Reset)
-- Run this in the Supabase SQL Editor as 'postgres'.
-- =============================================================

-- 1. Clear everything in the correct order
TRUNCATE TABLE 
  punches,
  attendance,
  attendance_audit_log,
  payslips,
  payrolls,
  advances,
  salary_components,
  departments,
  profiles,
  tenants,
  otp_table
CASCADE;

-- 2. Remove all authentication users
DELETE FROM auth.users;

-- IMPORTANT: 
-- After running this, YOU MUST LOG OUT from the app in your browser 
-- to clear the local session before trying to sign up again.
