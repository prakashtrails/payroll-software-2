import { supabase } from '@/lib/supabase';

// Per-company external notification channels (Slack / email / WhatsApp).
// HR/admin only — RLS hides the row (and its Slack webhook URL) from everyone else.

export async function getNotificationChannels(tenantId) {
  const { data, error } = await supabase
    .from('tenant_notification_channels')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return { data, error };
}

export async function saveNotificationChannels(tenantId, settings) {
  const { error } = await supabase.from('tenant_notification_channels').upsert({
    tenant_id: tenantId,
    slack_enabled: !!settings.slack_enabled,
    slack_webhook_url: settings.slack_webhook_url || null,
    email_enabled: !!settings.email_enabled,
    whatsapp_enabled: !!settings.whatsapp_enabled,
    notify_status_changes: !!settings.notify_status_changes,
    daily_reminders: !!settings.daily_reminders,
  }, { onConflict: 'tenant_id' });
  return { error };
}

/** Which server-side channels have their secrets configured: { email, whatsapp, slack }. */
export async function getChannelStatus() {
  const { data, error } = await supabase.functions.invoke('notification-dispatch', { body: { mode: 'status' } });
  return { data: error ? null : data, error };
}

export async function sendTestNotification(channel, webhookUrl) {
  const { data, error } = await supabase.functions.invoke('notification-dispatch', {
    body: { mode: 'test', channel, webhook_url: webhookUrl },
  });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context?.json())?.error || msg; } catch { /* keep generic message */ }
    return { error: msg };
  }
  return { error: data?.error || null };
}
