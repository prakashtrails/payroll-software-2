-- =============================================================
-- AI assistant (pending-list item 11) + AI meeting notes -> tasks (item 10).
--
--   * Both are PREMIUM features (features.is_premium via featureRegistry.js):
--     off for every company until the platform admin turns them on in Toggle
--     Services — they cost money per request (Claude API).
--   * ai_feature_enabled(): server-side copy of resolveFeatureState() so the
--     edge functions enforce the toggle (outlet row -> company row -> default).
--   * ai_usage_daily: per user/day/feature request + token counters, written
--     only by the edge functions (service role) through ai_usage_record(),
--     which also enforces the daily cap atomically.
--   * meeting_notes: the reviewed summary + action items of a meeting. The raw
--     transcript is NOT stored (size-lean); tasks created from it carry
--     source = 'ai' and go through the normal task rules.
-- Re-runnable.
-- =============================================================

-- ── 1. Feature check (service role) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION ai_feature_enabled(p_tenant uuid, p_outlet uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT enabled FROM company_feature_toggles
      WHERE tenant_id = p_tenant AND feature_key = p_key AND p_outlet IS NOT NULL AND outlet_id = p_outlet LIMIT 1),
    (SELECT enabled FROM company_feature_toggles
      WHERE tenant_id = p_tenant AND feature_key = p_key AND outlet_id IS NULL LIMIT 1),
    (SELECT NOT is_premium FROM features WHERE key = p_key),
    true);  -- no features row yet = ordinary feature = on (same as FeatureContext)
$$;

-- ── 2. Usage + daily cap ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day           date NOT NULL,
  feature       text NOT NULL CHECK (feature IN ('assistant','meetings')),
  requests      int    NOT NULL DEFAULT 0,
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, day, feature)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_tenant ON ai_usage_daily(tenant_id, day);
ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_usage_daily: own or admin select" ON ai_usage_daily;
CREATE POLICY "ai_usage_daily: own or admin select" ON ai_usage_daily FOR SELECT USING (
  profile_id = auth.uid()
  OR (tenant_id = (SELECT my_tenant_id()) AND (SELECT my_role()) IN ('admin','superadmin'))
);

-- Reserve one request against today's cap. Returns false when the cap is hit.
CREATE OR REPLACE FUNCTION ai_usage_reserve(p_tenant uuid, p_profile uuid, p_feature text, p_cap int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_req int;
BEGIN
  INSERT INTO ai_usage_daily (tenant_id, profile_id, day, feature, requests)
  VALUES (p_tenant, p_profile, v_day, p_feature, 1)
  ON CONFLICT (profile_id, day, feature) DO UPDATE SET requests = ai_usage_daily.requests + 1
  RETURNING requests INTO v_req;
  IF v_req > p_cap THEN
    UPDATE ai_usage_daily SET requests = requests - 1
    WHERE profile_id = p_profile AND day = v_day AND feature = p_feature;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION ai_usage_add_tokens(p_profile uuid, p_feature text, p_in bigint, p_out bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE ai_usage_daily
  SET input_tokens = input_tokens + GREATEST(p_in, 0), output_tokens = output_tokens + GREATEST(p_out, 0)
  WHERE profile_id = p_profile AND day = (now() AT TIME ZONE 'Asia/Kolkata')::date AND feature = p_feature;
$$;

REVOKE EXECUTE ON FUNCTION ai_feature_enabled(uuid, uuid, text)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ai_usage_reserve(uuid, uuid, text, int)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ai_usage_add_tokens(uuid, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ai_feature_enabled(uuid, uuid, text)            TO service_role;
GRANT  EXECUTE ON FUNCTION ai_usage_reserve(uuid, uuid, text, int)         TO service_role;
GRANT  EXECUTE ON FUNCTION ai_usage_add_tokens(uuid, text, bigint, bigint) TO service_role;

-- ── 3. Meeting notes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  meeting_date    date NOT NULL,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  summary         text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 6000),
  decisions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{title, description, assignee_id, assignee_name, due_date, priority, task_id}]
  action_items    jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript_chars int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(decisions) = 'array' AND jsonb_typeof(action_items) = 'array'),
  CHECK (pg_column_size(action_items) < 65536)
);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_tenant ON meeting_notes(tenant_id, meeting_date DESC);
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;

-- Visible to whoever saved it, HR/admin, and anyone who owns one of its action items.
DROP POLICY IF EXISTS "meeting_notes: involved select" ON meeting_notes;
CREATE POLICY "meeting_notes: involved select" ON meeting_notes FOR SELECT USING (
  tenant_id = (SELECT my_tenant_id())
  AND (created_by = auth.uid()
       OR (SELECT my_role()) IN ('admin','superadmin')
       OR action_items @> jsonb_build_array(jsonb_build_object('assignee_id', auth.uid()::text)))
);
DROP POLICY IF EXISTS "meeting_notes: member insert own" ON meeting_notes;
CREATE POLICY "meeting_notes: member insert own" ON meeting_notes FOR INSERT
  WITH CHECK (tenant_id = (SELECT my_tenant_id()) AND created_by = auth.uid());
DROP POLICY IF EXISTS "meeting_notes: owner or admin update" ON meeting_notes;
CREATE POLICY "meeting_notes: owner or admin update" ON meeting_notes FOR UPDATE
  USING (tenant_id = (SELECT my_tenant_id()) AND (created_by = auth.uid() OR (SELECT my_role()) IN ('admin','superadmin')))
  WITH CHECK (tenant_id = (SELECT my_tenant_id()));
DROP POLICY IF EXISTS "meeting_notes: owner or admin delete" ON meeting_notes;
CREATE POLICY "meeting_notes: owner or admin delete" ON meeting_notes FOR DELETE
  USING (tenant_id = (SELECT my_tenant_id()) AND (created_by = auth.uid() OR (SELECT my_role()) IN ('admin','superadmin')));

-- ── 4. Premium feature rows (featureRegistry.js keeps them in sync too) ──
INSERT INTO features (key, name, category, description, sort_order, is_premium) VALUES
  ('ai_assistant', 'AI Assistant', 'Premium', 'In-app AI chat assistant: answers how-to questions, finds pages, looks up your own leave, attendance, payslips and tasks, and creates tasks.', 710, true),
  ('ai_meetings', 'AI Meeting Notes', 'Premium', 'Paste or upload a meeting transcript; AI writes the summary and turns action items into assigned tasks.', 720, true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
  description = EXCLUDED.description, sort_order = EXCLUDED.sort_order, is_premium = EXCLUDED.is_premium;
