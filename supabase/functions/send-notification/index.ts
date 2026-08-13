import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-name',
}

type Target = 'all' | `role:${string}` | `user:${string}`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // Identify the caller and require them to be an admin/manager/superadmin
    // of the tenant they're sending to — this uses the service-role key
    // internally, so without this check any caller holding just the public
    // anon key could blast attacker-controlled push notifications to any
    // tenant's employees.
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 })
    }

    const { tenant_id, target, type, title, body, data } = await req.json() as {
      tenant_id: string
      target: Target
      type: string
      title: string
      body: string
      data?: Record<string, unknown>
    }

    if (!tenant_id || !target || !type || !title) {
      throw new Error('tenant_id, target, type and title are required')
    }

    const { data: callerProfile, error: callerProfileErr } = await supabase
      .from('profiles')
      .select('role, tenant_id')
      .eq('id', caller.id)
      .single()

    const isAuthorized = !callerProfileErr && callerProfile && (
      callerProfile.role === 'superadmin' ||
      (callerProfile.tenant_id === tenant_id && ['admin', 'manager'].includes(callerProfile.role))
    )
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Not authorized to notify this tenant.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 })
    }

    // Resolve the list of recipient profiles for this tenant + target.
    let profilesQuery = supabase.from('profiles').select('id').eq('tenant_id', tenant_id)
    if (target === 'all') {
      // no extra filter
    } else if (target.startsWith('role:')) {
      profilesQuery = profilesQuery.eq('role', target.slice('role:'.length))
    } else if (target.startsWith('user:')) {
      profilesQuery = profilesQuery.eq('id', target.slice('user:'.length))
    } else {
      throw new Error(`Invalid target: ${target}`)
    }

    const { data: profiles, error: profilesError } = await profilesQuery
    if (profilesError) throw profilesError
    const profileIds = (profiles || []).map((p) => p.id)

    if (profileIds.length === 0) {
      return new Response(JSON.stringify({ message: 'No recipients found', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
    }

    // Record in-app notification history for every recipient, push or not.
    const notificationRows = profileIds.map((profile_id) => ({
      tenant_id, profile_id, type, title, body: body ?? '', data: data ?? {},
    }))
    const { error: notifError } = await supabase.from('notifications').insert(notificationRows)
    if (notifError) throw notifError

    // Fetch push tokens for those recipients and send via Expo Push API.
    const { data: tokenRows, error: tokenError } = await supabase
      .from('push_tokens')
      .select('token')
      .in('profile_id', profileIds)
    if (tokenError) throw tokenError

    const tokens = [...new Set((tokenRows || []).map((t) => t.token))]
    let sent = 0
    const BATCH = 100
    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH)
      const messages = batch.map((to) => ({
        to, title, body: body ?? '', data: { type, ...(data ?? {}) }, sound: 'default',
      }))
      const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(messages),
      })
      if (pushRes.ok) sent += batch.length
      else console.error('Expo push send failed:', await pushRes.text())
    }

    return new Response(
      JSON.stringify({ message: 'Notifications dispatched', recipients: profileIds.length, sent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
