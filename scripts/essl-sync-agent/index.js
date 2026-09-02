// Polls the local ESSL/eTimeTrackLite database for new punch logs and pushes
// them to CrewCore's essl-punch Edge Function so employees who punch the
// physical machine show up as clocked in/out in the app too.
//
// Supports two eTimeTrackLite install types via DB_TYPE:
//   - mysql (default): a single growing punch-log table, checkpointed by timestamp.
//   - mssql: SQL Server installs, which partition punch logs into one table per
//     calendar month (e.g. DeviceLogs_8_2026) with an identity column that
//     restarts each month — so the checkpoint is (table name, last id) instead
//     of a timestamp, and the agent recomputes the target table every cycle.
//
// Run continuously with `npm start` (polls every ESSL_SYNC_INTERVAL_SECONDS),
// or once with `npm run sync-once` (e.g. from Windows Task Scheduler).
//
// State is kept in state.json next to this script, so a restart resumes where
// it left off instead of re-sending everything.

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

const dbType = (process.env.DB_TYPE || 'mysql').toLowerCase();

const config = {
  dbType,
  dbHost: process.env.ESSL_DB_HOST || 'localhost',
  dbPort: parseInt(process.env.ESSL_DB_PORT || (dbType === 'mssql' ? '1433' : '3306'), 10),
  dbInstance: process.env.ESSL_DB_INSTANCE || '',       // mssql only, e.g. SQLEXPRESS
  dbName: process.env.ESSL_DB_NAME,
  dbUser: process.env.ESSL_DB_USER,
  dbPassword: process.env.ESSL_DB_PASSWORD,
  table: process.env.ESSL_DB_TABLE || 'DeviceLogs',      // mysql: fixed table name
  tablePrefix: process.env.ESSL_DB_TABLE_PREFIX || 'DeviceLogs', // mssql: monthly-partitioned prefix
  colUserId: process.env.ESSL_DB_COL_USER_ID || 'UserId',
  colLogTime: process.env.ESSL_DB_COL_LOG_TIME || 'LogDate',
  colDirection: process.env.ESSL_DB_COL_DIRECTION || 'Direction',
  colId: process.env.ESSL_DB_COL_ID || 'DeviceLogId',    // mssql only — the per-table identity checkpoint column
  directionInValues: (process.env.ESSL_DIRECTION_IN_VALUES || 'IN,I,0').split(',').map((v) => v.trim().toUpperCase()),
  punchUrl: process.env.CREWCORE_ESSL_PUNCH_URL,
  apiKey: process.env.CREWCORE_DEVICE_API_KEY,
  anonKey: process.env.CREWCORE_SUPABASE_ANON_KEY,
  intervalSeconds: parseInt(process.env.ESSL_SYNC_INTERVAL_SECONDS || '60', 10),
};

