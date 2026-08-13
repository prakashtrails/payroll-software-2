import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { identifier, type } = await req.json();

    if (!identifier || !type) {
      return new Response(
        JSON.stringify({ error: "Missing 'identifier' or 'type'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (type !== "email") {
      return new Response(
        JSON.stringify({ error: "Only email OTP is supported." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const email = identifier.toLowerCase().trim();

    // Read SMTP secrets from environment
    const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = parseInt(Deno.env.get("SMTP_PORT") || "465");
    const smtpUser = Deno.env.get("SMTP_USER")!;
    const smtpPass = Deno.env.get("SMTP_PASS")!;
    const smtpFrom = Deno.env.get("SMTP_FROM") || `PayrollPro <${smtpUser}>`;

    if (!smtpUser || !smtpPass) {
      console.error("SMTP_USER or SMTP_PASS environment variable is not set.");
      return new Response(
        JSON.stringify({ error: "Email service is not configured. Please contact the administrator." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Store OTP in Supabase otp_table (delete old first)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Cooldown: this endpoint accepts any email (it's also used pre-signup, before
    // an account exists, so we can't check account ownership) — without a per-email
    // throttle it can be used to mass-mail arbitrary inboxes via our SMTP relay.
    const { data: recent } = await db
      .from("otp_table")
      .select("created_at")
      .eq("user_id", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000) {
      return new Response(
        JSON.stringify({ error: "Please wait a minute before requesting another code." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await db.from("otp_table").delete().eq("user_id", email);
    const { error: insertErr } = await db.from("otp_table").insert([{
      user_id:    email,
      otp,
      expires_at: expiresAt,
    }]);

    if (insertErr) {
      console.error("otp_table insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "Failed to store OTP. " + insertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send OTP email via Gmail SMTP
    const transporter = nodemailer.createTransport({
      host:   smtpHost,
      port:   smtpPort,
      secure: smtpPort === 465,
      auth:   { user: smtpUser, pass: smtpPass.replace(/\s/g, "") },
    });

    await transporter.sendMail({
      from:    smtpFrom,
      to:      email,
      subject: "Your PayrollPro Verification Code",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px;">
          <h2 style="color:#1a1a2e;margin-bottom:8px;">PayrollPro</h2>
          <p style="color:#555;font-size:15px;">Here is your one-time verification code:</p>
          <div style="font-size:36px;font-weight:800;letter-spacing:10px;color:#4f46e5;
                      background:#fff;border:2px solid #e0e0ff;border-radius:8px;
                      padding:16px 24px;text-align:center;margin:24px 0;">
            ${otp}
          </div>
          <p style="color:#888;font-size:13px;">This code expires in <strong>5 minutes</strong>. Do not share it with anyone.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="color:#aaa;font-size:12px;">If you did not request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    return new Response(
      JSON.stringify({ success: true, type: "email" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-otp error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Failed to send OTP: " + message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
