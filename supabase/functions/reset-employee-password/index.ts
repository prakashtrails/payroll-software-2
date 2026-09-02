import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Admin-triggered password reset for an existing employee — generates a fresh
// temporary password, sets it on their Auth account, and forces them to change
// it on next login (same temp-password format/flow as create-employee-user).
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
      return json({ error: "Not authorized to reset employee passwords." }, 403);
    }

    const body = await req.json();
    const { id } = body;
    if (!id) {
      return json({ error: "Missing 'id'." }, 400);
    }

    const { data: targetProfile, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, tenant_id, email, phone")
      .eq("id", id)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return json({ error: "Employee not found." }, 404);
    }

    if (callerProfile.role !== "superadmin" && targetProfile.tenant_id !== callerProfile.tenant_id) {
      return json({ error: "Not authorized to reset this employee's password." }, 403);
    }

    const tempPassword = "Pay@" + Math.random().toString(36).slice(2, 8).toUpperCase();

    const { error: authError } = await adminClient.auth.admin.updateUserById(id, {
      password: tempPassword,
      email_confirm: true,
    });
    if (authError) return json({ error: authError.message }, 400);

    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ temp_password: tempPassword, must_change_password: true })
      .eq("id", id);
    if (profileError) return json({ error: profileError.message }, 400);

    // The employee's previously-recorded "current password" (see
    // employee_current_passwords / set_current_password) is now stale — it no
    // longer matches what actually unlocks the account. Overwrite it with the
    // fresh temp password (rather than just deleting the row) so anyone
    // viewing credentials always finds a live, correct value here, from this
    // reset onward until the employee sets their own.
    await adminClient.from("employee_current_passwords").upsert({
      profile_id: id,
      tenant_id: targetProfile.tenant_id,
      password: tempPassword,
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id" });

    return json({ tempPassword });
  } catch (err) {
    console.error("reset-employee-password error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Internal server error: " + message }, 500);
  }
});
