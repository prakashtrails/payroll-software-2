-- =============================================================
-- OPTIONAL, run only once HR confirms: re-mark Raniwala's already-closed
-- single-punch days from 1 Sep 2026 up to yesterday as 'Mispunch' (unpaid
-- until regularized). Needs 20260925_2_raniwala_hr_feedback_batch.sql first
-- (mark_mispunches + tenants.mark_single_punch_mispunch).
--
-- Held back from 20260925_2 on purpose: when checked on 2026-09-25 this
-- touched 428 attendance days, all of which currently count as paid, and
-- September payroll had not been run yet.
-- =============================================================

DO $$
DECLARE
  v_day   date;
  v_total int := 0;
BEGIN
  FOR v_day IN SELECT generate_series('2026-09-01'::date, CURRENT_DATE - 1, interval '1 day')::date LOOP
    v_total := v_total + mark_mispunches(v_day);
  END LOOP;
  RAISE NOTICE 'Marked % single-punch day(s) as Mispunch', v_total;
END $$;
