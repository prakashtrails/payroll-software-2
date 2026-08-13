-- The Hotel Indwell import sheet carries BANK NAME and IFSC CODE columns that
-- had nowhere to land (only the account number was captured) — needed for
-- payroll bank transfers.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bank_name text NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ifsc_code text NOT NULL DEFAULT '';
