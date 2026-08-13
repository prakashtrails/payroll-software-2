import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALREADY_EXISTS_RE = /already.{0,15}registered|already in use|already exists|user already/i;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the caller from their own JWT (never trust a client-supplied role).
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

    // Only superadmin may create new companies.
    const { data: callerProfile, error: callerProfileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (callerProfileErr || !callerProfile || callerProfile.role !== "superadmin") {
      return json({ error: "Not authorized to create companies." }, 403);
    }

    const body = await req.json();
    const companyName = (body.companyName || "").trim();
    const adminFirstName = (body.adminFirstName || "").trim();
    const adminLastName = (body.adminLastName || "").trim();
    const adminEmail = (body.adminEmail || "").trim();

    if (!companyName || !adminFirstName || !adminLastName || !adminEmail) {
      return json({ error: "Company name and admin name/email are required." }, 400);
    }

    const domain = (body.domain || "").trim();
    const currency = (body.currency || "₹").trim();
    const workDays = Number.isFinite(body.workDays) ? body.workDays : 26;

    // Generate a unique join_code the same way create_workspace() does, so this
    // tenant supports normal employee self-signup too, not just superadmin import.
    let joinCode = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
      const { data: clash } = await adminClient
        .from("tenants")
        .select("id")
        .ilike("join_code", candidate)
        .maybeSingle();
      if (!clash) { joinCode = candidate; break; }
    }
    if (!joinCode) {
      return json({ error: "Could not generate a unique join code, please retry." }, 500);
    }

    const { data: tenantRow, error: tenantError } = await adminClient
      .from("tenants")
      .insert({
        company_name: companyName,
        domain: domain || null,
        currency,
        work_days: workDays,
        join_code: joinCode,
      })
      .select("id")
      .single();

    if (tenantError || !tenantRow) {
      return json({ error: tenantError?.message || "Failed to create company." }, 400);
    }
    const tenantId = tenantRow.id;

    const cleanupTenant = async () => {
      await adminClient.from("tenants").delete().eq("id", tenantId);
    };

    const tempPassword = "Pay@" + Math.random().toString(36).slice(2, 8).toUpperCase();

    const { data: adminData, error: adminError } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { first_name: adminFirstName, last_name: adminLastName },
    });

    if (adminError) {
      await cleanupTenant();
      if (ALREADY_EXISTS_RE.test(adminError.message || "")) {
        return json({ error: `An account with email ${adminEmail} already exists. Use a different admin email.` }, 409);
      }
      return json({ error: adminError.message }, 400);
    }

    const newUserId = adminData.user.id;

    const { error: insertError } = await adminClient.from("profiles").upsert({
      id: newUserId,
      tenant_id: tenantId,
      first_name: adminFirstName,
      last_name: adminLastName,
      email: adminEmail,
      role: "admin",
      status: "Active",
      temp_password: tempPassword,
      must_change_password: true,
    }, { onConflict: "id" });

    if (insertError) {
      // Best-effort cleanup — no real cross-service transaction available here.
      await adminClient.auth.admin.deleteUser(newUserId).catch(() => {});
      await cleanupTenant();
      return json({ error: insertError.message }, 400);
    }

    return json({ tenantId, joinCode, adminEmail, tempPassword });
  } catch (err) {
    console.error("create-tenant error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Internal server error: " + message }, 500);
  }
});
