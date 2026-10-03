-- =============================================================
-- Hours-based comp off for working a weekly off / holiday (28 Sep 2026).
-- Raniwala request; applies to any tenant with
-- tenants.auto_comp_off_on_weekly_off_worked = true (only Raniwala today).
--
-- Rule (per employee ticked "Comp Off eligible" on the employee form):
--   worked < 4h on a weekly off / holiday  -> no comp off
--   4h – <5h                               -> 0.5 day comp off
--   5h or more                             -> 1 day comp off
--
-- Before this, clockIn() / essl-punch credited +1 on the first punch-in of
-- a weekly off, for everyone, whatever the hours. That path checks
-- attendance.comp_off_granted before granting; this trigger sets that flag
-- on every off-day row so the old path goes inert without redeploying any
-- client (the mobile app shares this DB -- see project_app_web_shared_db).
--
-- The credit is re-derived on every insert/update of the day's row (each
-- new punch recomputes total_hours), and the balance moves by the
-- DIFFERENCE from what the row had already credited -- so a day that grows
-- from 4.5h to 6h tops up 0.5 -> 1, never double-credits, and deleting the
-- row takes its credit back.
--
-- A 'Late' status on an off day is meaningless (there is no report time on
-- a day off), so it is shown as 'Present'.
-- =============================================================

ALTER TABLE profiles   ADD COLUMN IF NOT EXISTS comp_off_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS comp_off_credit   numeric(3,1) NOT NULL DEFAULT 0;

-- Half-day comp offs need a fractional balance. No view depends on this
-- column; the adjust_* RPCs already take numeric deltas.
ALTER TABLE profiles ALTER COLUMN comp_off_balance TYPE numeric(6,1) USING comp_off_balance::numeric;

CREATE OR REPLACE FUNCTION public.trg_comp_off_credit_from_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_flag     boolean;
  v_eligible boolean;
  v_outlet   uuid;
  v_off_days int[];
  v_new      numeric := 0;
  v_old      numeric := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.comp_off_credit, 0) <> 0 THEN
      UPDATE profiles
      SET comp_off_balance = GREATEST(0, COALESCE(comp_off_balance, 0) - OLD.comp_off_credit)
      WHERE id = OLD.profile_id;
    END IF;
    RETURN OLD;
  END IF;

  -- Weekly-off precedence mirrors isTenantWeeklyOff() in src/lib/helpers.js:
  -- outlet override > tenant weekly_off_days > legacy weekly_off_day > Sunday.
  SELECT t.auto_comp_off_on_weekly_off_worked, p.comp_off_eligible, p.outlet_id,
         COALESCE(
           NULLIF(o.weekly_off_days, '{}'::int[]),
           NULLIF(t.weekly_off_days::int[], '{}'::int[]),
           CASE WHEN t.weekly_off_day IS NOT NULL THEN ARRAY[t.weekly_off_day::int] END,
           ARRAY[0]
         )
  INTO v_flag, v_eligible, v_outlet, v_off_days
  FROM profiles p
  JOIN tenants t ON t.id = p.tenant_id
  LEFT JOIN outlets o ON o.id = p.outlet_id
  WHERE p.id = NEW.profile_id;

  IF NOT COALESCE(v_flag, false) THEN
    RETURN NEW;
  END IF;

  IF NOT (
    EXTRACT(DOW FROM NEW.date)::int = ANY (v_off_days)
    OR EXISTS (
      SELECT 1 FROM holidays h
      WHERE h.tenant_id = NEW.tenant_id
        AND h.date = NEW.date
        AND (h.outlet_id IS NULL OR h.outlet_id = v_outlet)
    )
  ) THEN
    RETURN NEW;
  END IF;

  -- Hands the grant to this trigger (see header).
  NEW.comp_off_granted := true;

  IF NEW.status = 'Late' THEN
    NEW.status := 'Present';
  END IF;

  IF COALESCE(v_eligible, false) AND NEW.status NOT IN ('Leave', 'Comp Off') THEN
    v_new := CASE
      WHEN COALESCE(NEW.total_hours, 0) >= 5 THEN 1
      WHEN COALESCE(NEW.total_hours, 0) >= 4 THEN 0.5
      ELSE 0
    END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := COALESCE(OLD.comp_off_credit, 0);
  END IF;

  IF v_new <> v_old THEN
    UPDATE profiles
    SET comp_off_balance = GREATEST(0, COALESCE(comp_off_balance, 0) + v_new - v_old)
    WHERE id = NEW.profile_id;
  END IF;

  NEW.comp_off_credit := v_new;
  RETURN NEW;
END;
$$;

-- "zzz_" so it fires after recompute_attendance_from_punches and
-- zz_leave_overrides_attendance_status (BEFORE triggers run in name order)
-- and sees the final total_hours / status.
DROP TRIGGER IF EXISTS zzz_comp_off_credit_from_hours ON attendance;
CREATE TRIGGER zzz_comp_off_credit_from_hours
  BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION trg_comp_off_credit_from_hours();

DROP TRIGGER IF EXISTS zzz_comp_off_credit_reverse_on_delete ON attendance;
CREATE TRIGGER zzz_comp_off_credit_reverse_on_delete
  AFTER DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION trg_comp_off_credit_from_hours();
