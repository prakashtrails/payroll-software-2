-- Recruitment pipeline (Raniwala SOP): adds an explicit pipeline `stage` to
-- referrals (the candidate table), plus rejection-reason, BGV, and police
-- verification fields. `stage` is the single source of truth the new
-- Recruitment Pipeline UI drives; `status` (Submitted/Under Review/
-- Shortlisted/Hired/Not Selected) is left untouched and kept in sync from
-- `stage` going forward via advanceReferralStage() in hiringService.js, so
-- ReferPage.jsx's existing "my referrals" view (which only reads `status`)
-- keeps working unmodified.

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'Applied';
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_stage_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_stage_check CHECK (stage IN (
  'Applied', 'Shortlisted', 'PI Round', 'Technical Interview', 'Final Interview',
  'Document Collection', 'Background Verification', 'LOI & Police Verification',
  'Offer Sent', 'Offer Accepted', 'Sent to Induction', 'Rejected', 'Withdrawn'
));

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS rejection_reason text NOT NULL DEFAULT '';
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_rejection_reason_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_rejection_reason_check
  CHECK (stage <> 'Rejected' OR rejection_reason <> '');

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS bgv_status text NOT NULL DEFAULT 'Not Started';
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_bgv_status_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_bgv_status_check CHECK (bgv_status IN (
  'Not Started', 'In Progress', 'Consent Pending', 'Verified', 'Discrepancy Found'
));
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS bgv_notes text NOT NULL DEFAULT '';

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS police_verification_status text NOT NULL DEFAULT 'Not Started';
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_police_verification_status_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_police_verification_status_check CHECK (police_verification_status IN (
  'Not Started', 'LOI Shared', 'In Progress', 'Completed'
));
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS police_verification_notes text NOT NULL DEFAULT '';

-- Backfill stage from the existing status column. Guarded by `stage = 'Applied'`
-- (the column default) so a rerun never clobbers a row already advanced
-- through the new pipeline UI.
UPDATE referrals SET stage = 'Sent to Induction' WHERE status = 'Hired'        AND stage = 'Applied';
UPDATE referrals SET stage = 'Rejected',
                      rejection_reason = COALESCE(NULLIF(hr_notes, ''), 'Not selected (backfilled from legacy status).')
  WHERE status = 'Not Selected' AND stage = 'Applied';
UPDATE referrals SET stage = 'Shortlisted' WHERE status = 'Shortlisted' AND stage = 'Applied';
-- Submitted / Under Review have no clean 1:1 mapping into the new granular
-- stages (they span everything from PI Round through Offer Accepted under
-- the old flat model) -- left at the 'Applied' default; HR advances them
-- manually in the new pipeline UI.
