import { useEffect, useState } from 'react';
import { showToast } from '@/components/Toast';
import { getNotificationChannels, saveNotificationChannels, getChannelStatus, sendTestNotification } from '@/services/notificationChannelService';

const DEFAULTS = {
  slack_enabled: false, slack_webhook_url: '', email_enabled: false, whatsapp_enabled: false,
  notify_status_changes: true, daily_reminders: true,
};

function Toggle({ checked, onChange, disabled, label, hint }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
      </span>
    </label>
  );
}

/**
 * HR/admin: where task notifications go besides the in-app bell + mobile push
 * (which are always on). Settings live in tenant_notification_channels;
 * sending is done by the notification-dispatch edge function.
 */
export default function NotificationChannelsCard({ tenantId }) {
  const [form, setForm] = useState(DEFAULTS);
  const [server, setServer] = useState({ email: false, whatsapp: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    Promise.all([getNotificationChannels(tenantId), getChannelStatus()]).then(([ch, st]) => {
      if (cancelled) return;
      if (ch.data) setForm({ ...DEFAULTS, ...ch.data, slack_webhook_url: ch.data.slack_webhook_url || '' });
      if (st.data) setServer(st.data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    const url = form.slack_webhook_url.trim();
    if (form.slack_enabled && !/^https:\/\/hooks\.slack\.com\//.test(url)) {
      return showToast('Paste a Slack incoming-webhook URL (https://hooks.slack.com/…)', 'error');
    }
    setSaving(true);
    const { error } = await saveNotificationChannels(tenantId, { ...form, slack_webhook_url: url || null });
    setSaving(false);
    if (error) return showToast(error.message, 'error');
    showToast('Notification settings saved', 'success');
  };

  const handleTest = async (channel) => {
    setTesting(channel);
    const { error } = await sendTestNotification(channel, channel === 'slack' ? form.slack_webhook_url.trim() : undefined);
    setTesting('');
    if (error) return showToast(error, 'error');
    showToast(`Test ${channel} notification sent`, 'success');
  };

  return (
    <div className="card">
      <div className="card-header"><h3><i className="fas fa-bell" style={{ marginRight: 8, color: 'var(--primary)' }} />Task Notifications &amp; Reminders</h3></div>
      <div className="card-body">
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              In-app and mobile push notifications are always on. Choose extra channels for task assignments,
              status changes and the 9:00 AM daily reminder of due and overdue tasks.
            </p>

            <Toggle checked={form.daily_reminders} onChange={set('daily_reminders')}
              label="Daily reminders (9:00 AM)" hint="Each person gets a digest of tasks due today, tomorrow or overdue; assigners hear about overdue tasks." />
            <Toggle checked={form.notify_status_changes} onChange={set('notify_status_changes')}
              label="Send assignments & status changes to the channels below" />

            <hr style={{ border: 0, borderTop: '1px solid var(--border-light)', margin: '10px 0' }} />

            <Toggle checked={form.slack_enabled} onChange={set('slack_enabled')} label="Slack"
              hint="Posts to one Slack channel via an incoming webhook (Slack → Apps → Incoming Webhooks)." />
            {form.slack_enabled && (
              <div style={{ display: 'flex', gap: 8, margin: '0 0 8px 24px' }}>
                <input className="form-input" placeholder="https://hooks.slack.com/services/…" value={form.slack_webhook_url}
                  onChange={(e) => set('slack_webhook_url')(e.target.value)} />
                <button className="btn btn-outline btn-sm" disabled={testing === 'slack' || !form.slack_webhook_url} onClick={() => handleTest('slack')}>
                  {testing === 'slack' ? 'Sending…' : 'Test'}
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Toggle checked={form.email_enabled} onChange={set('email_enabled')} disabled={!server.email && !form.email_enabled}
                  label="Email" hint={server.email ? "Sent to each person's email on file (phone-only accounts are skipped)." : 'Email sending is not configured on the server.'} />
              </div>
              {form.email_enabled && <button className="btn btn-outline btn-sm" disabled={testing === 'email'} onClick={() => handleTest('email')}>{testing === 'email' ? 'Sending…' : 'Test'}</button>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Toggle checked={form.whatsapp_enabled} onChange={set('whatsapp_enabled')} disabled={!server.whatsapp && !form.whatsapp_enabled}
                  label="WhatsApp" hint={server.whatsapp ? "Sent to each person's mobile number via an approved WhatsApp template." : 'WhatsApp (MSG91) is not set up yet — contact CrewCore support to enable it.'} />
              </div>
              {form.whatsapp_enabled && <button className="btn btn-outline btn-sm" disabled={testing === 'whatsapp'} onClick={() => handleTest('whatsapp')}>{testing === 'whatsapp' ? 'Sending…' : 'Test'}</button>}
            </div>

            <div style={{ marginTop: 14, textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
