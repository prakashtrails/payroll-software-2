// Live punch-machine check for the Add/Edit Employee form. HR types an EMP /
// ESSL code; if CrewCore's mirror doesn't know that code yet (a person
// enrolled on the machine since the last poll), the form calls this to read
// Raniwala's ESSL Web API right now and store whatever it returns, then
// re-reads the mirror as usual. Same ingest RPCs as essl-web-poll, so a code
// that already belongs to an employee gets its punches applied here too.
//
// Request: POST { code }   (caller's JWT; HR (admin) of the feed's tenant, or superadmin)
// Response: { live: true, found: boolean, checkedAt } | { live: false }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ESSL_WEB_API_URL = "http://183.83.176.221:8001/api/data?days=2&force=1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const deviceApiKey = Deno.env.get("RANIWALA_ESSL_API_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated." }, 401);

    const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: caller } = await db.from("profiles").select("role, tenant_id").eq("id", user.id).single();
    // Punch-machine data is HR-only (see 20260928_9_essl_hr_only.sql).
    if (!caller || !["admin", "superadmin"].includes(caller.role)) {
      return json({ error: "Not authorized." }, 403);
    }

    const { data: device } = await db
      .from("essl_devices").select("tenant_id, is_active").eq("api_key", deviceApiKey).maybeSingle();
    // Only the tenant this feed belongs to has a live machine to ask.
    if (!device?.is_active || (caller.role !== "superadmin" && device.tenant_id !== caller.tenant_id)) {
      return json({ live: false });
    }

    const code = String((await req.json())?.code ?? "").trim().toUpperCase();
    if (!code) return json({ error: "Missing code" }, 400);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    let data: any;
    try {
      const res = await fetch(ESSL_WEB_API_URL, { signal: ctrl.signal });
      if (!res.ok) return json({ error: `Punch machine feed returned ${res.status}` }, 502);
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const employees = data?.employees || [];
    const rows = data?.rows || [];
    if (employees.length) {
      const { error } = await db.rpc("essl_ingest_master", { p_tenant_id: device.tenant_id, p_rows: employees });
      if (error) throw error;
    }
    if (rows.length) {
      const { error } = await db.rpc("essl_ingest_daily", { p_tenant_id: device.tenant_id, p_rows: rows, p_notify: true });
      if (error) throw error;
    }

    const found = employees.some((e: any) => String(e?.u ?? "").trim().toUpperCase() === code)
      || rows.some((r: any) => String(r?.u ?? "").trim().toUpperCase() === code);
    return json({ live: true, found, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error("essl-code-lookup error:", err);
    return json({ error: err instanceof Error ? err.message : String((err as any)?.message ?? err) }, 500);
  }
});
