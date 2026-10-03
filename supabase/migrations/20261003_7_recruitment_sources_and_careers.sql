-- =============================================================
-- Hiring & Recruitment gaps (pending-list item 7):
--   * referrals.source — candidates no longer only come from employee
--     referrals: HR/managers add Direct / Job Portal / Agency / Walk-in
--     candidates (referred_by = the HR user who added them), and the public
--     careers page creates 'Careers Page' candidates (referred_by NULL,
--     inserted by the careers-apply edge function with the service role).
--   * Public careers page per company: tenants.careers_enabled +
--     careers_slug (+ optional intro). careers_list_openings() is the ONLY
--     anon-callable piece and returns public job details only.
--   * careers_apply_log + careers_apply_allow(): spam/abuse limits for the
--     public application endpoint (per IP, per email+posting, platform-wide).
-- Re-runnable.
-- =============================================================

-- ── 1. Candidate source ───────────────────────────────────────────────────
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'Referral';
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_source_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_source_check
  CHECK (source IN ('Referral','Direct','Careers Page','Job Portal','Agency','Walk-in'));

-- Only HR/managers may record a non-referral source from the app.
CREATE OR REPLACE FUNCTION trg_referrals_source_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.source <> 'Referral'
     AND (TG_OP = 'INSERT' OR NEW.source IS DISTINCT FROM OLD.source)
     AND COALESCE((SELECT role FROM profiles WHERE id = auth.uid()), '') NOT IN ('admin','superadmin','manager') THEN
    RAISE EXCEPTION 'Only HR or a manager can add non-referral candidates.' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.source = 'Careers Page' AND (TG_OP = 'INSERT' OR OLD.source <> 'Careers Page') THEN
    RAISE EXCEPTION 'Careers Page candidates can only come from the public careers page.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS referrals_source_guard ON referrals;
CREATE TRIGGER referrals_source_guard BEFORE INSERT OR UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION trg_referrals_source_guard();
REVOKE EXECUTE ON FUNCTION trg_referrals_source_guard() FROM PUBLIC, anon, authenticated;

-- ── 2. Careers page settings ──────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS careers_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS careers_slug    text,
  ADD COLUMN IF NOT EXISTS careers_intro   text NOT NULL DEFAULT '';
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_careers_slug_format;
ALTER TABLE tenants ADD CONSTRAINT tenants_careers_slug_format
  CHECK (careers_slug IS NULL OR careers_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$');
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_careers_intro_len;
ALTER TABLE tenants ADD CONSTRAINT tenants_careers_intro_len CHECK (char_length(careers_intro) <= 1500);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_careers_slug ON tenants(careers_slug) WHERE careers_slug IS NOT NULL;

-- Public read: company name + open postings, nothing else.
CREATE OR REPLACE FUNCTION careers_list_openings(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
    'company', t.company_name,
    'intro', t.careers_intro,
    'openings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', j.id, 'title', j.title, 'department', j.department, 'location', j.location,
        'employment_type', j.employment_type, 'experience_required', j.experience_required,
        'openings', j.openings, 'description', j.description, 'responsibilities', j.responsibilities,
        'requirements', j.requirements, 'closing_date', j.closing_date, 'posted_on', j.created_at::date)
        ORDER BY j.created_at DESC)
      FROM job_postings j
      WHERE j.tenant_id = t.id AND j.status = 'Open'
        AND (j.closing_date IS NULL OR j.closing_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
    ), '[]'::jsonb)) END
  FROM (SELECT NULL::uuid AS id) dummy
  LEFT JOIN tenants t ON t.careers_slug = lower(btrim(p_slug)) AND t.careers_enabled;
$$;
GRANT EXECUTE ON FUNCTION careers_list_openings(text) TO anon, authenticated;

-- ── 3. Application rate limits (service role only) ────────────────────────
CREATE TABLE IF NOT EXISTS careers_apply_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip             text NOT NULL,
  email          text NOT NULL,
  job_posting_id uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_careers_apply_log_ip    ON careers_apply_log(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_careers_apply_log_email ON careers_apply_log(email, job_posting_id);
CREATE INDEX IF NOT EXISTS idx_careers_apply_log_time  ON careers_apply_log(created_at);
ALTER TABLE careers_apply_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION careers_apply_allow(p_ip text, p_email text, p_posting uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('careers_apply_allow'));
  IF EXISTS (SELECT 1 FROM careers_apply_log WHERE email = lower(p_email) AND job_posting_id = p_posting AND created_at > now() - interval '30 days') THEN
    RETURN 'You have already applied for this role.';
  END IF;
  IF (SELECT count(*) FROM careers_apply_log WHERE ip = p_ip AND created_at > now() - interval '1 hour') >= 5 THEN
    RETURN 'Too many applications from this connection. Please try again later.';
  END IF;
  IF (SELECT count(*) FROM careers_apply_log WHERE created_at > now() - interval '1 hour') >= 200 THEN
    RETURN 'Applications are temporarily paused. Please try again later.';
  END IF;
  INSERT INTO careers_apply_log (ip, email, job_posting_id) VALUES (p_ip, lower(p_email), p_posting);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION careers_apply_allow(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION careers_apply_allow(text, text, uuid) TO service_role;

SELECT cron.unschedule('careers-apply-log-cleanup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'careers-apply-log-cleanup');
SELECT cron.schedule('careers-apply-log-cleanup', '55 21 * * *', $$
  DELETE FROM careers_apply_log WHERE created_at < now() - interval '31 days';
$$);
