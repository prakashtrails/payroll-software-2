-- Track failed verification attempts per OTP so verify-otp can lock out
-- brute-force guessing of the 6-digit code within its 5-minute validity window.
ALTER TABLE otp_table ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
