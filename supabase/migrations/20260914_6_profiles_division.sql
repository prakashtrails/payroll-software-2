-- Adds a "division" field to profiles (e.g. "Support" / "Factory") — a
-- broader grouping than department/designation, used by Raniwala Jewellers'
-- employee master sheet and its bulk import.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS division text NOT NULL DEFAULT '';
