// Polls Raniwala's live ESSL Web API dashboard (a small internal tool that
// already aggregates punches across all 3 on-site biometric terminals via
// ESSL's own device API) and forwards CHANGED punches into CrewCore through
// the same essl-punch Edge Function a local sync agent would use — so status
// (Present/Late/Half Day/Absent) is computed identically either way.
//
// Runs every 2 minutes via pg_cron (see the accompanying migration), not on
// request from the app — this function takes no input.
//
// Only rows whose in/out time changed since the last cycle are forwarded
// (checked against essl_web_poll_state). An earlier version resent the
// dashboard's full ~300 rows every single cycle and hit
// WORKER_RESOURCE_LIMIT — essl-punch does several DB round trips per punch,
// so 300 of those every 2 minutes is far more work than the handful of rows
// that actually change in a real 2-minute window. Diffing first keeps a
// normal cycle to single digits.
//
// Why call essl-punch instead of writing to attendance/punches directly:
// essl-punch already has the tenant/device resolution, employee-code mapping,
// and status-calculation logic, tested and in production use. Reusing it
// here means this file has exactly one job — notice what changed and hand it
// off — with zero duplicated business logic to drift out of sync later.
//
// Tenant-specific for now (Raniwala only) because only one tenant currently
// has a web-dashboard ESSL source rather than direct SQL Server access. If a
// second tenant needs this same path, move ESSL_WEB_API_URL and
// RANIWALA_ESSL_API_KEY onto the essl_devices row (e.g. a `poll_url` column)
// and loop over every device configured that way, instead of hardcoding one.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ESSL_WEB_API_URL = "http://183.83.176.221:8001/api/data?days=1&force=1";

type DashboardRow = { u: string; d: string; i?: string; o?: string };
type StateRow = { essl_employee_code: string; date: string; last_in: string | null; last_out: string | null };

serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const deviceApiKey = Deno.env.get("RANIWALA_ESSL_API_KEY")!;
  const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const esslRes = await fetch(ESSL_WEB_API_URL);
    if (!esslRes.ok) {
      return json({ error: `ESSL dashboard returned ${esslRes.status}` }, 502);
    }
    const data = await esslRes.json();
    const rows: DashboardRow[] = data?.rows || [];
    if (!rows.length) {
      return json({ processed: 0, note: "no rows from ESSL dashboard this cycle" });
    }

    const { data: stateRows, error: stateErr } = await db
      .from("essl_web_poll_state")
      .select("essl_employee_code, date, last_in, last_out")
      .in("date", [...new Set(rows.map((r) => r.d))]);
    if (stateErr) throw stateErr;

    const stateByKey = new Map((stateRows || []).map((s: StateRow) => [`${s.essl_employee_code}|${s.date}`, s]));

    const changed = rows.filter((r) => {
      const prior = stateByKey.get(`${r.u}|${r.d}`);
      return !prior || prior.last_in !== (r.i || null) || prior.last_out !== (r.o || null);
    });

    if (!changed.length) {
      return json({ processed: 0, note: "no changes since last cycle" });
    }

    const punches: Array<{ essl_employee_code: string; date: string; time: string; punch_type: "in" | "out" }> = [];
    for (const r of changed) {
      if (r.i) punches.push({ essl_employee_code: r.u, date: r.d, time: r.i, punch_type: "in" });
      if (r.o) punches.push({ essl_employee_code: r.u, date: r.d, time: r.o, punch_type: "out" });
    }

    // essl-punch also dedupes on (attendance_id, punch_time, punch_type,
    // source) — this diff is purely to keep each cycle's workload small, not
    // load-bearing for correctness.
    const punchRes = await fetch(`${supabaseUrl}/functions/v1/essl-punch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": deviceApiKey,
        "apikey": anonKey,
        "Authorization": `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ punches }),
    });
    const body = await punchRes.json();

    // Record the new state regardless of essl-punch's per-row outcome (an
    // unmapped code today may get mapped later — we still want the next
    // cycle to treat it as "unchanged" rather than resending it forever).
    const { error: upsertErr } = await db
      .from("essl_web_poll_state")
      .upsert(
        changed.map((r) => ({ essl_employee_code: r.u, date: r.d, last_in: r.i || null, last_out: r.o || null, updated_at: new Date().toISOString() })),
        { onConflict: "essl_employee_code,date" }
      );
    if (upsertErr) console.error("state upsert failed:", upsertErr.message);

    return json({ ...body, changedRows: changed.length, totalRowsSeen: rows.length }, punchRes.status);
  } catch (err) {
    console.error("essl-web-poll error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
