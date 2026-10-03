// Polls Raniwala's live ESSL Web API dashboard (a small internal tool that
// already aggregates punches across all on-site biometric terminals via
// ESSL's own device API) and mirrors it into CrewCore.
//
// Every row the feed returns -- every ESSL code, mapped to a CrewCore
// employee or not -- is stored in essl_daily_punches / essl_employee_master
// (see 20260928_5_essl_full_mirror_and_code_sync.sql). essl_ingest_daily()
// diffs each batch against what is already stored and applies only the rows
// that changed to attendance, in the same transaction, so a failed cycle is
// simply retried by the next one instead of being lost.
//
// Earlier versions asked for ONE day per cycle and forwarded changed punches
// to essl-punch one by one. Any day a cycle missed (API down, cold start, a
// reader like DELHI syncing hours late) was never looked at again, and codes
// with no CrewCore employee were dropped. Now:
//   - every 2-min cycle reads 2 days (today + yesterday),
//   - the nightly cron reads 7 days to catch late reader syncs,
//   - POST { "days": 400 } once pulls the whole history the feed holds
//     (safe to re-run: unchanged rows are no-ops).
//
// Runs via pg_cron (see migrations), takes an optional JSON body { days }.
// Tenant comes from the essl_devices row that owns RANIWALA_ESSL_API_KEY.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ESSL_WEB_API_URL = "http://183.83.176.221:8001/api/data";

// Keeps each RPC well inside the statement timeout even when every row in
// it lands on/after the attendance cutoff and has to be applied.
const CHUNK = 500;
// Stop starting new chunks after this long; a re-run picks up the rest.
const TIME_BUDGET_MS = 120_000;

type DashboardRow = { u: string; d: string; i?: string | null; o?: string | null; n?: number };

serve(async (req) => {
  const started = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const deviceApiKey = Deno.env.get("RANIWALA_ESSL_API_KEY")!;
  const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    let body: { days?: number } = {};
    try { body = await req.json(); } catch { /* cron sends {} or nothing */ }
    const days = Math.min(Math.max(Math.trunc(Number(body?.days) || 2), 1), 400);
    const live = days <= 2;

    const { data: device, error: deviceErr } = await db
      .from("essl_devices")
      .select("id, tenant_id, is_active")
      .eq("api_key", deviceApiKey)
      .maybeSingle();
    if (deviceErr) throw deviceErr;
    if (!device?.is_active) return json({ error: "Raniwala ESSL device key not found or inactive" }, 500);

    // force=1 makes the dashboard re-read the readers instead of serving its
    // cache -- only worth it for the small live window.
    const esslRes = await fetch(`${ESSL_WEB_API_URL}?days=${days}${live ? "&force=1" : ""}`);
    if (!esslRes.ok) return json({ error: `ESSL dashboard returned ${esslRes.status}` }, 502);
    const data = await esslRes.json();
    const rows: DashboardRow[] = data?.rows || [];
    const employees = data?.employees || [];

    const result = { days, rowsSeen: rows.length, changed: 0, applied: 0, unmapped: [] as string[], masterUpdated: 0, complete: true };

    for (let i = 0; i < rows.length; i += CHUNK) {
      if (Date.now() - started > TIME_BUDGET_MS) { result.complete = false; break; }
      const { data: r, error } = await db.rpc("essl_ingest_daily", {
        p_tenant_id: device.tenant_id,
        p_rows: rows.slice(i, i + CHUNK),
        p_notify: live,
      });
      if (error) throw error;
      result.changed += r?.changed || 0;
      result.applied += r?.applied || 0;
      for (const c of r?.unmapped || []) if (!result.unmapped.includes(c)) result.unmapped.push(c);
    }

    // Employee master (name / department / location per code): ~300 rows,
    // diffed in SQL. Refreshed hourly, on any bigger pull, and whenever a
    // code with no CrewCore employee punched -- so a brand-new enrolment is
    // on the ESSL Records page / Add Employee lookup within one cycle.
    const hourly = new Date().getUTCMinutes() < 2;
    if (employees.length && (hourly || !live || result.unmapped.length)) {
      const { data: n, error } = await db.rpc("essl_ingest_master", { p_tenant_id: device.tenant_id, p_rows: employees });
      if (error) throw error;
      result.masterUpdated = n || 0;
    }

    await db.from("essl_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
    return json(result);
  } catch (err) {
    console.error("essl-web-poll error:", err);
    return json({ error: err instanceof Error ? err.message : String((err as any)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
