-- ============================================================
-- Early Left / Late Arrival monthly-grace counter
--
-- Independent of, and never touching, the existing monthly_allowance_used /
-- Half-Day-penalty mechanism (shifts.early_departure_after /
-- late_arrival_allowance_until) or the Late Deduction Policy ladder in
-- Settings — this is a separate, additive, visibility-only tracker with its
-- own fixed rule: a punch-in more than 90 minutes after shift start, OR a
-- punch-out more than 90 minutes before shift end, is a "breach" for that
-- day. The first breach in a calendar month is graced (not counted); every
-- subsequent breach that month is counted. No pay/status side-effects.
--
-- Persisted at clock-in/out time (mirrors monthly_allowance_used's existing
-- "count prior flagged rows since the 1st of the month" idiom) rather than
-- computed live on every render, so the "which day was the free one"
-- ordering stays stable across every view (employee calendar, HR calendar,
-- mobile) instead of being recomputed differently each time.
-- ============================================================

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS early_late_flag   boolean NOT NULL DEFAULT false, -- counted (not the month's free breach)
  ADD COLUMN IF NOT EXISTS early_late_graced boolean NOT NULL DEFAULT false; -- this was the month's free breach
