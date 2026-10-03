-- =============================================================
-- Temporary extended regularize window (29 Sep 2026, Raniwala request).
--
-- For 5 days (29 Sep – 3 Oct 2026) every Raniwala employee may raise a
-- regularize request for ANY day since 1 Sep (to clear September's
-- mispunches). From 4 Oct the normal regularize_window_days rule (3 =
-- today + the 2 days before) is back on its own — nothing to switch off.
--
--   tenants.regularize_extended_from   earliest date allowed while active
--   tenants.regularize_extended_until  last day (IST, inclusive) it's active
--
-- Web (src/lib/helpers.js regularizeExtension) and the CrewCore app
-- (lib/helpers.ts) read the same two columns for the date picker limits
-- and the notice on the regularize pages; this trigger is the real gate.
-- =============================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS regularize_extended_from date;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS regularize_extended_until date;

-- Live def (20260925_3) + the extension.
CREATE OR REPLACE FUNCTION public.enforce_regularize_request_window()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_window integer;
  v_ext_from  date;
  v_ext_until date;
  v_min    date;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    SELECT COALESCE(regularize_window_days, 3), regularize_extended_from, regularize_extended_until
      INTO v_window, v_ext_from, v_ext_until
      FROM tenants WHERE id = NEW.tenant_id;
    v_window := COALESCE(v_window, 3);

    IF NEW.date > v_today THEN
      RAISE EXCEPTION 'Cannot request regularization for a future date.'
        USING ERRCODE = 'check_violation';
    END IF;

    v_min := v_today - (v_window - 1);

    -- Extended window still open: anything since regularize_extended_from.
    IF v_ext_from IS NOT NULL AND v_ext_until IS NOT NULL AND v_today <= v_ext_until THEN
      IF NEW.date < LEAST(v_ext_from, v_min) THEN
        RAISE EXCEPTION 'Regularization can only be requested for dates from % (until %).',
            to_char(LEAST(v_ext_from, v_min), 'DD Mon'), to_char(v_ext_until, 'DD Mon')
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.date < v_min THEN
      RAISE EXCEPTION '%', CASE
          WHEN v_window = 1 THEN 'Regularization can only be requested for today.'
          WHEN v_window = 2 THEN 'Regularization can only be requested for today or yesterday.'
          ELSE format('Regularization can only be requested for today and the previous %s days.', v_window - 1) END
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE tenants
SET regularize_extended_from = '2026-09-01', regularize_extended_until = '2026-10-03'
WHERE company_name ILIKE '%raniwala%';
