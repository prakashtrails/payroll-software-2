-- RR Number: an auto-generated per-tenant-wide requisition code, generated
-- the moment a headcount_requests row is approved (a single clean, already-
-- existing status transition -- avoids trying to detect the SOP's literal
-- "5 MRF steps done" trigger, which would need fragile cross-table logic
-- fired from job_postings/referrals as well). Plus an assigned-recruiter
-- field so "HR Manager assigns the position to a Recruiter" is representable.

CREATE SEQUENCE IF NOT EXISTS headcount_requests_rr_seq;

ALTER TABLE headcount_requests ADD COLUMN IF NOT EXISTS rr_number text;
ALTER TABLE headcount_requests ADD COLUMN IF NOT EXISTS assigned_recruiter_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS idx_headcount_requests_rr_number;
CREATE UNIQUE INDEX idx_headcount_requests_rr_number ON headcount_requests(rr_number) WHERE rr_number IS NOT NULL;

CREATE OR REPLACE FUNCTION generate_rr_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Approved' AND (OLD.status IS DISTINCT FROM 'Approved') AND NEW.rr_number IS NULL THEN
    NEW.rr_number := 'RR-' || lpad(nextval('headcount_requests_rr_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_rr_number ON headcount_requests;
CREATE TRIGGER trg_generate_rr_number
  BEFORE UPDATE ON headcount_requests
  FOR EACH ROW EXECUTE FUNCTION generate_rr_number();

-- Backfill any rows already Approved before this migration ran.
UPDATE headcount_requests
SET rr_number = 'RR-' || lpad(nextval('headcount_requests_rr_seq')::text, 5, '0')
WHERE status = 'Approved' AND rr_number IS NULL;
