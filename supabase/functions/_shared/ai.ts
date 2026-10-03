// Shared plumbing for the AI edge functions (ai-assistant, ai-meeting-extract):
// caller auth, premium-feature check, daily cap + token accounting, and the
// Anthropic client. Nothing here talks to Claude by itself.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const AI_MODEL = "claude-opus-5-5";
// Server-side refusal fallback: a declined request is re-run on Anthropic's
// recommended fallback model inside the same call.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Caller = {
  id: string;
  tenant_id: string;
  role: string;
  outlet_id: string | null;
  first_name: string | null;
  last_name: string | null;
};

export type AiContext = {
  admin: SupabaseClient;   // service role: usage, feature check
  user: SupabaseClient;    // caller's JWT: every data read/write goes through RLS
  caller: Caller;
  anthropic: Anthropic;
};

/**
 * Authenticates the caller, checks the premium feature is on for their
 * company/outlet and reserves one request against today's cap.
 * Returns a ready context or an error Response.
 */
export async function openAiContext(req: Request, featureKey: "ai_assistant" | "ai_meetings", usageFeature: "assistant" | "meetings", dailyCap: number)
  : Promise<AiContext | Response> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI is not configured yet. Ask your CrewCore administrator to add the AI key.", code: "not_configured" }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user: authUser } } = await user.auth.getUser();
  if (!authUser) return json({ error: "Not authenticated." }, 401);

  const { data: caller } = await admin.from("profiles")
    .select("id, tenant_id, role, outlet_id, first_name, last_name, status")
    .eq("id", authUser.id).single();
  if (!caller || caller.status !== "Active" || !caller.tenant_id) return json({ error: "Your account is not active." }, 403);

  const { data: enabled } = await admin.rpc("ai_feature_enabled", { p_tenant: caller.tenant_id, p_outlet: caller.outlet_id, p_key: featureKey });
  if (!enabled) return json({ error: "This AI feature is not enabled for your company.", code: "disabled" }, 403);

  const { data: ok } = await admin.rpc("ai_usage_reserve", { p_tenant: caller.tenant_id, p_profile: caller.id, p_feature: usageFeature, p_cap: dailyCap });
  if (!ok) return json({ error: `You've reached today's limit of ${dailyCap} AI requests. It resets at midnight.`, code: "limit" }, 429);

  return { admin, user, caller: caller as Caller, anthropic: new Anthropic({ apiKey, maxRetries: 2 }) };
}

export async function recordTokens(ctx: AiContext, usageFeature: "assistant" | "meetings", input: number, output: number) {
  await ctx.admin.rpc("ai_usage_add_tokens", { p_profile: ctx.caller.id, p_feature: usageFeature, p_in: input, p_out: output });
}

/** Maps SDK errors to a user-safe message without leaking internals. */
export function aiErrorResponse(e: unknown): Response {
  console.error("AI error:", e);
  if (e instanceof Anthropic.RateLimitError) return json({ error: "The AI service is busy. Please try again in a minute." }, 429);
  if (e instanceof Anthropic.AuthenticationError) return json({ error: "AI is misconfigured (invalid key). Contact your administrator.", code: "not_configured" }, 503);
  if (e instanceof Anthropic.BadRequestError) return json({ error: "The AI could not process this request." }, 400);
  if (e instanceof Anthropic.APIError) return json({ error: "The AI service had a problem. Please try again." }, 502);
  return json({ error: "Something went wrong. Please try again." }, 500);
}
