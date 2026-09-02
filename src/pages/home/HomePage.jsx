import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
import { getHolidayTheme } from '@/lib/holidayThemes';
import { useTodayDate } from '@/hooks/useTodayDate';

function HolidaysCard({ tenant }) {
  const today = useTodayDate();
  const [allHolidays, setAllHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    listHolidays(tenant.id).then(({ data }) => {
      if (cancelled) return;
      setAllHolidays(data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenant]);

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
