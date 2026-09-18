-- Adds Date of Birth to the HR-managed employee record (profiles), captured
-- by HR/admin at Add/Edit Employee time. Deliberately a separate column from
-- profile_details.date_of_birth (20260812_employee_profile_details.sql),
-- which stays as-is for the employee's own self-service "Welcome" page edit
-- — profiles is the admin-managed table (admin-only RLS), profile_details is
-- self-service (own-row RLS), and DOB now has one canonical HR-set source of
-- truth on profiles while any pre-existing self-set value on profile_details
-- is left untouched as a fallback (see send_birthday_notifications() in
-- 20260918_7_birthday_notifications.sql, which reads profiles first then
-- falls back to profile_details).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_birth date;
