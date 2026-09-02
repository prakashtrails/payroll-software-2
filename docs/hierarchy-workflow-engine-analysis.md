# CrewCore Hierarchy, RBAC &amp; Approval Workflow Engine — Architecture Analysis

Status: **pre-implementation analysis**, produced per the feature spec's explicit requirement to inspect the existing system before writing code. Nothing in this document has been implemented yet.

---

## 1. Current Architecture (factual summary)

CrewCore is a Supabase (Postgres + Auth + Edge Functions) backend with a React/Vite frontend, multi-tenant via a `tenant_id` column on nearly every table.

- **Identity/tenant**: one `profiles` row per `auth.users` id, holding `tenant_id`, a flat `role` string (`superadmin|admin|manager|employee`), and all employee fields (department as free text, designation as free text, outlet_id).
- **Authorization today**: entirely `my_role()`/`my_tenant_id()` SQL helper functions consulted inline inside hundreds of individual RLS policies (`role = 'admin' AND tenant_id = my_tenant_id()`), plus edge functions that re-check `profiles.role`/`tenant_id` server-side via the service-role client before doing privileged writes. There is no roles/permissions table, no scopes, no reporting-chain resolution.
- **Approval routing today**: a **quota-tiered self-service** model (`request_quotas` + `determineApproverRole`) — not a hierarchy walk. The first N requests/month self-approve, the next M need a manager, beyond that an admin. An optional per-tenant `approval_chains` table can override the *first* approver role, but the migration itself documents that only step 1 is acted on — there's no multi-step engine.
- **UI role-gating**: client-side only (`PrivateRoute` in `App.jsx`), routes literally duplicated per role (`/leaves`, `/manager-leaves`, `/my-leaves` all rendering the same component). Real enforcement is RLS.
- **Prior art worth reusing directly**: the `features` / `company_feature_toggles` system (global registry → tenant override → outlet override → default-enabled) is the one existing "tenant-configurable behavior" mechanism in the codebase, superadmin-governed, and is a good template for how hierarchy/workflow configuration should be exposed.
- **Notifications**: fire-and-forget, client-triggered inserts into `app_notifications`, fanned out by role at write time (no subscription/trigger model). Every approval-adjacent service hand-writes its own notify call.
- **Audit**: narrow and table-specific (`attendance_audit_log`); append-only ledgers (`leave_ledger`, `fnf_settlements`) are written exclusively by SECURITY DEFINER RPCs, giving immutability without a generic audit framework. No audit trail exists for role changes or approval decisions as a sequence.

## 2. Existing Schema (relevant tables today)

```
tenants(id, company_name, domain, group_code, group_name, ...)
profiles(id, tenant_id, role, department[text], designation[text], manager_id, outlet_id, ...)
departments(id, tenant_id, name)                 -- NOT FK'd from profiles.department
outlets(id, tenant_id, name, address, city, is_active)
profile_outlet_access(profile_id, outlet_id)     -- secondary outlet access, not reporting
request_quotas(tenant_id, profile_id, month, year, self_approved_count, manager_approved_count)
approval_chains(tenant_id, entity_type, steps jsonb[{role,order}], is_active)   -- first-step-only override
leave_requests / wfh_requests / expense_claims / regularize_requests / special_requests
   (status, approved_by/reviewed_by, required_approver_role, approval_level)
grievances(status)                                -- no approver routing at all
headcount_requests / interviews / offer_letters / referrals(stage)  -- fixed-enum pipeline (recruitment)
onboarding_processes / offboarding_processes / *_process_tasks(assigned_to, status)  -- checklist, not approval
app_notifications(tenant_id, profile_id, actor_id, type, title, body, link_key, related_id, is_read)
features(key) / company_feature_toggles(tenant_id, outlet_id, feature_key, enabled)
attendance_audit_log(tenant_id, attendance_id, profile_id, changed_by, action, old/new_status)
```

Key gaps relative to the spec: no `roles`/`permissions` tables (role is a hardcoded string), no department-FK on profiles, no multi-level hierarchy (only one `manager_id` hop, used solely by the performance module), no HOD concept, no location-independent-of-outlet concept, no workflow definition/version/instance tables, no generic approval-action/audit-trail table, no delegation/escalation tables.

## 3. Proposed Schema Changes

New tables (additive only — nothing existing is dropped or renamed):

