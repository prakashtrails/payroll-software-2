-- =============================================================
-- Fix: creating any new employee failed (26 Sep 2026).
--
-- Auth's admin createUser runs as supabase_auth_admin with search_path
-- "auth". Its on_auth_user_created trigger (handle_new_user) inserts into
-- public.profiles, which fires trg_profiles_uppercase_user_data (added in
-- 20260925_2). That function reads `tenants` unqualified and had no
-- search_path of its own, so under auth's search_path it raised
-- relation "tenants" does not exist, and the whole signup rolled back.
-- The web showed a 400 from create-employee-user.
--
-- Pin search_path on the three functions that fire on a new user.
-- No logic changes.
-- =============================================================

ALTER FUNCTION public.trg_profiles_uppercase_user_data() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.profiles_clear_stale_verification() SET search_path = public;
