-- employee_last_ping, rewritten so it no longer reads every ping ever stored.
--
-- The old definition (20260917_10) was DISTINCT ON (employee_id) over the whole
-- employee_location_pings table — a full scan each time. The Live Tracking
-- page now re-reads it every minute while open, and CrewCore records in the
-- background again (hundreds of pings per tracked employee per day), so that
-- scan would grow without bound.
--
-- Same columns, same order, same rows: one per employee that has a tracking
-- toggle row. Every ping belongs to such an employee (the pings INSERT policy
-- and trg_attendance_punch_location_ping both require an enabled toggle, and
-- toggle rows are only ever upserted, never deleted). Each lookup walks the
-- existing idx_elp_employee_date (tenant_id, employee_id, recorded_date) to
-- the latest day and sorts only that day's pings — no new index, no extra size.

CREATE OR REPLACE VIEW public.employee_last_ping
WITH (security_invoker = true) AS
SELECT t.employee_id,
       t.tenant_id,
       p.lat,
       p.lng,
       p.recorded_at
FROM employee_tracking_toggles t
CROSS JOIN LATERAL (
  SELECT e.lat, e.lng, e.recorded_at
  FROM employee_location_pings e
  WHERE e.tenant_id = t.tenant_id
    AND e.employee_id = t.employee_id
  ORDER BY e.recorded_date DESC, e.recorded_at DESC
  LIMIT 1
) p;