```sql
-- Org structure
hierarchy_levels(id, tenant_id, name, rank int, created_at)        -- tenant-defined level names, ordered
designations(id, tenant_id, name, hierarchy_level_id, department_id nullable)
locations(id, tenant_id, name, parent_location_id nullable)        -- supersedes ad-hoc outlet-as-location use;
                                                                     -- outlets stays as-is, gets location_id FK added

-- RBAC
roles(id, tenant_id nullable, name, is_system bool)                 -- tenant_id NULL = global template
permissions(id, key, category, description)                         -- global catalog, superadmin-managed
role_permissions(role_id, permission_id, scope)                     -- scope: SELF|DIRECT_REPORTS|TEAM|DEPARTMENT|LOCATION|MULTIPLE_DEPARTMENTS|ENTIRE_TENANT|GLOBAL
user_roles(profile_id, role_id, department_id nullable, location_id nullable, valid_from, valid_to nullable)
                                                                     -- role assignment is scoped, not global per user

-- Reporting relationships (generalizes profiles.manager_id)
reporting_relationships(id, tenant_id, profile_id, related_profile_id, relationship_type, is_primary, valid_from, valid_to)
  -- relationship_type: DIRECT_MANAGER | FUNCTIONAL_MANAGER | DEPARTMENT_HEAD | HR_PARTNER | APPROVER | REVIEWER | ESCALATION_MANAGER

-- Workflow engine
workflow_definitions(id, tenant_id, workflow_type, name, status)     -- status: DRAFT|PUBLISHED|ARCHIVED
workflow_versions(id, workflow_definition_id, version_no, status, published_at)
workflow_steps(id, workflow_version_id, step_order, approver_type, approver_role_id nullable, specific_profile_id nullable,
                action_on_timeout, timeout_hours, escalation_target)
workflow_conditions(id, workflow_version_id, field, operator, value, applies_to_step_id)  -- e.g. leave_days>2 -> include HOD step
workflow_instances(id, workflow_version_id, entity_type, entity_id, tenant_id, status, current_step_order, created_at)
approval_actions(id, workflow_instance_id, step_order, approver_id, action, comment, acted_at)  -- immutable, insert-only

-- Delegation / escalation
approval_delegations(id, tenant_id, delegator_id, delegate_id, starts_at, ends_at, scope)

-- Audit (generic, additive alongside attendance_audit_log which stays)
audit_logs(id, tenant_id, actor_id, action, target_type, target_id, old_value jsonb, new_value jsonb, created_at)
```

`profiles.manager_id`, `profiles.department`, `profiles.designation`, `profiles.role` are **kept** for backward compatibility (existing RLS/UI keep working unmodified during rollout) but become **derived/synced** from the new tables rather than sources of truth once migrated — see §4.

## 4. Migration Plan (backward-compatible, phased)

1. **Additive schema only** — create all new tables above with RLS mirroring the existing `tenant_id = my_tenant_id()` pattern; zero impact on existing tables/data.
2. **Backfill**: for every tenant, seed `hierarchy_levels` with the default 5-level template (HR/Company Admin → HOD → Manager → Employee, mapped from existing `role` values), seed one `roles` row per legacy role string (`is_system=true`) with `role_permissions` reproducing today's exact RLS-implied access (so behavior is unchanged at cutover), and backfill `reporting_relationships` (`DIRECT_MANAGER`) from existing `profiles.manager_id` where present.
3. **Dual-write bridge period**: keep `profiles.role`/`manager_id` as-is; add a trigger or service-layer sync so writes to the new `user_roles`/`reporting_relationships` tables keep the legacy columns updated (and vice versa), so existing RLS policies (`my_role()`) keep working unchanged while new code reads from the new tables.
4. **New `AuthorizationService`/`ScopeResolver`** (server-side, see §6) becomes the source of truth for new features (workflow engine, new approval UIs); old RLS policies are left alone — not rewritten — until each module is individually migrated, to avoid a big-bang RLS rewrite.
5. **Per-module cutover**: pick one existing flow at a time (start with attendance-correction/regularize, since the spec uses it as the worked example) to run through the new `WorkflowEngine` instead of `request_quotas`, behind a `features` toggle (reusing the existing feature-toggle infrastructure) so it can be enabled per tenant and rolled back instantly.
6. **Never drop** `request_quotas`/`approval_chains`/legacy columns until every consuming module has been migrated and verified in production for a full billing cycle.
7. Test existing attendance/punch-in-out and ESSL sync after every migration step (explicit spec requirement) — these are untouched by this design (no changes to `punches`/ESSL tables) but share `profiles`, so regression-test them anyway.

## 5. API Architecture

New versioned REST surface, implemented as Supabase Edge Functions (matching existing pattern of privileged server-side functions with manual role/tenant re-checks — no framework change):

```
GET/POST/PATCH   /api/v1/hierarchy-levels
GET/POST/PATCH   /api/v1/roles, /api/v1/roles/:id/permissions
GET              /api/v1/employees/:id/reporting-chain
GET/POST/PATCH   /api/v1/workflows, POST /api/v1/workflows/:id/publish, POST /api/v1/workflows/:id/test
POST             /api/v1/requests                       -- generic: {entity_type, entity_id} -> resolves workflow, creates instance
POST             /api/v1/requests/:id/approve|reject|escalate
GET              /api/v1/tenants/:id/org-summary          -- counts for §18 dashboard
```

