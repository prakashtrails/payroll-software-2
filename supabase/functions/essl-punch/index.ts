// Receives punch events pushed by a tenant's local ESSL sync agent (which
// reads them out of the ESSL machine's eTimeTrackLite database) and applies
// them to CrewCore attendance using the exact same status/hours rules as the
// app's own clock-in/clock-out (see src/services/attendanceService.js).
//
// Auth: header `x-api-key` = an essl_devices.api_key row. That row also
// carries the device's tenant_id (and optionally outlet_id), so the caller
// never needs to know or send tenant/outlet identifiers itself.
//
// Request body:
//   { punches: [{ essl_employee_code, date: "YYYY-MM-DD", time: "HH:MM", punch_type: "in"|"out" }, ...] }
//
// Each punch is matched to a profile via profiles.essl_employee_code
// (unique per tenant — set on the employee's profile in the Employees page).
// Unmapped codes and duplicate re-sends are reported back, not treated as
// hard failures, so one bad row in a batch doesn't block the rest.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Mirrors src/lib/helpers.js diffHours — "HH:MM" pair to decimal hours, wrapping past midnight. */
function diffHours(t1: string, t2: string): number {
  if (!t1 || !t2) return 0;
  const [h1, m1] = t1.split(":").map(Number);
  const [h2, m2] = t2.split(":").map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

/** Mirrors src/services/tenantService.js resolveAttendanceSettings. */
function resolveAttendanceSettings(tenant: any, outlet: any) {
  return {
    min_half_day_hours: outlet?.min_half_day_hours ?? tenant?.min_half_day_hours ?? 4,
    min_full_day_hours: outlet?.min_full_day_hours ?? tenant?.min_full_day_hours ?? 8,
  };
}

type PunchInput = {
  essl_employee_code: string;
  date: string;
  time: string;
  punch_type: "in" | "out";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) return json({ error: "Missing x-api-key header" }, 401);

    const body = await req.json();
    const punches: PunchInput[] = Array.isArray(body?.punches) ? body.punches : [];
    if (!punches.length) return json({ error: "Missing or empty 'punches' array" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: device, error: deviceErr } = await db
      .from("essl_devices")
      .select("id, tenant_id, outlet_id, is_active")
      .eq("api_key", apiKey)
      .maybeSingle();
    if (deviceErr) return json({ error: deviceErr.message }, 500);
    if (!device || !device.is_active) return json({ error: "Invalid or inactive device key" }, 401);

    const [{ data: tenant }, { data: outlet }] = await Promise.all([
      db.from("tenants")
        .select("id, shift_start, late_threshold, min_half_day_hours, min_full_day_hours")
        .eq("id", device.tenant_id)
        .single(),
      device.outlet_id
        ? db.from("outlets")
            .select("min_half_day_hours, min_full_day_hours")
            .eq("id", device.outlet_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const results = {
      processed: 0,
      unmapped: [] as string[],
      duplicates: 0,
      errors: [] as string[],
    };

    for (const p of punches) {
      if (!p?.essl_employee_code || !p?.date || !p?.time || (p.punch_type !== "in" && p.punch_type !== "out")) {
        results.errors.push(`Malformed punch: ${JSON.stringify(p)}`);
        continue;
      }

      const { data: profile } = await db
        .from("profiles")
        .select("id, shift_id")
        .eq("tenant_id", device.tenant_id)
        .eq("essl_employee_code", p.essl_employee_code)
        .maybeSingle();

      if (!profile) {
        results.unmapped.push(p.essl_employee_code);
        continue;
      }

      try {
        // Status on first creation of the day's row, same rule as clockIn: late
        // past the shift-start + grace threshold. Ignored on conflict (row exists).
        let shiftStart = tenant?.shift_start || "09:00";
        if (profile.shift_id) {
          const { data: shift } = await db.from("shifts").select("start_time").eq("id", profile.shift_id).maybeSingle();
          if (shift?.start_time) shiftStart = shift.start_time;
        }
        const lateMin = tenant?.late_threshold || 15;
        const [sh, sm] = shiftStart.split(":").map(Number);
        const [ph, pm] = p.time.split(":").map(Number);
        const diffMin = (ph * 60 + pm) - (sh * 60 + sm);
        const initialStatus = diffMin > lateMin ? "Late" : "Present";

        const { error: upsertErr } = await db
          .from("attendance")
          .upsert(
            [{
              tenant_id: device.tenant_id,
              profile_id: profile.id,
              date: p.date,
              status: initialStatus,
              location: "Office (Device)",
            }],
            { onConflict: "profile_id,date", ignoreDuplicates: true }
          );
        if (upsertErr) throw upsertErr;

        const { data: att, error: attErr } = await db
          .from("attendance")
          .select("id")
          .eq("profile_id", profile.id)
          .eq("date", p.date)
          .single();
        if (attErr) throw attErr;

        // Idempotency: an agent may resync a window it already sent (retry after a
        // dropped connection, clock skew, etc.) — skip rather than double-insert.
        const { data: existingPunch } = await db
          .from("punches")
          .select("id")
          .eq("attendance_id", att.id)
          .eq("punch_time", p.time)
          .eq("punch_type", p.punch_type)
          .eq("source", "device")
          .maybeSingle();

        if (existingPunch) {
          results.duplicates++;
          continue;
        }

        const { error: punchErr } = await db
          .from("punches")
          .insert([{ attendance_id: att.id, punch_time: p.time, punch_type: p.punch_type, source: "device" }]);
        if (punchErr) throw punchErr;

        if (p.punch_type === "out") {
          const { data: allPunches } = await db
            .from("punches")
            .select("punch_time, punch_type")
            .eq("attendance_id", att.id)
            .order("punch_time");

          const ins = (allPunches || []).filter((r) => r.punch_type === "in");
          const outs = (allPunches || []).filter((r) => r.punch_type === "out");
          let total = 0;
          for (let i = 0; i < ins.length; i++) {
            if (outs[i]) total += diffHours(ins[i].punch_time, outs[i].punch_time);
          }

          const { min_half_day_hours: halfMin, min_full_day_hours: fullMin } = resolveAttendanceSettings(tenant, outlet);
          let status = "Absent";
          if (total >= fullMin) status = "Present";
          else if (total >= halfMin) status = "Half Day";

          await db
            .from("attendance")
            .update({ total_hours: Math.round(total * 100) / 100, status })
            .eq("id", att.id);
        }

        results.processed++;
      } catch (err) {
        results.errors.push(`${p.essl_employee_code} @ ${p.date} ${p.time}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await db.from("essl_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

    return json(results);
  } catch (err) {
    console.error("essl-punch error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
