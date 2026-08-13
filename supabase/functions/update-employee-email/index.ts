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
    const { id, email } = body;
    const newEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!id || !newEmail) {
      return json({ error: "Missing 'id' or 'email'." }, 400);
    }
    if (!EMAIL_RE.test(newEmail)) {
      return json({ error: "That doesn't look like a valid email address." }, 400);
    }

    const { data: targetProfile, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", id)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return json({ error: "Employee not found." }, 404);
    }

    if (callerProfile.role !== "superadmin" && targetProfile.tenant_id !== callerProfile.tenant_id) {
      return json({ error: "Not authorized to update this employee." }, 403);
    }

    // Only the email changes here — password/temp_password are intentionally
    // left untouched so the employee's existing (temporary or self-set)
    // password keeps working after the login email is corrected.
    const { error: authError } = await adminClient.auth.admin.updateUserById(id, {
      email: newEmail,
      email_confirm: true,
    });
    if (authError) return json({ error: authError.message }, 400);

    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ email: newEmail })
      .eq("id", id);
    if (profileError) return json({ error: profileError.message }, 400);

    return json({ success: true });
  } catch (err) {
    console.error("update-employee-email error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Internal server error: " + message }, 500);
  }
});
