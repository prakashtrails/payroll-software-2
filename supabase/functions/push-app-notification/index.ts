import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Turns every INSERT into `app_notifications` — the in-app inbox both the
// web app (src/services/notificationService.js) and the mobile app
// (services/notificationService.ts) already write every notification type
// through (leave submitted/approved/rejected, WFH, onboarding, policies,
// announcements, ~40 call sites total) — into a real Expo push notification.
//
// This is a Supabase Database Webhook target, NOT a user-facing endpoint:
// wired via Dashboard -> Database -> Webhooks -> table `app_notifications`,
// event Insert, target this function. Supabase calls it server-to-server
// with its own service-role-derived auth, so there's no end-user JWT to
// check here (unlike send-notification, which IS user-facing and gates on
// the caller being admin/manager) — trusting the payload is safe because
// only Supabase's own webhook dispatcher can reach this URL with a payload
// shaped like a Database Webhook event.
//
// Deliberately separate from the existing send-notification function (which
// stays exactly as-is, still used for punch in/out and any admin-composed
// broadcast) — this one's job is narrower: given a single already-inserted
// app_notifications row, push it to that one profile's registered devices.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-name',
}

type AppNotificationRow = {
  id: string
  tenant_id: string
  profile_id: string
  type: string
  title: string
  body: string | null
  link_key: string | null
  related_id: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    const payload = await req.json() as { type?: string; table?: string; record?: AppNotificationRow }
    const record = payload?.record
    if (payload?.type !== 'INSERT' || payload?.table !== 'app_notifications' || !record?.profile_id) {
      return new Response(JSON.stringify({ message: 'Ignored — not an app_notifications insert' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
    }

    const { data: tokenRows, error: tokenError } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('profile_id', record.profile_id)
    if (tokenError) throw tokenError

    const tokens = [...new Set((tokenRows || []).map((t) => t.token))]
    if (tokens.length === 0) {
      return new Response(JSON.stringify({ message: 'No registered devices for this profile', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
    }

    const messages = tokens.map((to) => ({
      to,
      title: record.title,
      body: record.body ?? '',
      sound: 'default',
      data: { type: record.type, link_key: record.link_key, related_id: record.related_id },
    }))

    let sent = 0
    const BATCH = 100
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH)
      const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (pushRes.ok) sent += batch.length
      else console.error('Expo push send failed:', await pushRes.text())
    }

    return new Response(
      JSON.stringify({ message: 'Push dispatched', devices: tokens.length, sent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
