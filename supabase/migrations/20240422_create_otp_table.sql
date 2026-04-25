-- Create otp_table for custom OTP handling
CREATE TABLE IF NOT EXISTS otp_table (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL, -- Phone number or identifier
  otp         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

-- Enable RLS
ALTER TABLE otp_table ENABLE ROW LEVEL SECURITY;

-- Allow service role to do everything
CREATE POLICY "service_role_all" ON otp_table FOR ALL USING (true);

-- Allow public to insert (for sending OTP) if needed, 
-- but better to handle this via Edge Function with service_role.
