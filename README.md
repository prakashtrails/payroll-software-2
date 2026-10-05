# CrewCore — HR, Payroll & Workforce Platform

Multi-tenant HRMS web app for Indian businesses: employees, attendance (geofence, ESSL biometric sync, punch approvals, live tracking), leave and requests, payroll and payslips, tasks and reminders, performance management (PMS), hiring and a public careers page, help center and an AI assistant.

The **CrewCore mobile app** (Expo / React Native) is a separate repository that uses the **same Supabase database**. Business rules therefore live in the database (RLS, triggers, RPCs) so both clients behave the same — see "Shared database contract" below.

| | |
|---|---|
| Frontend | React 19 + Vite, React Router, plain CSS (`src/index.css`) |
| Backend | Supabase: Postgres + RLS, RPCs, pg_cron, pg_net, Storage, Edge Functions (Deno) |
| AI | Claude API (`claude-opus-5-5`) via edge functions |
| Messaging | Gmail SMTP (email OTP + task email), MSG91 (SMS OTP, WhatsApp), Slack incoming webhooks, Expo push |
| Hosting | Production web app on Hostinger (crewcore.in); `vercel.json` for Vercel builds; Cloudflare worker in `cloudflare/` |

## Getting started

```bash
npm ci
cp .env.example .env    # or create .env with the variables below
npm run dev             # http://localhost:5173
```

`.env` (never commit it — `.env*` is git-ignored):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public anon / publishable key>
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint (flat config in `eslint.config.js`) |
| `npm run test:unit` | Node test runner, `tests/unit/*.test.mjs` |
| `npm run test:e2e` | Playwright, `tests/e2e/*` — needs `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` of a **test** tenant |

## Project layout

```
src/
  pages/            route screens (dashboard/, employee/, auth/, home/, public HomePage, CareersPage, ErpPage)
  components/       shared UI (Sidebar, Header, Modal, AssistantWidget, NotificationChannelsCard, …)
  features/         larger feature modules (performance/ = PMS)
  services/         one file per domain; all Supabase calls live here
  context/          Auth, Feature toggles, Notifications, Outlet view
  lib/              helpers, featureRegistry (feature keys), helpContent (Help/FAQ + AI knowledge),
                    notificationLinks, siteContent (public website copy)
supabase/
  migrations/       SQL migrations, named YYYYMMDD_N_description.sql
  functions/        edge functions (Deno); _shared/ holds common code
  tests/            rollback-only SQL tests (safe on any database)
  ops/              hand-run maintenance scripts — some are destructive, read ops/README.md
  legacy/           pre-migrations SQL kept for history — do not run
tests/unit, tests/e2e
docs/               design notes, costing, client docs
scripts/            essl-sync-agent (on-site ESSL biometric sync agent)
cloudflare/         API worker
```

## Database & migrations

- Every schema change is a file in `supabase/migrations/` **and** is applied to the database. Write migrations **re-runnable** (`IF NOT EXISTS`, `DROP … IF EXISTS` before `CREATE POLICY`/`ADD CONSTRAINT`).
- Apply one file: `npx supabase db query --linked -f supabase/migrations/<file>.sql`.
  **Never run `supabase db push`** — the remote history contains migrations applied by other teams/tools, so local and remote versions don't line up.
- Before changing an existing table/function, read its **live** definition (`pg_get_functiondef`, `pg_constraint`) — the repo is not always complete.
- Test risky changes first inside a transaction that ends with `RAISE EXCEPTION` (everything rolls back). Impersonate users with `set_config('request.jwt.claims', …)` + `role authenticated`, using the **test tenant only**.

### Shared database contract (web + mobile app)

- Put rules in the DB (RLS, triggers, RPCs), not only in React code.
- Rows written by the app carry `source = 'app'` where a `source` column exists (`project_tasks`, policy acknowledgements, …).
- Notifications go to `app_notifications` (`link_key` + `related_id`); a DB webhook turns each row into an Expo push.

## Edge functions

Deploy: `npx supabase functions deploy <name> --project-ref <ref>`. Secrets: `npx supabase secrets set NAME=value --project-ref <ref>`.

| Function | Purpose | Secrets beyond the Supabase defaults |
|---|---|---|
| `send-otp` / `verify-otp` | Email OTP login/signup; verify also handles SMS OTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| `send-sms-otp` | SMS OTP via MSG91 (login only, registered numbers) | `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID` |
| `notification-dispatch` | Task alerts/reminders to Slack, email, WhatsApp from `notification_outbox` | SMTP_* (above), `MSG91_AUTH_KEY`, `MSG91_WA_NUMBER`, `MSG91_WA_TEMPLATE`, `MSG91_WA_LANG`, `APP_URL` |
| `ai-assistant` / `ai-meeting-extract` | AI chat assistant / meeting transcript → tasks | `ANTHROPIC_API_KEY` |
| `careers-apply` | Public job application from `/careers/:slug` | — |
| `push-app-notification`, `send-notification` | Expo push | see function header |
| `essl-*` | ESSL biometric feed sync | see function header |
| `create-tenant`, `create-employee-user`, `update-employee-*`, `reset-employee-password` | Admin account operations | see function header |

Costs and go-live steps for MSG91, WhatsApp, Slack and Claude: `docs/crewcore-messaging-and-ai-costing.md`.

## Feature toggles

Every module has a key in `src/lib/featureRegistry.js` (synced to the `features` table when the super admin opens Toggle Services). Premium keys (`is_premium: true`, e.g. `live_tracking`, `ai_assistant`, `ai_meetings`) are **off** for every company until switched on per company. Gate routes with `featureKey` on `PrivateRoute` and sidebar items with `featureKey`.

## Branches & contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
