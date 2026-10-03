import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { resolveNotificationLink } from '@/lib/notificationLinks';

function formatWhen(iso) {
  return new Date(iso).toLocaleString();
}

export default function NotificationsPage() {
  const { profile } = useAuth();
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications();
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const navigate = useNavigate();

  const visible = useMemo(
    () => (filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications),
    [notifications, filter]
  );

  const handleClick = (n) => {
    if (!n.is_read) markRead(n.id);
    const href = resolveNotificationLink(n.link_key, profile.role, n.related_id);
    if (href) navigate(href);
  };

  return (
    <>
      <Header
        title="Notifications"
        breadcrumb="Everything that needs your attention, in one place"
        actions={unreadCount > 0 && (
          <button className="btn btn-outline btn-sm" onClick={markAllRead}>
            <i className="fas fa-check-double" /> Mark all as read
          </button>
        )}
      />
      <div className="page-content">
        <div className="filter-bar">
          {[['all', 'All'], ['unread', `Unread${unreadCount ? ` (${unreadCount})` : ''}`]].map(([key, label]) => (
            <button
              key={key}
              className={`btn btn-sm ${filter === key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            {filter === 'unread' ? "You're all caught up." : 'No notifications yet.'}
          </div>
        ) : (
          <div className="card">
            {visible.map((n) => (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px',
                  borderTop: '1px solid var(--border)', cursor: 'pointer',
                  background: n.is_read ? 'transparent' : 'var(--bg)',
                }}
              >
                <span
                  style={{
                    marginTop: 6, width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: n.is_read ? 'transparent' : 'var(--primary)',
                    border: n.is_read ? '1px solid var(--border)' : 'none',
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: n.is_read ? 500 : 700, fontSize: 14 }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{n.body}</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>{formatWhen(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
