import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.9";

// Sends task notifications to the external channels a company switched on in
// tenant_notification_channels (Slack incoming webhook, email via the same
// SMTP secrets send-otp uses, WhatsApp via MSG91 templates). In-app + mobile
// push are NOT sent here — the DB triggers write app_notifications directly.
//
// Modes (POST JSON body):
//   { mode: "process" }  — drain notification_outbox. Called by the outbox
//                          INSERT trigger and the daily reminder cron via
//                          pg_net. Safe to call any number of times: rows are
//                          claimed with SKIP LOCKED and completed once.
//   { mode: "status" }   — which server-side channels are configured (UI).
//   { mode: "test", channel, webhook_url? } — HR/admin only: send a test.
//
// Secrets: SMTP_HOST/PORT/USER/PASS/FROM (already set for send-otp),
// MSG91_AUTH_KEY, MSG91_WA_NUMBER, MSG91_WA_TEMPLATE (an approved template
// with two body variables: {{1}} = recipient name, {{2}} = message text),
// MSG91_WA_LANG (default "en"), APP_URL (default https://crewcore.in).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const APP_URL = (Deno.env.get("APP_URL") || "https://crewcore.in").replace(/\/$/, "");
const PLACEHOLDER_EMAIL = /@phone\.crewcore\.internal$/i;

type Outbox = {
  id: string; tenant_id: string; event: "task_assigned" | "task_status" | "reminder_digest";
  task_id: string | null; recipients: string[]; payload: Record<string, any>;
};
type Channels = {
  tenant_id: string; slack_enabled: boolean; slack_webhook_url: string | null;
  email_enabled: boolean; whatsapp_enabled: boolean;
};
type Person = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; status: string };

const smtpConfigured = () => !!(Deno.env.get("SMTP_USER") && Deno.env.get("SMTP_PASS"));
const whatsappConfigured = () =>
  !!(Deno.env.get("MSG91_AUTH_KEY") && Deno.env.get("MSG91_WA_NUMBER") && Deno.env.get("MSG91_WA_TEMPLATE"));

const nameOf = (p?: Person | null) => [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "there";
const fmtDate = (d?: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
const taskLink = (taskId?: string | null) => `${APP_URL}/tasks${taskId ? `?task=${taskId}` : ""}`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Plain-text line used by every channel. */
function messageFor(row: Outbox, recipient?: Person | null): { subject: string; text: string } {
  const p = row.payload || {};
  const due = p.due_date ? ` · due ${fmtDate(p.due_date)}` : "";
  const project = p.project_name ? ` [${p.project_name}]` : "";
  switch (row.event) {
    case "task_assigned":
      return {
        subject: `New task: ${p.title}`,
        text: `${p.actor_name} assigned "${p.title}"${project} to ${p.assignee_name || nameOf(recipient)} (${p.priority} priority${due}).`,
      };
    case "task_status":
      return {
        subject: `Task ${String(p.status).toLowerCase()}: ${p.title}`,
        text: `${p.actor_name} moved "${p.title}"${project} from ${p.from_status} to ${p.status}.`,
      };
    case "reminder_digest": {
      const items: any[] = p.items || [];
      const over = items.filter((i) => i.bucket === "overdue").length;
      const lines = items.map((i) => `• ${i.title} — ${
        i.bucket === "overdue" ? `overdue since ${fmtDate(i.due_date)}` : i.bucket === "today" ? "due today" : "due tomorrow"}`);
      return {
        subject: over ? `${over} overdue task${over === 1 ? "" : "s"}` : `${items.length} task${items.length === 1 ? "" : "s"} due soon`,
        text: `Reminder for ${nameOf(recipient)}:\n${lines.join("\n")}`,
      };
    }
  }
}

// ── Channel senders ─────────────────────────────────────────────────────────
async function sendSlack(webhook: string, text: string, link?: string) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        ...(link ? [{ type: "context", elements: [{ type: "mrkdwn", text: `<${link}|Open in CrewCore>` }] }] : []),
      ],
    }),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
