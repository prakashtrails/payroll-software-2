import React from 'react';
import { Link } from 'react-router-dom';
import { timeAgo } from '@/lib/helpers';

/** Generic "recent updates" feed — announcements, policies, KRAs, PIPs, etc. See activityFeedService.js. */
export default function RecentUpdatesCard({ items, loading }) {
  return (
    <div className="card">
      <div className="card-header"><h3>Recent Updates</h3></div>
      <div className="card-body">
        {loading ? (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : !items || items.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-bullhorn empty-icon" />
            <h3>No updates yet</h3>
            <p>Announcements, KRAs, and PIPs will appear here.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map((it) => (
              <Link
                key={it.id}
                to={it.link}
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', textDecoration: 'none',
                  color: 'inherit', padding: '8px 4px', borderRadius: 8,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover, rgba(0,0,0,.03))'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0, marginTop: 1,
                  background: it.color, opacity: 0.15,
                  position: 'relative',
                }}>
                  <i className={`fas ${it.icon}`} style={{
                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: it.color, opacity: 1, fontSize: 12,
                  }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{it.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{timeAgo(it.date)}</span>
                  </div>
                  {it.subtitle && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.subtitle}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
