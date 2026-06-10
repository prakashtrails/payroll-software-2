-- Fix payrolls.country_group constraint
-- The old migration added an inline CHECK (country_group IN ('India','International')).
-- PostgreSQL auto-names inline checks as <table>_<column>_check, so it collides with the
-- named constraint from 20260607. This migration safely drops ALL check constraints on
-- country_group (whatever their name) and re-adds the correct one.

-- Step 1: Drop every check constraint that references country_group
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM   pg_constraint
    WHERE  conrelid = 'payrolls'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) LIKE '%country_group%'
  LOOP
    EXECUTE 'ALTER TABLE payrolls DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END;
$$;

-- Step 2: Migrate any rows that still carry the old values
UPDATE payrolls SET country_group = 'Compliance'     WHERE country_group = 'India';
UPDATE payrolls SET country_group = 'Non-Compliance' WHERE country_group = 'International';

-- Step 3: Fix the column default so INSERT without an explicit value works correctly
ALTER TABLE payrolls ALTER COLUMN country_group SET DEFAULT 'Compliance';

-- Step 4: Add the correct named constraint
ALTER TABLE payrolls
  ADD CONSTRAINT payrolls_country_group_check
  CHECK (country_group IN ('Compliance', 'Non-Compliance'));
