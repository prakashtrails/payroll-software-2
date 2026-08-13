import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { DashboardContent } from '@/pages/employee/DashboardPage';
import GeneralDashboard from '@/pages/dashboard/DashboardPage';
import ManagerDashboard from '@/pages/dashboard/ManagerDashboardPage';
import WelcomeContent from './WelcomeContent';
import { listHolidays } from '@/services/tenantService';
import { listUpcomingBirthdays } from '@/services/profileDetailsService';
import { fullName } from '@/lib/helpers';

// Keka illustrates each holiday's card with festival-specific art. We don't have
// a source of custom illustrations, so a themed gradient + FontAwesome icon per
// holiday keyword stands in for it — same visual idea (colorful, festive banner)
// without needing image assets.
const HOLIDAY_THEMES = [
  { match: /independence|republic/i, gradient: 'linear-gradient(120deg,#0b3d24,#15803d 45%,#f97316)', icon: 'fa-flag' },
  { match: /diwali|deepavali/i, gradient: 'linear-gradient(120deg,#7c2d12,#c2410c 50%,#f59e0b)', icon: 'fa-fire' },
  { match: /holi/i, gradient: 'linear-gradient(120deg,#7e22ce,#db2777 45%,#f59e0b 75%,#22c55e)', icon: 'fa-palette' },
  { match: /christmas/i, gradient: 'linear-gradient(120deg,#14532d,#166534 50%,#dc2626)', icon: 'fa-tree' },
  { match: /eid/i, gradient: 'linear-gradient(120deg,#0f766e,#0e7490 50%,#facc15)', icon: 'fa-moon' },
  { match: /gandhi/i, gradient: 'linear-gradient(120deg,#1e3a8a,#3730a3 60%,#93c5fd)', icon: 'fa-dove' },
  { match: /new year/i, gradient: 'linear-gradient(120deg,#312e81,#6d28d9 55%,#db2777)', icon: 'fa-champagne-glasses' },
  { match: /pongal|makar|sankranti/i, gradient: 'linear-gradient(120deg,#92400e,#d97706 55%,#fde047)', icon: 'fa-sun' },
  { match: /raksha|rakhi/i, gradient: 'linear-gradient(120deg,#9d174d,#db2777 55%,#f472b6)', icon: 'fa-hand-holding-heart' },
  { match: /friday|easter/i, gradient: 'linear-gradient(120deg,#312e81,#4338ca 55%,#a5b4fc)', icon: 'fa-cross' },
];
const DEFAULT_HOLIDAY_THEME = { gradient: 'linear-gradient(120deg,#312e81,#6d28d9 60%,#db2777)', icon: 'fa-gift' };

const getHolidayTheme = (name = '') => HOLIDAY_THEMES.find((t) => t.match.test(name)) || DEFAULT_HOLIDAY_THEME;

function HolidaysCard({ tenant }) {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    listHolidays(tenant.id).then(({ data }) => {
      if (cancelled) return;
      const upcoming = (data || [])
        .filter((h) => h.status === 'Approved' && h.date >= today)
        .slice(0, 8);
      setHolidays(upcoming);
      setIndex(0);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenant]);

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
        <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" /></div>
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

function BirthdaysCard({ tenant }) {
  const [birthdays, setBirthdays] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    listUpcomingBirthdays(tenant.id, 30).then(({ data }) => {
      if (!cancelled) { setBirthdays(data || []); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [tenant]);

  return (
    <div className="card">
      <div className="card-header"><h3>Upcoming Birthdays</h3></div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" /></div>
        ) : birthdays.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No birthdays in the next 30 days.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {birthdays.map((b) => (
              <div key={b.profile?.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{b.profile ? fullName(b.profile) : ''}{b.diffDays === 0 ? ' 🎉' : ''}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {b.diffDays === 0 ? 'Today' : new Date(b.date_of_birth + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { profile, tenant } = useAuth();
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
            <div className="grid-2" style={{ marginBottom: 0 }}>
              <HolidaysCard tenant={tenant} />
              <BirthdaysCard tenant={tenant} />
            </div>
          </div>
          <RoleDashboard embedded />
        </>
      )}

      {tab === 'welcome' && <WelcomeContent />}
    </>
  );
}
