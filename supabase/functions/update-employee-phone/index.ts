import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      const { error: authError } = await adminClient.auth.admin.updateUserById(id, {
        email: phoneToPlaceholderEmail(newDigits),
        email_confirm: true,
      });
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
