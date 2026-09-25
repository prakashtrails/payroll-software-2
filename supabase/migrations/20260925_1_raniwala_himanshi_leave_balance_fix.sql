-- =============================================================
-- Follow-up to 20260924_2_raniwala_leave_balance_dob_import.sql.
--
-- HR sheet row "EMP CODE 365, HIMANSHI, 3 days, DOB 2001-10-12" was
-- SKIPPED by that import: her profile had no employee_id and is stored
-- as "HIMANSHI BIHANI", so neither the code match nor the exact-name
-- match found her. Every other sheet row with a profile was imported
-- correctly (verified 2026-09-25: 254 of 265 rows match; the remaining
-- 10 have no profile in the app yet).
--
-- Fixes her record only: backfills employee_id = '365' (not used by any
-- other Raniwala profile), sets DOB, and posts the same opening Earned
-- Leave allocation with the same note, so the original import's
-- NOT EXISTS guard and this one both prevent double-crediting.
-- =============================================================

DO $$
DECLARE
  v_tenant     uuid;
  v_leave_type uuid;
  v_profile    uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found -- aborting, nothing changed';
  END IF;

  SELECT id INTO v_leave_type FROM leave_types WHERE tenant_id = v_tenant AND name = 'Earned Leave';
  IF v_leave_type IS NULL THEN
    RAISE EXCEPTION 'Raniwala "Earned Leave" leave_types row not found -- aborting, nothing changed';
  END IF;

  SELECT id INTO v_profile FROM profiles
  WHERE tenant_id = v_tenant
    AND upper(trim(first_name)) = 'HIMANSHI'
    AND upper(trim(last_name)) = 'BIHANI';
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'HIMANSHI BIHANI profile not found -- aborting, nothing changed';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE tenant_id = v_tenant AND employee_id = '365' AND id <> v_profile) THEN
    RAISE EXCEPTION 'employee_id 365 already belongs to another Raniwala profile -- aborting, nothing changed';
  END IF;

  UPDATE profiles
    SET employee_id = COALESCE(employee_id, '365'), date_of_birth = '2001-10-12'
    WHERE id = v_profile;

  IF NOT EXISTS (
    SELECT 1 FROM leave_ledger
    WHERE profile_id = v_profile AND leave_type_id = v_leave_type
      AND note = 'Opening Earned Leave balance import (HR sheet, as on 19 Sep 2026)'
  ) THEN
    INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, effective_date, note)
    VALUES (v_tenant, v_profile, v_leave_type, 'Allocation', 3, '2026-09-19',
            'Opening Earned Leave balance import (HR sheet, as on 19 Sep 2026)');
  END IF;
END $$;
