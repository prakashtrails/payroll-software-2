import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { fullName } from '@/lib/helpers';

import { AttendanceContent } from './MyAttendancePage';
import { RegularizeContent } from './MyRegularizeRequestsPage';
import { WfhContent } from './MyWfhRequestsPage';
import { LeaveContent } from './MyLeavesPage';
import { KRAsContent } from '@/pages/dashboard/KRAsPage';
import { OneOnOnesContent } from '@/pages/dashboard/OneOnOnesPage';
import { FeedbackContent } from '@/pages/dashboard/FeedbackPage';
import { PIPContent } from '@/pages/dashboard/PIPPage';
import { ReviewsContent } from '@/pages/dashboard/ReviewsPage';

const ATTENDANCE_SUBTABS = [
  { key: 'log', label: 'Log' },
  { key: 'regularize', label: 'Regularize' },
  { key: 'wfh', label: 'Work From Home' },
];

const PERFORMANCE_SUBTABS = [
  { key: 'kras', label: 'KRAs' },
  { key: 'oneonones', label: '1:1 Meetings' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'pip', label: 'PIP' },
  { key: 'reviews', label: 'Reviews' },
];

function SubTabs({ items, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
      {items.map((it) => (
        <button
          key={it.key}
          className={`btn btn-sm ${active === it.key ? 'btn-primary' : 'btn-outline'}`}
          style={{ borderRadius: '6px 6px 0 0' }}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

const VALID_TABS = ['attendance', 'leave', 'performance'];

export default function MePage() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = VALID_TABS.includes(requestedTab) ? requestedTab : 'attendance';
  const setTab = (t) => setSearchParams(t === 'attendance' ? {} : { tab: t });

  const requestedSub = searchParams.get('sub');
  const attSubtab = ATTENDANCE_SUBTABS.some((s) => s.key === requestedSub) ? requestedSub : 'log';
  const setAttSubtab = (s) => setSearchParams(s === 'log' ? {} : { tab: 'attendance', sub: s });

  const [perfSubtab, setPerfSubtab] = useState('kras');

  const roleLabel = profile?.role === 'admin' ? 'HR' : profile?.role === 'manager' ? 'Manager' : 'Employee';

  return (
    <>
      <Header title="Me" breadcrumb={`${fullName(profile) || 'My Space'} · ${roleLabel}`} />

      {/* Top-level tabs — each tab's content below supplies its own page padding
          (matching its standalone route), so this wrapper only pads the tab bar
          itself rather than using .page-content, which would double up. */}
      <div className="tab-bar-wrap">
        <div className="tabs">
          {['attendance', 'leave', 'performance'].map((t) => (
            <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'attendance' ? 'Attendance' : t === 'leave' ? 'Leave' : 'Performance'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'attendance' && (
        <>
          <div className="subtab-bar-wrap">
            <SubTabs items={ATTENDANCE_SUBTABS} active={attSubtab} onChange={setAttSubtab} />
          </div>
          {attSubtab === 'log' && <AttendanceContent />}
          {attSubtab === 'regularize' && <RegularizeContent />}
          {attSubtab === 'wfh' && <WfhContent />}
        </>
      )}

      {tab === 'leave' && <LeaveContent />}

      {tab === 'performance' && (
        <>
          <div className="subtab-bar-wrap">
            <SubTabs items={PERFORMANCE_SUBTABS} active={perfSubtab} onChange={setPerfSubtab} />
          </div>
          {perfSubtab === 'kras' && <KRAsContent />}
          {perfSubtab === 'oneonones' && <OneOnOnesContent />}
          {perfSubtab === 'feedback' && <FeedbackContent />}
          {perfSubtab === 'pip' && <PIPContent />}
          {perfSubtab === 'reviews' && <ReviewsContent />}
        </>
      )}
    </>
  );
}
