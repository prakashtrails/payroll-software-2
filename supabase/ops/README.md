# Ops scripts — run by hand, with care

One-off maintenance SQL for the Supabase SQL editor. They are **not**
migrations and must never be applied automatically.

| File | What it does | Risk |
|---|---|---|
| `check_migration_objects.sql`, `check_pending_migrations.sql` | Read-only checks of which tables/functions exist | Safe |
| `step1_preview_orphaned_users.sql` | Lists auth users with no profile | Safe (read-only) |
| `step2_delete_orphaned_users.sql`, `delete_orphaned_auth_users.sql` | Deletes those auth users | **Destructive** |
| `delete_test_companies.sql` | Deletes named test companies | **Destructive** |
| `reset_pre_launch.sql` | Deletes every company and user except the super admin | **Wipes production — never run now that clients are live** |

Before running anything destructive: read the whole file, run its preview
step first, and confirm the target is the test tenant.
