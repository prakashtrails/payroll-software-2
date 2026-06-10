-- Add reviewed_at timestamp to track when a request was approved or rejected
ALTER TABLE regularize_requests
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
