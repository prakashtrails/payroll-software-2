-- Security audit 2026-09 lead "Employee PMS update policies do not restrict
-- management-owned fields" (pms/owner-update/unrestricted-management-fields).
--
-- The legacy kras / reviews tables stay in use by the mobile app. Their RLS
-- UPDATE policies constrain WHICH rows an employee may touch, not WHICH
-- columns, so an employee could rewrite their KRA's weight/title/period or
-- reassign their review's reporting_manager_id to a colleague (who would then
-- gain rating authority). These BEFORE UPDATE guards allow exactly the writes
-- both clients make and reject everything else:
--   • kras: an owner who is not admin/manager/superadmin may change only
--     progress_percent (app + web updateKraProgress / addKraCheckin).
--   • reviews: identity columns (tenant_id, cycle_id, profile_id,
--     reporting_manager_id) change only for admin/superadmin; a reviewee who
--     is not their own reporting manager may only move status
--     'Not Started' → 'In Progress' (submitReviewAnswer on web + app).
-- Server-side callers (auth.uid() IS NULL: service role, migrations, cron)
-- are not restricted.

CREATE OR REPLACE FUNCTION public.guard_kras_owner_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IN ('admin', 'manager', 'superadmin') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'progress_percent' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'progress_percent' - 'updated_at') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Employees can only update the progress of their own KRA.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_kras_owner_fields ON public.kras;
CREATE TRIGGER guard_kras_owner_fields BEFORE UPDATE ON public.kras
  FOR EACH ROW EXECUTE FUNCTION public.guard_kras_owner_fields();

CREATE OR REPLACE FUNCTION public.guard_reviews_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IN ('admin', 'superadmin') THEN RETURN NEW; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id
     OR NEW.profile_id IS DISTINCT FROM OLD.profile_id OR NEW.reporting_manager_id IS DISTINCT FROM OLD.reporting_manager_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only HR can reassign a review.';
  END IF;
  IF OLD.profile_id = auth.uid() AND OLD.reporting_manager_id IS DISTINCT FROM auth.uid() THEN
    IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at')
       OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'Not Started' AND NEW.status = 'In Progress')) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Employees can only start their own review.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_reviews_fields ON public.reviews;
CREATE TRIGGER guard_reviews_fields BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_reviews_fields();

REVOKE ALL ON FUNCTION public.guard_kras_owner_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_reviews_fields() FROM PUBLIC, anon, authenticated;
