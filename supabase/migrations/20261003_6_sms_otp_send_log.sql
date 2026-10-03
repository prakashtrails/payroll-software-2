-- =============================================================
-- SMS OTP (pending-list item 1): send log used by the send-sms-otp edge
-- function to rate-limit SMS (cost + SMS-pumping fraud guard):
--   per number: 1 per minute, 5 per hour; whole platform: 300 per hour.
-- Only registered, active numbers ever get an SMS (checked in the function).
-- Service role only (no policies). Rows older than 2 days are purged nightly.
-- Re-runnable.
-- =============================================================

CREATE TABLE IF NOT EXISTS otp_send_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel    text NOT NULL CHECK (channel IN ('sms')),
  identifier text NOT NULL,           -- 10-digit Indian mobile number
  ok         boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_send_log_ident ON otp_send_log(identifier, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_send_log_time  ON otp_send_log(created_at);
ALTER TABLE otp_send_log ENABLE ROW LEVEL SECURITY;

-- Atomically checks the limits and records the attempt. Returns NULL when
-- allowed, otherwise a user-facing reason.
CREATE OR REPLACE FUNCTION otp_sms_allow(p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last timestamptz;
  v_hour int;
  v_global int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('otp_sms_allow'));
  SELECT max(created_at), count(*) FILTER (WHERE created_at > now() - interval '1 hour')
    INTO v_last, v_hour FROM otp_send_log WHERE identifier = p_phone AND created_at > now() - interval '1 hour';
  IF v_last IS NOT NULL AND v_last > now() - interval '60 seconds' THEN
    RETURN 'Please wait a minute before requesting another code.';
  END IF;
  IF v_hour >= 5 THEN
    RETURN 'Too many codes requested for this number. Try again in an hour or use email.';
  END IF;
  SELECT count(*) INTO v_global FROM otp_send_log WHERE created_at > now() - interval '1 hour';
  IF v_global >= 300 THEN
    RETURN 'SMS login is busy right now. Please use email or password login.';
  END IF;
  INSERT INTO otp_send_log (channel, identifier) VALUES ('sms', p_phone);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION otp_sms_allow(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION otp_sms_allow(text) TO service_role;

SELECT cron.unschedule('otp-send-log-cleanup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'otp-send-log-cleanup');
SELECT cron.schedule('otp-send-log-cleanup', '50 21 * * *', $$
  DELETE FROM otp_send_log WHERE created_at < now() - interval '2 days';
$$);
