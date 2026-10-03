-- =============================================================
-- One-time-per-month late grace, opt-in per outlet.
-- Run this after supabase/migrations/20260914_5_outlet_shift_timing.sql
--
-- outlets.late_grace_minutes: NULL (default) = feature OFF for that outlet.
-- When set (e.g. 90), the first time in a calendar month an employee at that
-- outlet clocks in later than the outlet's late_threshold but within
-- late_grace_minutes of shift_start, the day is still marked 'Present'
-- instead of 'Late' and late_grace_used is set on that attendance row so the
-- allowance isn't reused until next month. Every late arrival after that in
-- the same month is marked 'Late' as normal.
-- =============================================================

ALTER TABLE outlets    ADD COLUMN IF NOT EXISTS late_grace_minutes integer;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_grace_used boolean NOT NULL DEFAULT false;
