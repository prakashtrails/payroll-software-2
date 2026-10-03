import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findUserByEmail } from "../_shared/findUserByEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizePhone = (phone: string) => String(phone || "").replace(/\D/g, "").slice(-10);
const phoneToPlaceholderEmail = (phone: string) => {
  const digits = normalizePhone(phone);
  return digits ? `p${digits}@phone.crewcore.internal` : "";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return json({ error: "Not authenticated." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerProfile, error: callerProfileErr } = await adminClient
      .from("profiles")
      .select("role, tenant_id")
      .eq("id", caller.id)
      .single();

    if (callerProfileErr || !callerProfile || !["admin", "manager", "superadmin"].includes(callerProfile.role)) {
      return json({ error: "Not authorized to update employees." }, 403);
    }

    const body = await req.json();
    const { id, phone } = body;
    const newPhone = typeof phone === "string" ? phone.trim() : "";
    const newDigits = normalizePhone(newPhone);
    if (!id || !newDigits || newDigits.length !== 10) {
      return json({ error: "Enter a valid 10-digit phone number." }, 400);
    }

    const { data: targetProfile, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, tenant_id, email")
      .eq("id", id)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return json({ error: "Employee not found." }, 404);
    }

    if (callerProfile.role !== "superadmin" && targetProfile.tenant_id !== callerProfile.tenant_id) {
      return json({ error: "Not authorized to update this employee." }, 403);
    }

    // An employee with a real login email signs in with that, so their phone
    // is just contact info — no Auth change needed. An employee with no real
    // email logs in with a placeholder derived from their phone (see
    // phoneToPlaceholderEmail in src/lib/helpers.js and LoginPage.jsx), so
    // changing the number must also move their Auth account to the new
    // placeholder or their login stops matching what they type.
    const hasRealEmail = EMAIL_RE.test(targetProfile.email || "");
    if (!hasRealEmail) {
      const loginId = phoneToPlaceholderEmail(newDigits);
      const setLogin = () => adminClient.auth.admin.updateUserById(id, { email: loginId, email_confirm: true });
      let { error: authError } = await setLogin();

      // Another auth account already signs in with this number (GoTrue only
      // reports a bare "Error updating user" for the unique-key clash) —
      // same handling as update-employee-email.
      if (authError && /error updating user|duplicate key|already|users_email/i.test(authError.message || "")) {
        const existing = await findUserByEmail(adminClient, loginId);
        if (existing && existing.id !== id) {
          const { data: owner } = await adminClient
            .from("profiles")
            .select("first_name, last_name, essl_employee_code, tenant_id")
            .eq("id", existing.id)
            .maybeSingle();
          if (owner) {
            const who = owner.tenant_id === targetProfile.tenant_id
              ? `${[owner.first_name, owner.last_name].filter(Boolean).join(" ")}${owner.essl_employee_code ? ` (Emp ${owner.essl_employee_code})` : ""}`
              : "an account in another company";
            return json({ error: `This phone number is already the login of ${who}. Use a different number.` }, 409);
          }
          // Leftover auth account with no profile — nobody can use it and it
          // owns no data, so free the number and retry.
          const { error: delErr } = await adminClient.auth.admin.deleteUser(existing.id);
          if (delErr) return json({ error: `This phone number is held by an unused leftover login and could not be freed: ${delErr.message}` }, 400);
          ({ error: authError } = await setLogin());
        }
      }
      if (authError) return json({ error: authError.message }, 400);
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ phone: newPhone })
      .eq("id", id);
    if (profileError) return json({ error: profileError.message }, 400);

    return json({ success: true });
  } catch (err) {
    console.error("update-employee-phone error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Internal server error: " + message }, 500);
  }
});
