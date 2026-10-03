-- Let each tenant configure MULTIPLE weekly off days instead of a single day,
-- so HR can define custom work weeks per company (e.g. a 6-day week with only
-- Sunday off, instead of the previously hardcoded Saturday+Sunday weekend).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS weekly_off_days SMALLINT[] NOT NULL DEFAULT '{0}';

-- Backfill from the existing single-day column so current settings carry over.
UPDATE tenants
  SET weekly_off_days = ARRAY[weekly_off_day]
  WHERE weekly_off_days = '{0}' AND weekly_off_day IS NOT NULL AND weekly_off_day <> 0;

ALTER TABLE tenants
  ADD CONSTRAINT chk_weekly_off_days_valid
    CHECK (weekly_off_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[] AND array_length(weekly_off_days, 1) BETWEEN 1 AND 6);
