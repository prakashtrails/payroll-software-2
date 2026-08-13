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

    // Identify the caller from their own JWT (never trust a client-supplied user id/tenant).
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

    // Authorize: caller must be an admin/manager/superadmin. Tenant is always taken
    // from the caller's own profile (except superadmin, who may target another tenant) —
    // a client-supplied tenantId is never trusted on its own.
    const { data: callerProfile, error: callerProfileErr } = await adminClient
      .from("profiles")
      .select("role, tenant_id")
      .eq("id", caller.id)
      .single();

    if (callerProfileErr || !callerProfile || !["admin", "manager", "superadmin"].includes(callerProfile.role)) {
      return json({ error: "Not authorized to create employees." }, 403);
    }

    const body = await req.json();
    const { profileData } = body;
    // login_email is what the Supabase Auth account actually uses to sign in —
    // either the real email, or (when the sheet had no email) a placeholder
    // derived from the phone number, computed client-side by
    // resolveLoginEmail()/phoneToPlaceholderEmail(). profileData.email itself
    // may legitimately be blank; it's stored as-is in `profiles`.
    const loginEmail: string = profileData?.login_email || profileData?.email;
    if (!loginEmail || !profileData?.first_name || !profileData?.last_name) {
      return json({ error: "Missing required employee fields (need first/last name and either an email or a phone number)." }, 400);
    }

    const tenantId = callerProfile.role === "superadmin" && body.tenantId
      ? body.tenantId
      : callerProfile.tenant_id;

    if (!tenantId) {
      return json({ error: "Caller has no tenant." }, 400);
    }

    const tempPassword = "Pay@" + Math.random().toString(36).slice(2, 8).toUpperCase();
    let newUserId: string | null = null;

    const { data: adminData, error: adminError } = await adminClient.auth.admin.createUser({
      email: loginEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { first_name: profileData.first_name, middle_name: profileData.middle_name || "", last_name: profileData.last_name },
    });

    if (adminError) {
      if (!ALREADY_EXISTS_RE.test(adminError.message || "")) {
        return json({ error: adminError.message }, 400);
      }

      // Auth user exists — find their id, paginating across all platform users
      // rather than assuming everything fits on page 1.
      let existing;
      try {
        existing = await findUserByEmail(adminClient, loginEmail);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
      if (!existing) {
        return json({ error: `User with email/phone ${loginEmail} already exists but could not be located.` }, 404);
      }

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id, tenant_id")
        .eq("id", existing.id)
        .maybeSingle();

      if (existingProfile) {
        if (existingProfile.tenant_id === tenantId) {
          return json({ error: `Employee with email/phone ${loginEmail} already exists in your company.` }, 409);
        }

        await adminClient.from("profiles").update({
          tenant_id: tenantId,
          first_name: profileData.first_name,
          middle_name: profileData.middle_name || "",
          last_name: profileData.last_name,
          phone: profileData.phone || "",
          department: profileData.department || "",
          designation: profileData.designation || "",
          ctc: profileData.ctc || 0,
          join_date: profileData.join_date || null,
          bank_acc: profileData.bank_acc || "",
          bank_name: profileData.bank_name || "",
          ifsc_code: profileData.ifsc_code || "",
          pan: profileData.pan || "",
          aadhar: profileData.aadhar || "",
          country: profileData.country || "India",
          passport_number: profileData.passport_number || "",
          work_permit_number: profileData.work_permit_number || "",
          work_permit_expiry: profileData.work_permit_expiry || null,
          weekly_holiday: profileData.weekly_holiday || "Sunday",
          leave_allocation: profileData.leave_allocation || 0,
          shift_id: profileData.shift_id || null,
          role: profileData.role || "employee",
          compliance_enabled: profileData.compliance_enabled || false,
          pf_enabled: profileData.pf_enabled || false,
          pf_number: profileData.pf_number || "",
          pf_amount: profileData.pf_amount || 0,
          esic_enabled: profileData.esic_enabled || false,
          esic_number: profileData.esic_number || "",
          esic_amount: profileData.esic_amount || 0,
          employee_id: profileData.employee_id || null,
          outlet_location: profileData.outlet_location || "",
          outlet_id: profileData.outlet_id || null,
          probation_months: profileData.probation_months || 0,
          probation_earned_leaves: 0,
          comp_off_balance: 0,
          temp_password: tempPassword,
          status: "Active",
          must_change_password: true,
        }).eq("id", existing.id);

        await adminClient.auth.admin.updateUserById(existing.id, {
          password: tempPassword,
          email_confirm: true,
        });

        return json({ tempPassword, userId: existing.id });
      }

      await adminClient.auth.admin.updateUserById(existing.id, {
        password: tempPassword,
        email_confirm: true,
      });

      newUserId = existing.id;
    } else {
      newUserId = adminData.user.id;
    }

    const { error: insertError } = await adminClient.from("profiles").upsert({
      id: newUserId,
      tenant_id: tenantId,
      first_name: profileData.first_name,
      middle_name: profileData.middle_name || "",
      last_name: profileData.last_name,
      email: profileData.email,
      phone: profileData.phone || "",
      department: profileData.department || "",
      designation: profileData.designation || "",
      ctc: profileData.ctc || 0,
      join_date: profileData.join_date || null,
      bank_acc: profileData.bank_acc || "",
      bank_name: profileData.bank_name || "",
      ifsc_code: profileData.ifsc_code || "",
      pan: profileData.pan || "",
      aadhar: profileData.aadhar || "",
      country: profileData.country || "India",
      passport_number: profileData.passport_number || "",
      work_permit_number: profileData.work_permit_number || "",
      work_permit_expiry: profileData.work_permit_expiry || null,
      weekly_holiday: profileData.weekly_holiday || "Sunday",
      leave_allocation: profileData.leave_allocation || 0,
      shift_id: profileData.shift_id || null,
      compliance_enabled: profileData.compliance_enabled || false,
      pf_enabled: profileData.pf_enabled || false,
      pf_number: profileData.pf_number || "",
      pf_amount: profileData.pf_amount || 0,
      esic_enabled: profileData.esic_enabled || false,
      esic_number: profileData.esic_number || "",
      esic_amount: profileData.esic_amount || 0,
      employee_id: profileData.employee_id || null,
      outlet_location: profileData.outlet_location || "",
      outlet_id: profileData.outlet_id || null,
      temp_password: tempPassword,
      role: profileData.role || "employee",
      status: profileData.status || "Active",
      must_change_password: true,
    }, { onConflict: "id" });

    if (insertError) return json({ error: insertError.message }, 400);

    return json({ tempPassword, userId: newUserId });
  } catch (err) {
    console.error("create-employee-user error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Internal server error: " + message }, 500);
  }
});
