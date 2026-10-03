-- =============================================================
-- Raniwala Jewellers -- division backfill for Office Staff, same gap as
-- 20260917_8's Factory Staff fix. Office Staff is a mixed-division outlet
-- (SUPPORT/B2B/B2C/MDO), so unlike Factory there's no single dominant
-- division to fall back on -- only ESSL 138/171 appear in HR's master
-- sheet at all, and the sheet itself has a blank division for both
-- (confirmed by 20260917_6's own comment), so it adds nothing new here.
--
-- Instead this backfills only the 8 employees whose department has a
-- UNANIMOUS division among their own Office Staff peers (checked live --
-- zero exceptions for any of these five departments):
--   ADMIN -> SUPPORT, B2B -> B2B, B2C -> B2C, ECOM -> B2C,
--   MERCHANDISING -> SUPPORT
--
-- NOT touched here (flagged in the NOTICE output instead):
--   - 9 Office Staff employees whose department (CAD/DIAMOND ASSORTING/
--     GHAT/MICRO SETTING/PPC/QC & REPAIR) has ZERO Office Staff peers with
--     a division set -- those departments otherwise only exist at Factory
--     Staff, same "possibly misplaced" pattern flagged in 20260917_8, still
--     unconfirmed either way.
--   - 7 more with a unique department and no peers to infer from at all
--     (ACCS, BAGGING & STONE, JADAI, SOCIAL MEDIA, plus 3 department=
--     'DEFAULT' placeholder-style records) -- need HR to fill in directly.
-- =============================================================

DO $$
DECLARE
  v_tenant_id  uuid;
  v_office_id  uuid;
  v_updated    int;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE company_name ILIKE '%Raniwala%' LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found';
  END IF;

  SELECT id INTO v_office_id FROM outlets WHERE tenant_id = v_tenant_id AND name = 'Office Staff' LIMIT 1;
  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'Raniwala Office Staff outlet not found';
  END IF;

  UPDATE profiles
  SET division = CASE department
    WHEN 'ADMIN'         THEN 'SUPPORT'
    WHEN 'B2B'           THEN 'B2B'
    WHEN 'B2C'           THEN 'B2C'
    WHEN 'ECOM'          THEN 'B2C'
    WHEN 'MERCHANDISING' THEN 'SUPPORT'
  END
  WHERE tenant_id = v_tenant_id
    AND outlet_id = v_office_id
    AND status = 'Active'
    AND (division IS NULL OR division = '')
    AND department IN ('ADMIN', 'B2B', 'B2C', 'ECOM', 'MERCHANDISING')
    AND essl_employee_code IN ('231','109','419','355','138','171','335','345');
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RAISE NOTICE 'Raniwala Office Staff division backfill: % profiles updated', v_updated;

  RAISE NOTICE 'Still flagged -- Office Staff, Factory-style department, no division, no sheet record (ESSL): %',
    (SELECT string_agg(essl_employee_code, ', ')
     FROM profiles WHERE tenant_id = v_tenant_id AND outlet_id = v_office_id AND status = 'Active'
       AND essl_employee_code IN ('732','600','753','703','564','589','646','751','445'));

  RAISE NOTICE 'Still flagged -- Office Staff, unique department, no peers, no sheet record (ESSL): %',
    (SELECT string_agg(essl_employee_code, ', ')
     FROM profiles WHERE tenant_id = v_tenant_id AND outlet_id = v_office_id AND status = 'Active'
       AND essl_employee_code IN ('312','570','692','347','229','767','135'));
END $$;
