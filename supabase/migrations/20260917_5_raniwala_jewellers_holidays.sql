-- =============================================================
-- Raniwala Jewellers — remaining 2026 holidays from HR (email dated
-- 2026-09-15), scoped per outlet using the outlet_id column added in
-- 20260917_4_outlet_scoped_holidays.sql.
--
-- Factory: Vishwakarma Jayanti (17 Sep), Durga Puja (17 Oct), Dussehra (20 Oct),
--          Diwali (9 Nov) — plus Gandhi Jayanti (2 Oct), shared with Office.
-- Office:  Diwali (7 Nov), Govardhan Puja (9 Nov), Bhai Dooj (10 Nov)
--          — plus Gandhi Jayanti (2 Oct), shared with Factory.
--
-- This only touches the "Raniwala Jewellers" tenant and its Factory/Office
-- outlets — every INSERT is scoped by a subquery on tenant/outlet name, so
-- it is a no-op for every other tenant.
-- =============================================================

DO $$
DECLARE
  v_tenant_id uuid;
  v_factory_id uuid;
  v_office_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE company_name ILIKE '%Raniwala%' LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found — check tenants.company_name and adjust the ILIKE pattern';
  END IF;

  SELECT id INTO v_factory_id FROM outlets WHERE tenant_id = v_tenant_id AND name ILIKE '%factory%' LIMIT 1;
  SELECT id INTO v_office_id  FROM outlets WHERE tenant_id = v_tenant_id AND name ILIKE '%office%'  LIMIT 1;
  IF v_factory_id IS NULL OR v_office_id IS NULL THEN
    RAISE EXCEPTION 'Could not find both a Factory and an Office outlet for Raniwala Jewellers — check outlets.name and adjust the ILIKE patterns (found factory=%, office=%)', v_factory_id, v_office_id;
  END IF;

  -- Shared: Gandhi Jayanti applies to the whole company.
  INSERT INTO holidays (tenant_id, outlet_id, name, date, type)
  VALUES (v_tenant_id, NULL, 'Gandhi Jayanti', '2026-10-02', 'National holiday')
  ON CONFLICT (tenant_id, outlet_id, date) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type;

  -- Factory-only.
  INSERT INTO holidays (tenant_id, outlet_id, name, date, type) VALUES
    (v_tenant_id, v_factory_id, 'Vishwakarma Jayanti', '2026-09-17', 'Festival'),
    (v_tenant_id, v_factory_id, 'Durga Puja',           '2026-10-17', 'Festival'),
    (v_tenant_id, v_factory_id, 'Dussehra',             '2026-10-20', 'Festival'),
    (v_tenant_id, v_factory_id, 'Diwali',               '2026-11-09', 'Festival of lights')
  ON CONFLICT (tenant_id, outlet_id, date) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type;

  -- Office-only.
  INSERT INTO holidays (tenant_id, outlet_id, name, date, type) VALUES
    (v_tenant_id, v_office_id, 'Diwali',          '2026-11-07', 'Festival of lights'),
    (v_tenant_id, v_office_id, 'Govardhan Pooja', '2026-11-09', 'Festival'),
    (v_tenant_id, v_office_id, 'Bhai Dooj',       '2026-11-10', 'Festival')
  ON CONFLICT (tenant_id, outlet_id, date) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type;
END $$;