Every endpoint re-derives `tenant_id` and caller role/scope server-side from `profiles`/`user_roles` exactly like existing edge functions do — never trusts client-supplied `tenant_id` or role (this is already the codebase's convention; keep it).

## 6. Authorization Architecture

Introduce a small set of server-side services (implemented as SQL SECURITY DEFINER functions + a thin edge-function layer, consistent with the codebase's existing RPC-heavy style rather than introducing a new app-server framework):

- **PermissionService**: `has_permission(profile_id, permission_key)` → checks `user_roles → role_permissions`.
- **ScopeResolver**: `resolve_scope(profile_id, permission_key)` → returns one of `SELF|DIRECT_REPORTS|TEAM|DEPARTMENT|LOCATION|MULTIPLE_DEPARTMENTS|ENTIRE_TENANT|GLOBAL`, and a materialized set of `profile_id`s that scope currently covers (see §31 on caching this).
- **HierarchyService**: `get_reporting_chain(profile_id)` walks `reporting_relationships` up to the tenant root, respecting `relationship_type` and `is_primary`, with delegation substitution from `approval_delegations` applied at read time (never mutating the underlying chain).
- **AuthorizationService**: composes the above into a single `can(profile_id, permission_key, target_profile_id)` check, callable from RLS policies (as a `SECURITY DEFINER` helper, same style as today's `my_role()`) and from edge functions.

This directly generalizes the existing `my_role()`/`my_tenant_id()` pattern rather than replacing it with something foreign to the codebase.

## 7. Hierarchy Architecture

- Hierarchy is **per-tenant, per-department-optional**, stored as `hierarchy_levels` (ordered ranks) + `reporting_relationships` (typed edges) rather than a rigid fixed-depth tree — matches the spec's "unlimited levels, tenant-customizable" requirement.
- Resolution is **read-time graph walk** (bounded by `rank` to prevent cycles/infinite loops — enforce `rank` strictly increasing along `DIRECT_MANAGER` edges via a CHECK/trigger), not a materialized closure table initially (see §31 for when to add one).
- Department-scoped hierarchies (spec §11) fall out naturally: `reporting_relationships` rows carry no department field themselves, but `ScopeResolver` intersects the reporting-chain result with `user_roles.department_id`/`location_id` before granting access — so a Sales Manager's `DIRECT_REPORTS` scope is already department-bounded by construction.

## 8. Workflow Architecture

`workflow_definitions` → `workflow_versions` (draft/published/archived) → `workflow_steps` (+ `workflow_conditions` for branching, e.g. leave-days thresholds) → at request time, `WorkflowEngine.resolve(entity_type, employee_id, payload)`:

```
find PUBLISHED workflow_version for tenant+workflow_type
  → evaluate workflow_conditions against payload (amount, days, department, location, employee_type)
  → walk employee's reporting_relationships to bind each step's approver_type (MANAGER/HOD/HR/...) to a concrete profile_id,
    substituting an active approval_delegations row if present
  → create workflow_instances row (pinned to this version_no — versioning requirement from spec §15)
  → create pending approval_actions placeholder + notify first approver (reusing existing notificationService fan-out pattern)
```

Existing per-module services (`leaveService.requestLeave`, `wfhService`, etc.) call this engine instead of `determineApproverRole`/`approval_chains` once migrated (§4 step 5); `request_quotas`'s self-approval concept becomes step 0 with `action=AUTO_APPROVE` condition, so tenants that like the current quota behavior can keep it as one configured workflow rather than losing it.

## 9. UI Architecture

- **Super Admin**: new section under existing `Tenants` management (`src/pages/dashboard/TenantsPage.jsx` is the natural parent) — `Organization Structure`, `Hierarchy Builder` (tree, click-to-configure), `Roles & Permissions` (matrix), `Workflow Builder` (canvas), `Audit Logs`. Reuses `ToggleServicesPage.jsx`'s existing feature-toggle UI pattern for workflow enable/disable per tenant.
- **Tenant Admin/HR**: scoped view of the same builder UIs, restricted to their own tenant (no cross-tenant list).
- **Manager/HOD/Employee**: no new pages needed structurally — existing `MyLeavesPage`/`ManagerDashboardPage`/etc. gain an "approval timeline" component (reusable, driven by `workflow_instances`+`approval_actions`) replacing today's flat `status` badge.
- Route/permission gating: keep `PrivateRoute`'s existing shape, but source `allowedRoles`/scope checks from `AuthorizationService.can()` results fetched at session load, rather than hardcoded role-string arrays — this can happen incrementally per route.

## 10. Security Risks

- **Biggest risk**: the dual-write bridge (§4.3) — if the sync between legacy `profiles.role`/`manager_id` and new `user_roles`/`reporting_relationships` drifts, RLS (still keyed on `my_role()`) and the new engine (keyed on `user_roles`) could disagree, creating either a lockout or an authorization bypass. Mitigate with a scheduled reconciliation check + alert, not just a trigger.
- Multi-step approval must be enforced **server-side only** (spec §32) — the existing codebase's RLS-per-table convention needs approval-step RLS added on `approval_actions`/`workflow_instances` so a client can't insert an "approve" action out of order or for a step it doesn't own; mirror the same `SECURITY DEFINER` + manual role re-check pattern already used by every edge function.
- Cross-tenant leakage: every new table needs the same `tenant_id = my_tenant_id()` policy convention already audited/hardened repeatedly in this codebase (§9 in the inventory lists 6+ prior security-patch migrations for exactly this class of bug) — new tables should reuse the `20260810_rls_wrap_functions.sql` wrapped-function pattern from day one rather than needing a follow-up hardening pass.
- Role self-escalation: `user_roles` writes need the same `ROLE_HIERARCHY` ceiling check already implemented in `create-employee-user/index.ts` — a manager must not be able to grant themselves HR permissions via the new permission-assignment UI.

## 11. Performance Risks

- Reporting-chain walks (`HierarchyService.get_reporting_chain`) are recursive and must not run per-row on list pages (e.g. "show all requests I can approve" for an HR user with `ENTIRE_TENANT` scope should not walk the graph per request row). Precompute/cache `ScopeResolver`'s profile-id-set per (profile, permission) with a short TTL or a materialized view refreshed on `reporting_relationships` change, rather than recursive CTEs on every read.
- Indexes needed on new tables: `reporting_relationships(tenant_id, profile_id)`, `(tenant_id, related_profile_id)`, `user_roles(profile_id)`, `workflow_instances(tenant_id, status)`, `approval_actions(workflow_instance_id)`.
- Avoid N+1 when rendering the hierarchy tree — one query per tenant fetching all `reporting_relationships`+`profiles` and assembling the tree client-side, not per-node queries (same pattern already used by `listActiveEmployees`).

## 12. Implementation Plan (phased, respects "don't break existing CrewCore")

**Phase 0** (this document) — inspection + analysis. Done.

**Phase 1 — Schema + backend core** (no UI, no behavior change): new tables from §3, RLS, backfill script (§4.1–4.2), `AuthorizationService`/`HierarchyService`/`ScopeResolver` SQL functions, unit-testable in isolation. Verify existing attendance/leave/punch flows untouched.

**Phase 2 — Workflow engine + one pilot module**: `workflow_definitions/versions/steps/instances/approval_actions`, `WorkflowEngine.resolve()`, cut over **regularize/attendance-correction** (the spec's own worked example) behind a feature toggle. Keep `request_quotas` path as fallback for tenants with the toggle off.

**Phase 3 — Super Admin UI**: Hierarchy Builder tree, Roles & Permissions matrix, Workflow Builder canvas with Test-Workflow mode, Audit Logs viewer — all read/write against Phase 1–2 backend, scoped to `/super-admin` route family already reserved for superadmin (§10 inventory).

**Phase 4 — Roll remaining modules onto the engine one at a time**: leave (with day-count conditions), expense (with amount conditions), WFH, transfers — each behind its own toggle, each with the legacy path kept until verified.

**Phase 5 — Delegation, escalation, notifications-on-timeout**: `approval_delegations`, scheduled job (reuse existing pg_cron pattern from `essl-web-poll` cron migrations) for SLA/escalation checks.

**Phase 6 — Retire bridge**: once all modules are migrated and stable for a full cycle, drop the dual-write sync and legacy quota/approval_chains tables (only with explicit sign-off — spec requires preserving existing data/functionality, so this is a "someday", not part of the initial delivery).

---

### Open questions for the user before Phase 1 starts

1. Given the size of this (a multi-week build touching every portal), do you want it delivered phase-by-phase with review checkpoints (recommended), or should I keep going autonomously through all phases?
2. Should Phase 2's pilot module be attendance-correction/regularize as the spec's example suggests, or would you rather pilot on leave (higher-traffic, more visible)?
3. There are ~50 already-modified/untracked files on this branch (`Suraj-Updates`) unrelated to this feature (notifications, feature toggles, ESSL, onboarding/offboarding, etc.) — should those be committed first so this new work starts from a clean diff, or should hierarchy/workflow work land in the same branch alongside them?
