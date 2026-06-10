-- Rename payroll country_group values from India/International to Compliance/Non-Compliance
-- and update the check constraint to match

-- 1. Drop old constraint first (before any data changes)
ALTER TABLE payrolls DROP CONSTRAINT IF EXISTS payrolls_country_group_check;

-- 2. Migrate existing data
UPDATE payrolls SET country_group = 'Compliance'     WHERE country_group = 'India';
UPDATE payrolls SET country_group = 'Non-Compliance' WHERE country_group = 'International';

-- 3. Add new constraint
ALTER TABLE payrolls
  ADD CONSTRAINT payrolls_country_group_check
  CHECK (country_group IN ('Compliance', 'Non-Compliance'));