function assertConfigured() {
  const missing = ['dbHost', 'dbName', 'punchUrl', 'apiKey', 'anonKey'].filter((k) => !config[k]);
  if (missing.length) {
    console.error(`Missing required .env values: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    // First run — start from 24h ago (mysql) / id 0 on the current month's
    // table (mssql) rather than the dawn of the table, so a fresh install
    // doesn't try to replay the device's entire punch history.
    return config.dbType === 'mssql'
      ? { table: null, lastId: 0 }
      : { lastSyncedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Local calendar date/time components — the ESSL device and this PC are
// assumed to be in the office's own timezone, so no UTC conversion here
// mirrors how the CrewCore app itself derives "today"/"now" client-side.
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toTimeStr(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "YYYY-MM-DD HH:MM:SS" using local components — matches how eTimeTrackLite
// stores naive local datetimes in MySQL, so a plain string comparison against
// the DATETIME column works without any timezone conversion surprises.
function toMysqlDateTime(d) {
  return `${toDateStr(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// eTimeTrackLite's SQL Server builds split punch logs into one table per
// calendar month, named e.g. DeviceLogs_8_2026 for August 2026 — no leading
// zero on the month.
function currentMonthTable(d = new Date()) {
  return `${config.tablePrefix}_${d.getMonth() + 1}_${d.getFullYear()}`;
}

function toPunch(userId, logTime, directionRaw) {
  const direction = String(directionRaw ?? '').trim().toUpperCase();
  return {
    essl_employee_code: String(userId),
    date: toDateStr(logTime),
    time: toTimeStr(logTime),
    punch_type: config.directionInValues.includes(direction) ? 'in' : 'out',
  };
}

async function pushPunches(punches) {
  const res = await fetch(config.punchUrl, {
    method: 'POST',
    // Two separate auth layers: `apikey`/`Authorization` satisfy the Supabase
    // Edge Functions gateway itself (any project anon key works here — it
    // does not grant data access on its own), while `x-api-key` is the
    // function's own check that resolves this specific tenant/device via
    // essl_devices.api_key. Omitting the first pair fails with a gateway-level
    // 401 "Missing authorization header" before the function code ever runs.
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
    },
    body: JSON.stringify({ punches }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`essl-punch returned ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function sendInChunks(punches) {
  // essl-punch processes sequentially per-row internally — batch in chunks
  // so one request body doesn't grow unbounded on a first-run backlog.
  const CHUNK = 200;
  let processed = 0, unmapped = [], duplicates = 0, errors = [];
  for (let i = 0; i < punches.length; i += CHUNK) {
    const result = await pushPunches(punches.slice(i, i + CHUNK));
    processed += result.processed || 0;
    unmapped = unmapped.concat(result.unmapped || []);
    duplicates += result.duplicates || 0;
    errors = errors.concat(result.errors || []);
  }
  return { processed, unmapped: [...new Set(unmapped)], duplicates, errors };
}

// ---- MySQL (single growing table, timestamp checkpoint) ----

async function syncOnceMysql() {
  const mysql = require('mysql2/promise');
  const state = loadState();
  const conn = await mysql.createConnection({
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    user: config.dbUser || undefined,
    password: config.dbPassword || undefined,
  });

  try {
    const query = `
      SELECT \`${config.colUserId}\` AS userId, \`${config.colLogTime}\` AS logTime, \`${config.colDirection}\` AS direction
      FROM \`${config.table}\`
      WHERE \`${config.colLogTime}\` > ?
      ORDER BY \`${config.colLogTime}\` ASC
    `;
    const [rows] = await conn.execute(query, [toMysqlDateTime(new Date(state.lastSyncedAt))]);
    if (!rows.length) {
      console.log(`[${new Date().toISOString()}] No new punches.`);
      return;
    }

    const punches = rows.map((r) => toPunch(r.userId, new Date(r.logTime), r.direction));
    const { processed, unmapped, duplicates, errors } = await sendInChunks(punches);

    saveState({ lastSyncedAt: new Date(rows[rows.length - 1].logTime).toISOString() });
    console.log(`[${new Date().toISOString()}] Synced ${processed}/${punches.length} punches. ` +
      `Duplicates: ${duplicates}. Unmapped codes: ${unmapped.join(', ') || 'none'}.`);
    if (errors.length) console.error('Errors:', errors);
  } finally {
    await conn.end();
  }
}

// ---- SQL Server (monthly-partitioned tables, per-table identity checkpoint) ----

async function syncOnceMssql() {
  const sql = require('mssql');
  const state = loadState();
  const table = currentMonthTable();
  // New month rolled over since last run -> that table's DeviceLogId starts
  // over from a low number, so the old checkpoint would skip everything.
  const lastId = state.table === table ? state.lastId : 0;

  const pool = await sql.connect({
    server: config.dbInstance ? `${config.dbHost}\\${config.dbInstance}` : config.dbHost,
    database: config.dbName,
    user: config.dbUser || undefined,
    password: config.dbPassword || undefined,
    options: { trustServerCertificate: true, encrypt: false },
  });

  try {
    const result = await pool.request()
      .input('lastId', sql.BigInt, lastId)
      .query(`
        SELECT TOP (500) [${config.colId}] AS id, [${config.colUserId}] AS userId,
               [${config.colLogTime}] AS logTime, [${config.colDirection}] AS direction
        FROM dbo.[${table}]
        WHERE [${config.colId}] > @lastId
        ORDER BY [${config.colId}] ASC
      `);

    if (!result.recordset.length) {
      console.log(`[${new Date().toISOString()}] No new punches (table ${table}).`);
      saveState({ table, lastId }); // still persist so a month rollover is remembered even on quiet cycles
      return;
    }

    const punches = result.recordset.map((r) => toPunch(r.userId, new Date(r.logTime), r.direction));
    const { processed, unmapped, duplicates, errors } = await sendInChunks(punches);

    const newLastId = result.recordset[result.recordset.length - 1].id;
    saveState({ table, lastId: newLastId });
    console.log(`[${new Date().toISOString()}] Synced ${processed}/${punches.length} punches from ${table} (checkpoint=${newLastId}). ` +
      `Duplicates: ${duplicates}. Unmapped codes: ${unmapped.join(', ') || 'none'}.`);
    if (errors.length) console.error('Errors:', errors);
  } finally {
    await pool.close();
  }
}

async function syncOnce() {
  return config.dbType === 'mssql' ? syncOnceMssql() : syncOnceMysql();
}

async function main() {
  assertConfigured();
  const runOnce = process.argv.includes('--once');

  if (runOnce) {
    await syncOnce();
    return;
  }

  console.log(`ESSL sync agent started (${config.dbType}). Polling every ${config.intervalSeconds}s. Ctrl+C to stop.`);
  for (;;) {
    try {
      await syncOnce();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Sync failed:`, err.message || err);
    }
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
