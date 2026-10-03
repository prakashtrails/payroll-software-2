-- =============================================================
-- Raniwala: leave goes to the employee's OWN manager and HOD as linked by
-- EMP CODE — whatever that person's role is (26 Sep 2026).
--
-- User rule:
--   <= 3 days : manager (an HOD who is the direct manager gets it too)
--   4-5 days  : manager + the employee's HOD
--   >= 6 days : manager -> HOD -> HR -> Management
--   manager and HOD are the same person -> one approval is enough
--   "just send the request to them" — employee, manager, HOD or HR.
--
-- Before: resolve_leave_approvers() walked the manager_id chain and only
-- accepted someone with role = 'manager' as the manager. A direct manager
-- who is an HOD (62 employees) or HR/admin (4) was skipped, and the chain's
-- first HOD was used as the HOD when the sheet named none (owners
-- ABHISHEK SIR / ABHIYANT SIR). Now:
--   manager = profiles.manager_id, HOD = profiles.hod_id (both set from
--   HR's HOD.xlsx by employee code), any role, if Active and not the
--   employee. No chain guessing: no HOD on file -> HR stands in (4-5 days),
--   exactly as raniwala_leave_route() already does.
-- Approve rights already go by assignment (enforce_leave_dual_approval
-- checks manager_id / hod_id = auth.uid()), and the website's
-- myLeaveStage() does the same, so no permission change is needed.
--
-- Also links POOJA KHANDELWAL (357, admin) as HOD of the four employees the
-- sheet gives her as both manager and HOD. She stays admin; with manager =
-- HOD their leave needs her approval once.
-- =============================================================

CREATE OR REPLACE FUNCTION public.resolve_leave_approvers(p_profile_id uuid, OUT o_manager uuid, OUT o_hod uuid)
RETURNS record
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  SELECT m.id INTO o_manager
  FROM profiles e JOIN profiles m ON m.id = e.manager_id
  WHERE e.id = p_profile_id AND m.id <> p_profile_id AND COALESCE(m.status, 'Active') = 'Active';

  SELECT h.id INTO o_hod
  FROM profiles e JOIN profiles h ON h.id = e.hod_id
  WHERE e.id = p_profile_id AND h.id <> p_profile_id AND COALESCE(h.status, 'Active') = 'Active';

  -- Same person is manager and HOD: one approval, on the HOD stage.
  IF o_manager = o_hod THEN
    o_manager := NULL;
  END IF;
END;
$function$;

UPDATE profiles e
SET hod_id = pooja.id, hod_display_name = NULL
FROM profiles pooja
WHERE pooja.tenant_id = e.tenant_id
  AND pooja.employee_id = '357'
  AND e.tenant_id = (SELECT id FROM tenants WHERE company_name ILIKE '%Raniwala%' LIMIT 1)
  AND e.employee_id IN ('365', '430', '450', '453')
  AND e.hod_id IS NULL;
