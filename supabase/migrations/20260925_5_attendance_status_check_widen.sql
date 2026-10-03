-- =============================================================
-- attendance_status_check still had the original base-schema list
-- (supabase_migration.sql): Present, Absent, Late, Half Day, Leave. Later
-- features write statuses it never learned about, so those writes were
-- rejected outright:
--   - 'Mispunch'                  -- mark_mispunches() / nightly sweep
--                                    (20260925_2); without this the WHOLE
--                                    nightly sweep aborts, absents included.
--   - 'Comp Off', 'Travel',
--     'Show Visit'                -- Attendance page manual-mark form and
--                                    FULL_PAID_DAY_STATUSES (lib/helpers.js).
-- Widening only -- every row valid before stays valid.
-- =============================================================

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('Present','Absent','Late','Half Day','Leave','Comp Off','Travel','Show Visit','Mispunch'));
