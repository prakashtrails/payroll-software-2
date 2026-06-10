-- Add PF / ESIC compliance fields to employee profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS compliance_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pf_enabled         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pf_number          text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pf_amount          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS esic_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS esic_number         text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS esic_amount         numeric NOT NULL DEFAULT 0;
