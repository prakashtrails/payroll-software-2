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
    // Same hard default as resolveAttendanceSettings() in src/services/tenantService.js.
    // Fixed rule: Report Time (shift_start) + Late Allowed minutes
    // (late_threshold) — no separate monthly grace waiver on top of this.
    shift_start: outlet?.shift_start ?? tenant?.shift_start ?? "10:30",
    shift_end: outlet?.shift_end ?? tenant?.shift_end ?? "18:00",
    late_threshold: outlet?.late_threshold ?? tenant?.late_threshold ?? 0,
  };
}

/** "HH:MM" to minutes-since-midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const EARLY_LATE_THRESHOLD_MINUTES = 90;

/** Mirrors src/lib/helpers.js computeEarlyLateBreach exactly — see that doc for the rule. */
function computeEarlyLateBreach(firstPunch: string, lastPunch: string, shiftStart: string, shiftEnd: string): boolean {
  if (!firstPunch || !lastPunch || !shiftStart || !shiftEnd) return false;
  const isLateArrival = toMinutes(firstPunch) > toMinutes(shiftStart) + EARLY_LATE_THRESHOLD_MINUTES;
  const isEarlyDeparture = toMinutes(lastPunch) < toMinutes(shiftEnd) - EARLY_LATE_THRESHOLD_MINUTES;
  return isLateArrival || isEarlyDeparture;
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

    const { data: tenant } = await db
      .from("tenants")
      .select("id, shift_start, shift_end, late_threshold, min_half_day_hours, min_full_day_hours")
      .eq("id", device.tenant_id)
      .single();

    // Resolved per employee (profile.outlet_id), NOT per device: a single ESSL
    // device/API key can front punches for employees across several outlets
    // (e.g. Raniwala's web-poll dashboard aggregates all on-site terminals
    // under one key — see essl-web-poll), so using device.outlet_id here would
    // apply just one outlet's reporting-time override to every employee synced
    // through it, silently ignoring every other outlet's own Shift Start/Late
    // Threshold. Cached per outlet_id since a batch commonly repeats outlets.
    const outletCache = new Map<string, any>();
    async function getOutlet(outletId: string | null) {
      if (!outletId) return null;
      if (outletCache.has(outletId)) return outletCache.get(outletId);
      const { data } = await db
        .from("outlets")
        .select("min_half_day_hours, min_full_day_hours, shift_start, shift_end, late_threshold")
        .eq("id", outletId)
        .maybeSingle();
      outletCache.set(outletId, data);
      return data;
    }

    const shiftCache = new Map<string, any>();
    async function getShift(shiftId: string | null) {
      if (!shiftId) return null;
      if (shiftCache.has(shiftId)) return shiftCache.get(shiftId);
      const { data } = await db
        .from("shifts")
        .select("start_time, end_time, early_departure_after, late_arrival_allowance_until")
        .eq("id", shiftId)
        .maybeSingle();
      shiftCache.set(shiftId, data);
      return data;
    }

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
        .select("id, shift_id, outlet_id")
        .eq("tenant_id", device.tenant_id)
        .eq("essl_employee_code", p.essl_employee_code)
        .maybeSingle();

      if (!profile) {
        results.unmapped.push(p.essl_employee_code);
        continue;
      }

      // Falls back to the device's own outlet only when the employee has none
      // set on their profile — same precedence gap as before, just no longer
      // the *only* path, so a profile with the correct outlet always wins.
      const outlet = (await getOutlet(profile.outlet_id)) ?? (await getOutlet(device.outlet_id));
      const attSettings = resolveAttendanceSettings(tenant, outlet);

      try {
        // Status on first creation of the day's row, same fixed rule as
        // clockIn(): later than Report Time + Late Allowed minutes is Late,
        // every day of the month, no monthly grace waiver. Ignored on
        // conflict (row exists).
        const shift = await getShift(profile.shift_id);
        let shiftStart = attSettings.shift_start;
        if (shift?.start_time) shiftStart = shift.start_time;
        const lateMin = attSettings.late_threshold;
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
          .select("id, status")
          .eq("profile_id", profile.id)
          .eq("date", p.date)
          .single();
        if (attErr) throw attErr;

        // Comp off for working a weekly off / holiday is credited by the DB
        // trigger trg_comp_off_credit_from_hours (20260928_4) from the day's
        // hours, for comp-off-eligible employees — nothing to grant here.

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

        // Same app_notifications row clockIn()/clockOut() write for an app punch
        // (see notifyProfiles in src/services/notificationService.js) — an ESSL
        // machine punch never goes through those functions, so without this the
        // employee gets an attendance row but no "Clocked in/out" push, unlike
        // punching in through the app itself. Insert (not the notifyProfiles
        // helper, which needs a user-scoped supabase client) since this function
        // only holds the service-role client `db`; the push itself is fired by
        // the push-app-notification DB webhook on this table, same as every
        // other notification path.
        const { error: notifyErr } = await db.from("app_notifications").insert([{
          tenant_id: device.tenant_id,
          profile_id: profile.id,
          actor_id: null,
          type: p.punch_type === "in" ? "clock_in" : "clock_out",
          title: p.punch_type === "in" ? "Clocked in" : "Clocked out",
          body: `You clocked ${p.punch_type} at ${p.time} (biometric device).`,
          link_key: "attendance",
          related_id: att.id,
        }]);
        if (notifyErr) console.error(`app_notifications insert failed for ${p.essl_employee_code}:`, notifyErr.message);

        // First punch of the day to the day's LAST punch so far, of EITHER
        // type — not paired in/out sessions. A device double-punch (the same
        // scan logged twice seconds apart) or a mistaken extra re-scan after
        // already leaving just becomes one more row in the middle that
        // doesn't move either end; whatever the day's last punch turns out
        // to be (in or out) is always what "Clock Out" reflects. Every
        // individual punch still gets stored in `punches` for the audit
        // trail (see the insert above) — this just stops using each one's
        // in/out tag to decide the total. Skipped on the very first punch of
        // the day (nothing to span yet — running this here would overwrite
        // the initial Late/Present status with 'Absent' from a 0-hour span).
        const { data: allPunches } = await db
          .from("punches")
          .select("punch_time")
          .eq("attendance_id", att.id)
          .order("punch_time");
        const times = (allPunches || []).map((r) => r.punch_time).sort();

        if (times.length > 1) {
          const { data: currentAtt } = await db.from("attendance").select("status").eq("id", att.id).single();

          const firstPunch = times[0];
          const lastPunch = times[times.length - 1];
          const total = diffHours(firstPunch, lastPunch);

          const { min_half_day_hours: halfMin, min_full_day_hours: fullMin } = resolveAttendanceSettings(tenant, outlet);
          let status = "Absent";
          if (total >= fullMin) status = "Present";
          else if (total >= halfMin) status = "Half Day";
          // Mirrors src/services/attendanceService.js clockOut(): a day already
          // marked 'Late' at clock-in stays 'Late' on a full day's hours — a
          // later punch must never silently erase the late arrival.
          if (currentAtt?.status === "Late" && status === "Present") {
            status = "Late";
          }

          // One-time-per-calendar-month allowance for an extreme early
          // departure or extreme late arrival (per-shift, opt-in). "Arrival"
          // = the day's first punch, "departure" = the day's last punch so
          // far — same first/last model as the total above. First breach in
          // the month keeps the status computed above; any further breach
          // forces Half Day. Mirrors src/services/attendanceService.js clockOut().
          let allowanceUsed = false;
          const earlyDepartureAfter = shift?.early_departure_after ?? null;
          const lateArrivalAllowanceUntil = shift?.late_arrival_allowance_until ?? null;
          const isEarlyDeparture = !!(earlyDepartureAfter && toMinutes(lastPunch) < toMinutes(earlyDepartureAfter));
          const isExtremeLateArrival = !!(lateArrivalAllowanceUntil && toMinutes(firstPunch) > toMinutes(lateArrivalAllowanceUntil));
          if ((isEarlyDeparture || isExtremeLateArrival) && status !== "Absent") {
            const monthStart = `${p.date.slice(0, 7)}-01`;
            const { count: allowanceCount } = await db
              .from("attendance")
              .select("id", { count: "exact", head: true })
              .eq("profile_id", profile.id)
              .eq("monthly_allowance_used", true)
              .gte("date", monthStart)
              .lte("date", p.date);
            if (!allowanceCount) {
              allowanceUsed = true;
            } else {
              status = "Half Day";
            }
          }

          // Early Left / Late Arrival monthly-grace counter — independent,
          // additive, visibility-only. Mirrors src/services/attendanceService.js
          // clockOut() exactly, so app and device punches are counted the same way.
          const effectiveShiftStart = shift?.start_time || attSettings.shift_start;
          const effectiveShiftEnd = shift?.end_time || attSettings.shift_end;
          let earlyLateFlag = false;
          let earlyLateGraced = false;
          if (computeEarlyLateBreach(firstPunch, lastPunch, effectiveShiftStart, effectiveShiftEnd)) {
            const monthStart = `${p.date.slice(0, 7)}-01`;
            const { count: breachCount } = await db
              .from("attendance")
              .select("id", { count: "exact", head: true })
              .eq("profile_id", profile.id)
              // Any earlier breach day this month — graced OR counted (see
              // src/services/attendanceService.js clockOut). Same day excluded.
              .or("early_late_flag.eq.true,early_late_graced.eq.true")
              .gte("date", monthStart)
              .lt("date", p.date);
            if (!breachCount) {
              earlyLateGraced = true;
            } else {
              earlyLateFlag = true;
            }
          }

          await db
            .from("attendance")
            .update({
              total_hours: Math.round(total * 100) / 100, status, monthly_allowance_used: allowanceUsed,
              early_late_flag: earlyLateFlag, early_late_graced: earlyLateGraced,
            })
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
