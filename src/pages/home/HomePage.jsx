import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { showToast } from '@/components/Toast';
import { DashboardContent } from '@/pages/employee/DashboardPage';
import GeneralDashboard from '@/pages/dashboard/DashboardPage';
import ManagerDashboard from '@/pages/dashboard/ManagerDashboardPage';
import WelcomeContent from './WelcomeContent';
import { listHolidays } from '@/services/tenantService';
import { listUpcomingBirthdays, listUpcomingAnniversaries, listCelebrations } from '@/services/profileDetailsService';
import { listAnnouncements, listMyAcknowledgements, acknowledgeAnnouncement } from '@/services/announcementService';
import { fullName, getInitials, getAvatarColor, isRaniwalaTenant } from '@/lib/helpers';
import { getHolidayTheme } from '@/lib/holidayThemes';
import { useTodayDate } from '@/hooks/useTodayDate';

function HolidaysCard({ tenant, outletId }) {
  const today = useTodayDate();
  const [allHolidays, setAllHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    listHolidays(tenant.id, outletId).then(({ data }) => {
      if (cancelled) return;
      setAllHolidays(data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenant, outletId]);

  // Re-filtered live off `today` (which itself auto-advances at local midnight,
  // see useTodayDate) so a holiday stays pinned to its own day and the card
  // rolls over to the next one on its own — no page reload needed.
  const holidays = useMemo(
    () => allHolidays.filter((h) => h.status === 'Approved' && h.date >= today).slice(0, 8),
    [allHolidays, today]
  );

  // A manual prev/next pick shouldn't survive a day change or a fresh fetch —
  // snap back to the current/soonest holiday.
  useEffect(() => { setIndex(0); }, [today, allHolidays]);

  const current = holidays[index];
  const theme = getHolidayTheme(current?.name);
  const prev = () => setIndex((i) => (i - 1 + holidays.length) % holidays.length);
  const next = () => setIndex((i) => (i + 1) % holidays.length);

  return (
    <div className="card holiday-banner-card">
      <div className="holiday-banner-label">
        <span>Holidays</span>
        {holidays.length > 1 && <span className="holiday-banner-count">{index + 1} / {holidays.length}</span>}
      </div>
      {loading ? (
        <div className="holiday-banner-loading"><div className="spinner" /></div>
      ) : !current ? (
        <div className="holiday-banner-empty">No upcoming holidays.</div>
      ) : (
        <div className="holiday-banner" style={{ background: theme.gradient }}>
          {holidays.length > 1 && (
            <button className="holiday-nav prev" onClick={prev} aria-label="Previous holiday">
              <i className="fas fa-chevron-left" />
            </button>
          )}
          <i className={`fas ${theme.icon} holiday-banner-icon`} />
          <div className="holiday-banner-text">
            <div className="holiday-banner-name">{current.name}</div>
            <div className="holiday-banner-date">
              {new Date(current.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
          {holidays.length > 1 && (
            <button className="holiday-nav next" onClick={next} aria-label="Next holiday">
              <i className="fas fa-chevron-right" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PersonRow({ profile, subtitleParts, dateLabel, isToday, extraBadge }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
      <div
        className="emp-avatar"
        style={{ width: 38, height: 38, fontSize: 12, background: `linear-gradient(135deg, ${getAvatarColor(profile?.id)})` }}
      >
        {getInitials(profile?.first_name, profile?.last_name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile ? fullName(profile) : ''}
        </div>
        {subtitleParts.filter(Boolean).length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitleParts.filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {extraBadge}
        <span className={`badge ${isToday ? 'badge-success' : 'badge-info'}`}>{dateLabel}</span>
      </div>
    </div>
  );
}

function BirthdaysCard({ tenant }) {
  const [birthdays, setBirthdays] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    listUpcomingBirthdays(5).then(({ data }) => {
      if (!cancelled) { setBirthdays(data || []); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [tenant]);

  return (
    <div className="card">
      <div className="card-header">
        <h3><i className="fas fa-cake-candles" style={{ color: 'var(--purple)', marginRight: 8 }} />Upcoming Birthdays</h3>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" /></div>
        ) : birthdays.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No birthdays in the next 5 days.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 190, overflowY: 'auto' }}>
            {birthdays.map((b) => (
              <PersonRow
                key={b.profile?.id}
                profile={b.profile}
                subtitleParts={[b.profile?.division, b.profile?.outlet_location]}
                isToday={b.diffDays === 0}
                dateLabel={b.diffDays === 0 ? '🎉 Today' : new Date(b.date_of_birth + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnniversariesCard({ tenant }) {
  const [anniversaries, setAnniversaries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    listUpcomingAnniversaries(5).then(({ data }) => {
      if (!cancelled) { setAnniversaries(data || []); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [tenant]);

  return (
    <div className="card">
      <div className="card-header">
        <h3><i className="fas fa-award" style={{ color: 'var(--primary)', marginRight: 8 }} />Upcoming Work Anniversaries</h3>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" /></div>
        ) : anniversaries.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No work anniversaries in the next 5 days.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: '8px 24px', maxHeight: 190, overflowY: 'auto' }}>
            {anniversaries.map((a) => (
              <PersonRow
                key={a.profile?.id}
                profile={a.profile}
                subtitleParts={[a.profile?.division, a.profile?.outlet_location]}
                isToday={a.diffDays === 0}
                dateLabel={a.diffDays === 0 ? '🎊 Today' : new Date(a.join_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                extraBadge={<span className="badge badge-purple">{a.years} yr{a.years === 1 ? '' : 's'}</span>}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const RANIWALA_HR_CELEBRATION_DAYS = 5;

// Raniwala-only: birthdays + work anniversaries in one card (one RPC call).
// HR gets everyone's for the next 5 days; managers / HODs their team's for
// today only (the RPC forces that, see 20260929_3). Other roles never render it.
function CelebrationsCard({ tenant, days }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    listCelebrations(days).then(({ data }) => {
      if (cancelled) return;
      const merged = [
        ...data.birthdays.map((b) => ({ ...b, kind: 'birthday' })),
        ...data.anniversaries.map((a) => ({ ...a, kind: 'anniversary' })),
      ].sort((x, y) => x.diffDays - y.diffDays);
      setRows(merged);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenant, days]);

  const dayLabel = (diffDays) => {
    if (diffDays === 0) return 'Today';
    const d = new Date();
    d.setDate(d.getDate() + diffDays);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3><i className="fas fa-cake-candles" style={{ color: 'var(--purple)', marginRight: 8 }} />Birthdays &amp; Anniversaries</h3>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" /></div>
        ) : rows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {days > 0 ? `No birthdays or work anniversaries in the next ${days} days.` : 'No birthdays or work anniversaries today.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
            {rows.map((r) => (
              <PersonRow
                key={`${r.kind}-${r.profile?.id}`}
                profile={r.profile}
                subtitleParts={[r.kind === 'birthday' ? 'Birthday' : 'Work Anniversary', r.profile?.division, r.profile?.outlet_location]}
                isToday={r.diffDays === 0}
                dateLabel={`${r.kind === 'birthday' ? '🎂' : '🎊'} ${dayLabel(r.diffDays)}`}
                extraBadge={r.kind === 'anniversary' && <span className="badge badge-purple">{r.years} yr{r.years === 1 ? '' : 's'}</span>}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const ANNOUNCEMENT_LIMIT = 5;
const BODY_PREVIEW_CHARS = 220;

function AnnouncementItem({ announcement: a, acknowledgedAt, acking, onAcknowledge }) {
  const [expanded, setExpanded] = useState(false);
  const unread = !acknowledgedAt;
  const body = a.body || '';
  const long = body.length > BODY_PREVIEW_CHARS || body.split('\n').length > 3;

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 10,
      border: '1px solid var(--border)',
      borderLeft: `4px solid ${unread ? 'var(--warning)' : 'var(--border)'}`,
    }}>
      <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {a.title}
        {unread && <span className="badge badge-warning">New</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
        {a.author ? fullName(a.author) : 'HR'} · {new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
      </div>
      {body && (
        <>
          <p style={{
            margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
            ...(!expanded && long && { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
          }}>
            {body}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, color: 'var(--primary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </>
      )}
      <div style={{ marginTop: 10 }}>
        {unread ? (
          <button className="btn btn-primary btn-sm" disabled={acking} onClick={() => onAcknowledge(a.id)}>
            <i className="fas fa-check" /> {acking ? 'Saving…' : 'Mark as read'}
          </button>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
            <i className="fas fa-check-circle" /> Read on {new Date(acknowledgedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  );
}

// Raniwala-only: announcements get their own priority section at the very top
// of Home (unread first), instead of being mixed into the Recent Updates feed
// — that feed sits below as "Updates" (no policies; those stay on /policies).
// "Mark as read" writes the same acknowledgement as the Announcements page.
function AnnouncementsSection({ tenant, profile }) {
  const [announcements, setAnnouncements] = useState([]);
  const [acks, setAcks] = useState({});
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState(null);

  useEffect(() => {
    if (!tenant || !profile) return;
    let cancelled = false;
    Promise.all([
      listAnnouncements(tenant.id, { limit: ANNOUNCEMENT_LIMIT }),
      listMyAcknowledgements(tenant.id, profile.id),
    ]).then(([annRes, ackRes]) => {
      if (cancelled) return;
      setAnnouncements(annRes.data || []);
      setAcks(ackRes.data || {});
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenant, profile]);

  const handleAcknowledge = async (id) => {
    setAcking(id);
    const { error } = await acknowledgeAnnouncement(id, profile.id, tenant.id);
    setAcking(null);
    if (error) return showToast('Could not mark as read: ' + error.message, 'error');
    setAcks((m) => ({ ...m, [id]: new Date().toISOString() }));
  };

  // Unread first, then newest first. Sorted once per fetch (not on every
  // acknowledgement) so a card doesn't jump away right after it's marked read.
  const sorted = useMemo(
    () => [...announcements].sort((x, y) => (!!acks[x.id] - !!acks[y.id]) || (new Date(y.created_at) - new Date(x.created_at))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [announcements]
  );
  const unreadCount = announcements.filter((a) => !acks[a.id]).length;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="fas fa-bullhorn" style={{ color: 'var(--warning)' }} />Announcements
          {unreadCount > 0 && <span className="badge badge-warning">{unreadCount} unread</span>}
        </h3>
        <Link to="/announcements" className="btn btn-outline btn-sm">View all</Link>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" /></div>
        ) : sorted.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No announcements right now.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 440, overflowY: 'auto' }}>
            {sorted.map((a) => (
              <AnnouncementItem
                key={a.id}
                announcement={a}
                acknowledgedAt={acks[a.id]}
                acking={acking === a.id}
                onAcknowledge={handleAcknowledge}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { profile, tenant } = useAuth();
  const { isEnabled } = useFeatures();
  const raniwala = isRaniwalaTenant(tenant);
  // Raniwala birthdays / anniversaries: HR next 5 days, managers / HODs
  // today (their team), employees today (their own outlet — the RPC enforces
  // scope and today-only), management doesn't get the card.
  const celebrationDays = profile?.role === 'admin' ? RANIWALA_HR_CELEBRATION_DAYS
    : ['manager', 'hod', 'employee'].includes(profile?.role) ? 0
    : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'welcome' ? 'welcome' : 'dashboard';

  const setTab = (t) => setSearchParams(t === 'dashboard' ? {} : { tab: t });

  const role = profile?.role;
  const RoleDashboard = role === 'admin' ? GeneralDashboard
    : role === 'manager' ? ManagerDashboard
    : DashboardContent;

  return (
    <>
      <Header title="Home" breadcrumb={profile ? fullName(profile) : ''} />

      <div className="tab-bar-wrap">
        <div className="tabs">
          <button className={`tab-btn ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
          <button className={`tab-btn ${tab === 'welcome' ? 'active' : ''}`} onClick={() => setTab('welcome')}>Welcome</button>
        </div>
      </div>

      {tab === 'dashboard' && (
        <>
          <div className="subtab-bar-wrap">
            {raniwala ? (
              <>
                {isEnabled('announcements') && <AnnouncementsSection tenant={tenant} profile={profile} />}
                {celebrationDays === null ? (
                  <HolidaysCard tenant={tenant} outletId={profile?.outlet_id} />
                ) : (
                  <div className="grid-2" style={{ marginBottom: 0 }}>
                    <HolidaysCard tenant={tenant} outletId={profile?.outlet_id} />
                    <CelebrationsCard tenant={tenant} days={celebrationDays} />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid-2" style={{ marginBottom: 0 }}>
                  <HolidaysCard tenant={tenant} outletId={profile?.outlet_id} />
                  <BirthdaysCard tenant={tenant} />
                </div>
                <div style={{ marginTop: 16 }}>
                  <AnniversariesCard tenant={tenant} />
                </div>
              </>
            )}
          </div>
          <RoleDashboard embedded />
        </>
      )}

      {tab === 'welcome' && <WelcomeContent />}
    </>
  );
}
