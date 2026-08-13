import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Fields callers may never set directly through this endpoint — they either
// have their own dedicated flow (status, password) or would let a caller
// escalate privileges / move a profile to another tenant.
const FORBIDDEN_FIELDS = ["id", "tenant_id", "role", "must_change_password", "temp_password"];

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
    const { id, payload } = body;
    if (!id || !payload || typeof payload !== "object") {
      return json({ error: "Missing 'id' or 'payload'." }, 400);
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

    const cleanPayload = { ...payload };
    for (const field of FORBIDDEN_FIELDS) delete cleanPayload[field];

    const { error: updateError } = await adminClient.from("profiles").update(cleanPayload).eq("id", id);
    if (updateError) return json({ error: updateError.message }, 400);

    return json({ success: true });
  } catch (err) {
    console.error("update-employee-admin error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Internal server error: " + message }, 500);
  }
});
