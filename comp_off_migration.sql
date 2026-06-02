-- Compensatory Off (Comp Off) system
-- Run this after special_requests_migration.sql

-- Add comp-off balance counter to each employee profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS comp_off_balance INT NOT NULL DEFAULT 0;

-- Track whether an approved Comp Off request consumed a comp-off credit or a regular leave day
ALTER TABLE special_requests ADD COLUMN IF NOT EXISTS used_comp_off BOOLEAN DEFAULT FALSE;

-- Expand the request_type check constraint to include 'Comp Off'
ALTER TABLE special_requests DROP CONSTRAINT IF EXISTS special_requests_request_type_check;
ALTER TABLE special_requests
  ADD CONSTRAINT special_requests_request_type_check
  CHECK (request_type IN ('Overtime', 'Late Arrival', 'Comp Off'));
