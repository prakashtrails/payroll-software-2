-- =============================================================
-- Fixes a duplicate leave_types row created by
-- 20260924_1_raniwala_leave_types_policy.sql: that migration didn't know
-- Raniwala already had a leave type named exactly "Misfortune
-- (Bereavement) Leave" (pre-existing, id 78ed6de8-8ea5-4561-8cf4-
-- d64af55c553e), so its ON CONFLICT (tenant_id, name) on the shorter name
-- "Misfortune Leave" missed it and inserted a second, redundant row
-- (id 5f0ad296-2881-404b-887a-d3acb9f0753a) instead of updating the
-- existing one.
--
-- Confirmed safe to delete outright (not just deactivate): the duplicate
-- was created moments ago by that same migration and nothing was ever
-- allocated against it -- 20260924_2_raniwala_leave_balance_dob_import.sql
-- only ever writes to the 'Earned Leave' type, so no leave_ledger row can
-- reference "Misfortune Leave". The guard below aborts instead of
-- deleting if that assumption ever turns out to be wrong.
-- =============================================================

DO $$
DECLARE
  v_tenant  uuid;
  v_dupe_id uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  SELECT id INTO v_dupe_id FROM leave_types
    WHERE tenant_id = v_tenant AND name = 'Misfortune Leave';

  IF v_dupe_id IS NULL THEN
    RAISE NOTICE 'No "Misfortune Leave" duplicate found for Raniwala -- nothing to do (already fixed?)';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM leave_ledger WHERE leave_type_id = v_dupe_id) THEN
    RAISE EXCEPTION 'Refusing to delete "Misfortune Leave" (id %) -- it has leave_ledger rows referencing it', v_dupe_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM leave_types WHERE tenant_id = v_tenant AND name = 'Misfortune (Bereavement) Leave') THEN
    RAISE EXCEPTION 'Refusing to delete "Misfortune Leave" -- no "Misfortune (Bereavement) Leave" row exists to keep instead';
  END IF;

  DELETE FROM leave_types WHERE id = v_dupe_id;
  RAISE NOTICE 'Deleted duplicate "Misfortune Leave" leave_types row (id %) for Raniwala', v_dupe_id;
END $$;
