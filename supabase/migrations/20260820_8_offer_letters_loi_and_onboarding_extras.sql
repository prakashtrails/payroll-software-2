-- LOI (Letter of Intent): reuses offer_letters with a letter_type
-- discriminator rather than a new table -- offer_letters.referral_id is
-- already non-unique (multiple rows per candidate already tolerated), and
-- every other column (template_id, rendered_html, status, created_by) is
-- directly reusable for an LOI's lifecycle.
ALTER TABLE letter_templates DROP CONSTRAINT IF EXISTS letter_templates_type_check;
ALTER TABLE letter_templates ADD CONSTRAINT letter_templates_type_check
  CHECK (type IN ('Offer', 'Appointment', 'LOI'));

ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS letter_type text NOT NULL DEFAULT 'Offer';
ALTER TABLE offer_letters DROP CONSTRAINT IF EXISTS offer_letters_letter_type_check;
ALTER TABLE offer_letters ADD CONSTRAINT offer_letters_letter_type_check
  CHECK (letter_type IN ('Offer', 'Appointment', 'LOI'));

-- Onboarding: traceability back to the hire's referral row, plus buddy
-- assignment (first 15 days) and KRA request/tracking (joining formalities
-- steps 9-16). Deliberately does not touch the separate performance-
-- management `kras` table -- this is a one-time joining-formality
-- checkbox, not the ongoing KPI system.
ALTER TABLE onboarding_processes ADD COLUMN IF NOT EXISTS referral_id uuid REFERENCES referrals(id) ON DELETE SET NULL;
ALTER TABLE onboarding_processes ADD COLUMN IF NOT EXISTS buddy_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE onboarding_processes ADD COLUMN IF NOT EXISTS buddy_ends_on date;
ALTER TABLE onboarding_processes ADD COLUMN IF NOT EXISTS kra_requested_at timestamptz;
ALTER TABLE onboarding_processes ADD COLUMN IF NOT EXISTS kra_received_at timestamptz;
