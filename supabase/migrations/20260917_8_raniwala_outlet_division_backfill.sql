-- =============================================================
-- Raniwala Jewellers -- fix two data gaps found while checking why the
-- Outlet -> Division -> Department filter cascade was dropping people at
-- the Factory Staff outlet, cross-checked wherever possible against HR's
-- master spreadsheet ("Employee Master for attendance.xlsx").
--
-- PART A -- division backfill (Factory Staff outlet):
--   12 active employees at Factory Staff have a department but NO division
--   at all (blank, never set) -- none of them appear in HR's master sheet
--   (20260917_6_raniwala_employee_master_caps.sql's ESSL codes), so there's
--   no sheet value to copy. Their own outlet assignment (Factory Staff) is
--   itself the strongest signal, so this sets division = 'FACTORY' for all
--   12, matching every other Factory Staff employee. Two of the twelve
--   (ESSL 764, 765) have department = 'DEFAULT', an incomplete HR record --
--   left untouched and flagged in the NOTICE output rather than guessed at.
--
-- PART B -- outlet correction (confirmed against the master sheet):
--   ESSL 756 (Purushotam Bairwa) punches on the Factory biometric device
--   but his attendance/reporting was showing under Office -- essl-punch
--   resolves settings from profiles.outlet_id, not the punching device (by
--   design, see supabase/functions/essl-punch/index.ts), so a wrong
--   profile.outlet_id is what actually caused this. The master sheet
--   confirms his LOCATION is "FACTORY" (department PUWAI, division
--   FACTORY already correct) -- this moves his outlet_id to Factory Staff
--   to match.
--
--   NOT included here: ESSL 429 (Amba Dutt) and 425 (Praveen Kumar), who
--   looked like the same "Office outlet but Delhi division" pattern -- the
--   master sheet actually confirms LOCATION = "OFFICE" for both of them
--   (division B2C (DELHI) is legitimately paired with the Office location
--   for these two), so they're left exactly as-is.
--
--   ALSO NOT included: 9 more Office Staff employees whose department
--   (CAD/GHAT/MICRO SETTING/DIAMOND ASSORTING/PPC/QC & REPAIR) matches
--   departments otherwise only seen at Factory Staff, and who also have a
--   blank division -- ESSL 732, 600, 753, 703, 564, 589, 646, 751, 445.
--   None of these appear in the master sheet either, so there's no way to
--   confirm they actually belong at Factory rather than Office (learned
--   from the Amba Dutt/Praveen Kumar false positive above) -- flagged in
--   the NOTICE output for HR to confirm manually rather than reassigned
--   blind.
-- =============================================================

DO $$
DECLARE
  v_tenant_id  uuid;
  v_factory_id uuid;
  v_dept_backfilled int;
  v_outlet_fixed    int;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE company_name ILIKE '%Raniwala%' LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found';
  END IF;

  SELECT id INTO v_factory_id FROM outlets WHERE tenant_id = v_tenant_id AND name ILIKE '%factory%' LIMIT 1;
  IF v_factory_id IS NULL THEN
    RAISE EXCEPTION 'Raniwala Factory outlet not found';
  END IF;

  -- PART A: division backfill at Factory Staff.
  UPDATE profiles
  SET division = 'FACTORY'
  WHERE tenant_id = v_tenant_id
    AND outlet_id = v_factory_id
    AND status = 'Active'
    AND (division IS NULL OR division = '')
    AND essl_employee_code IN ('754','755','761','613','758','297','762','735','764','760','586','765');
  GET DIAGNOSTICS v_dept_backfilled = ROW_COUNT;

  -- PART B: outlet correction, confirmed against the master sheet.
  UPDATE profiles
  SET outlet_id = v_factory_id
  WHERE tenant_id = v_tenant_id
    AND essl_employee_code = '756';
  GET DIAGNOSTICS v_outlet_fixed = ROW_COUNT;

  RAISE NOTICE 'Raniwala outlet/division backfill: % Factory Staff profiles set to division=FACTORY, % profile(s) moved to Factory Staff outlet (ESSL 756)',
    v_dept_backfilled, v_outlet_fixed;

  RAISE NOTICE 'Still flagged for HR to confirm (not in master sheet, not touched here) -- department=DEFAULT: %',
    (SELECT string_agg(essl_employee_code || ' ' || first_name || ' ' || last_name, ', ')
     FROM profiles WHERE tenant_id = v_tenant_id AND outlet_id = v_factory_id
       AND status = 'Active' AND department = 'DEFAULT');

  RAISE NOTICE 'Still flagged for HR to confirm -- Office Staff employees with a Factory-style department and no division (ESSL): %',
    (SELECT string_agg(essl_employee_code, ', ')
     FROM profiles p JOIN outlets o ON o.id = p.outlet_id
     WHERE p.tenant_id = v_tenant_id AND o.name ILIKE '%office%' AND p.status = 'Active'
       AND (p.division IS NULL OR p.division = '')
       AND p.essl_employee_code IN ('732','600','753','703','564','589','646','751','445'));
END $$;