async function sendEmail(to: string, subject: string, text: string, link?: string) {
  if (!smtpConfigured()) throw new Error("SMTP not configured");
  const port = parseInt(Deno.env.get("SMTP_PORT") || "465");
  transporter ??= nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: Deno.env.get("SMTP_USER"), pass: Deno.env.get("SMTP_PASS") },
  });
  const from = Deno.env.get("SMTP_FROM") || `Crewcore <${Deno.env.get("SMTP_USER")}>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:560px">
    <h2 style="font-size:16px;margin:0 0 12px">${escapeHtml(subject)}</h2>
    <p style="white-space:pre-line;line-height:1.5">${escapeHtml(text)}</p>
    ${link ? `<p><a href="${link}" style="background:#6C5CE7;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Open in CrewCore</a></p>` : ""}
    <p style="color:#9ca3af;font-size:12px;margin-top:20px">You get this because your company enabled task email notifications in CrewCore.</p></div>`;
  await transporter.sendMail({ from, to, subject: `CrewCore · ${subject}`, text: `${text}\n\n${link || ""}`, html });
}

function normalizeIndianPhone(phone?: string | null): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
}

async function sendWhatsApp(phone: string, recipientName: string, text: string) {
  if (!whatsappConfigured()) throw new Error("MSG91 WhatsApp not configured");
  // MSG91 bulk template endpoint. Template must have exactly two body variables.
  const res = await fetch("https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/", {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: Deno.env.get("MSG91_AUTH_KEY")! },
    body: JSON.stringify({
      integrated_number: Deno.env.get("MSG91_WA_NUMBER"),
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: Deno.env.get("MSG91_WA_TEMPLATE"),
          language: { code: Deno.env.get("MSG91_WA_LANG") || "en", policy: "deterministic" },
          to_and_components: [{
            to: [phone],
            components: {
              body_1: { type: "text", value: recipientName.slice(0, 60) },
              // WhatsApp template variables can't contain newlines/tabs or 4+ spaces.
              body_2: { type: "text", value: text.replace(/\s*\n\s*/g, " | ").replace(/\s{4,}/g, " ").slice(0, 900) },
            },
          }],
        },
      },
    }),
  });
  const body = await res.text();
  if (!res.ok || /"type"\s*:\s*"error"/i.test(body)) throw new Error(`MSG91 ${res.status}: ${body.slice(0, 200)}`);
}

// ── Process the outbox ──────────────────────────────────────────────────────
async function processOutbox(db: ReturnType<typeof createClient>) {
  const { data: rows, error } = await db.rpc("notification_outbox_claim", { p_limit: 100 });
  if (error) throw error;
  const outbox = (rows || []) as Outbox[];
  if (outbox.length === 0) return { processed: 0 };

  const tenantIds = [...new Set(outbox.map((r) => r.tenant_id))];
  const personIds = [...new Set(outbox.flatMap((r) => r.recipients || []))];
  const [{ data: channelRows }, { data: people }] = await Promise.all([
    db.from("tenant_notification_channels").select("*").in("tenant_id", tenantIds),
    personIds.length
      ? db.from("profiles").select("id, first_name, last_name, email, phone, status").in("id", personIds)
      : Promise.resolve({ data: [] as Person[] }),
  ]);
  const channels = new Map((channelRows || []).map((c: Channels) => [c.tenant_id, c]));
  const personById = new Map((people || []).map((p: Person) => [p.id, p]));

  // Slack: reminder digests are combined into ONE message per company.
  const slackDigest = new Map<string, string[]>();
  let processed = 0;

  for (const row of outbox) {
    const c = channels.get(row.tenant_id);
    const errors: string[] = [];
    const recipients = (row.recipients || []).map((id) => personById.get(id)).filter((p): p is Person => !!p && p.status === "Active");
    const link = taskLink(row.task_id);

    if (c?.slack_enabled && c.slack_webhook_url) {
      if (row.event === "reminder_digest") {
        const { text } = messageFor(row, recipients[0]);
        const list = slackDigest.get(row.tenant_id) || [];
        list.push(`*${nameOf(recipients[0])}*\n${text.split("\n").slice(1).join("\n")}`);
        slackDigest.set(row.tenant_id, list);
      } else {
        const { text } = messageFor(row, recipients[0]);
        await sendSlack(c.slack_webhook_url, text, link).catch((e) => errors.push(`slack: ${e.message}`));
      }
    }

    for (const person of recipients) {
      const { subject, text } = messageFor(row, person);
      if (c?.email_enabled && person.email && !PLACEHOLDER_EMAIL.test(person.email)) {
        await sendEmail(person.email, subject, text, link).catch((e) => errors.push(`email: ${e.message}`));
      }
      const phone = normalizeIndianPhone(person.phone);
      if (c?.whatsapp_enabled && phone) {
        await sendWhatsApp(phone, nameOf(person), text).catch((e) => errors.push(`whatsapp: ${e.message}`));
      }
    }

    await db.rpc("notification_outbox_complete", { p_id: row.id, p_error: errors.length ? errors.join("; ").slice(0, 500) : null });
    processed++;
  }

  for (const [tenantId, blocks] of slackDigest) {
    const c = channels.get(tenantId)!;
    const text = `:alarm_clock: *Task reminders for today*\n\n${blocks.join("\n\n")}`;
    await sendSlack(c.slack_webhook_url!, text.slice(0, 3800), taskLink(null)).catch((e) => console.error("slack digest", e.message));
  }

  return { processed };
}

// ── HTTP entry ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode || "process";

    if (mode === "process") return json(await processOutbox(db));

    // status / test need a signed-in user.
    const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "Not authenticated." }, 401);

    if (mode === "status") return json({ email: smtpConfigured(), whatsapp: whatsappConfigured(), slack: true });

    if (mode === "test") {
      const { data: me } = await db.from("profiles")
        .select("id, tenant_id, role, first_name, last_name, email, phone, status").eq("id", user.id).single();
      if (!me || !["admin", "superadmin"].includes(me.role)) return json({ error: "Only HR/admin can send test notifications." }, 403);

      const text = `This is a test notification from CrewCore. Task alerts will arrive here.`;
      if (body.channel === "slack") {
        const { data: c } = await db.from("tenant_notification_channels").select("slack_webhook_url").eq("tenant_id", me.tenant_id).maybeSingle();
        const url = body.webhook_url || c?.slack_webhook_url;
        if (!url || !/^https:\/\/hooks\.slack\.com\//.test(url)) return json({ error: "Enter a valid Slack webhook URL (https://hooks.slack.com/...)." }, 400);
        await sendSlack(url, `:white_check_mark: ${text}`, taskLink(null));
      } else if (body.channel === "email") {
        if (!me.email || PLACEHOLDER_EMAIL.test(me.email)) return json({ error: "Your profile has no real email address." }, 400);
        await sendEmail(me.email, "Test notification", text, taskLink(null));
      } else if (body.channel === "whatsapp") {
        const phone = normalizeIndianPhone(me.phone);
        if (!phone) return json({ error: "Your profile has no valid Indian mobile number." }, 400);
        await sendWhatsApp(phone, nameOf(me as Person), text);
      } else {
        return json({ error: "Unknown channel." }, 400);
      }
      return json({ ok: true });
    }

    return json({ error: "Unknown mode." }, 400);
  } catch (e) {
    console.error("notification-dispatch:", e);
    return json({ error: (e as Error).message || "Failed" }, 500);
  }
});
