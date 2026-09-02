# ESSL Sync Agent

Bridges a tenant's on-premise ESSL biometric punch machine into CrewCore
attendance. The ESSL machine itself only talks to its local eTimeTrackLite
software on a nearby Windows PC — it has no internet access — so this agent
runs on that PC, reads new punch logs out of eTimeTrackLite's local
database, and pushes them to CrewCore over HTTPS.

```
ESSL machine → eTimeTrackLite (local PC + MySQL) → this agent → CrewCore essl-punch Edge Function → attendance/punches tables (PostgreSQL)
```

The agent is the translation layer between the two databases — it reads
MySQL, converts each row to plain JSON, and sends that over HTTPS. MySQL and
PostgreSQL never talk to each other directly, so the difference in database
engines doesn't matter beyond this one file.

Once running, an employee punching the physical machine shows up as
Present/Late/Half Day in CrewCore exactly as if they'd clocked in/out through
the app — same status rules, same audit trail (tagged `source: 'device'` on
the punch).

## One-time setup

### 1. Register the device in CrewCore (superadmin/DB access required)

Insert a row in `essl_devices` for this tenant — either via a small admin
script or directly in Supabase:

```sql
insert into essl_devices (tenant_id, outlet_id, name)
values ('<tenant-uuid>', '<outlet-uuid-or-null>', 'Main Gate ESSL')
returning api_key;
```

Copy the returned `api_key` — you'll need it in step 3.

### 2. Map each employee to their ESSL code

In CrewCore, open **Employees → Edit** for each employee and fill in
**"ESSL / Biometric Employee Code"** with the numeric ID assigned to them on
the ESSL device/enrolment software. A punch for a code with no match is
skipped and reported back (not silently dropped) so you can fix the mapping.

### 3. Confirm your eTimeTrackLite schema

Table/column names vary slightly by eTimeTrackLite version, and by whether
the install runs on MySQL or SQL Server — set `DB_TYPE` in `.env` accordingly.

**MySQL** (`DB_TYPE=mysql`, the default) — one growing table. Open a MySQL
client (MySQL Workbench, HeidiSQL, DBeaver, or the command-line `mysql`
client) against the eTimeTrackLite database and confirm:

- The table holding raw punch logs (commonly `DeviceLogs`)
- The employee-code column (commonly `UserId`)
- The punch-timestamp column (commonly `LogDate`)
- The in/out column (commonly `Direction`, values like `IN`/`OUT` or `0`/`1`)

```sql
SELECT * FROM DeviceLogs ORDER BY LogDate DESC LIMIT 20;
```

**SQL Server** (`DB_TYPE=mssql`) — punch logs are split into one table per
calendar month (`DeviceLogs_<month>_<year>`, e.g. `DeviceLogs_8_2026`), and
the identity column restarts each month, so the agent tracks the checkpoint
per table and recomputes the current month's table name every cycle — no
`.env` change needed at month-end. Open SQL Server Management Studio and
confirm against the current month's table:

- The identity/primary key column (commonly `DeviceLogId`)
- The employee-code column (commonly `UserId`)
- The punch-timestamp column (commonly `LogDate`)
- The in/out column (commonly `Direction`, values like `in`/`out`)

```sql
SELECT TOP 20 * FROM DeviceLogs_8_2026 ORDER BY DeviceLogId DESC;
```

Connect with a **dedicated read-only login** — never the vendor app's own
account — scoped to `db_datareader` only, so the agent is structurally
incapable of writing to eTimeTrackLite even if this script had a bug:

```sql
CREATE LOGIN crewcore_sync_reader WITH PASSWORD = 'choose-a-strong-password';
USE eTimeTrackLite1; -- your actual database name
CREATE USER crewcore_sync_reader FOR LOGIN crewcore_sync_reader;
ALTER ROLE db_datareader ADD MEMBER crewcore_sync_reader;
```

Run the agent on the same PC as SQL Server and connect via
`ESSL_DB_HOST=localhost` + `ESSL_DB_INSTANCE=SQLEXPRESS` (or whatever the
instance is named) — that resolves to a local Shared Memory connection, so
nothing needs to be opened on the network/firewall side for this at all.

If your install differs from either shape above, adjust the `ESSL_DB_*`
values in `.env` — no code changes needed.

### 4. Configure and install

```
cp .env.example .env
# fill in ESSL_DB_*, CREWCORE_ESSL_PUNCH_URL, CREWCORE_DEVICE_API_KEY
npm install
npm run sync-once   # test a single sync — check console output
```

`CREWCORE_ESSL_PUNCH_URL` is `https://<project-ref>.supabase.co/functions/v1/essl-punch`.

### 5. Run continuously

For a permanent install on the PC, either:

- `npm start` inside a process manager (e.g. [pm2](https://pm2.keymetrics.io/), or NSSM to run it as a Windows Service), or
- Schedule `npm run sync-once` on a Windows Task Scheduler trigger (every 1–5 minutes) instead of running it as a long-lived process.

## Troubleshooting

- **"Unmapped codes" in the log output** — that ESSL employee code has no
  matching `essl_employee_code` on any profile in this tenant. Add it in
  Employees → Edit.
- **Nothing syncs** — verify the DB connection first with
  `npm run sync-once` and check the SQL error; then verify
  `CREWCORE_DEVICE_API_KEY` matches an active row in `essl_devices`.
- **First run looks slow / floods old punches** — first run only looks back
  24h (see `state.json`, auto-created). Delete `state.json` to reset.
