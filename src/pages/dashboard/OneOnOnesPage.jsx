import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listMyMeetings, scheduleMeeting, updateMeetingStatus, addMeetingSummary,
} from '@/services/oneOnOneService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, todayStr, fmtTime12 } from '@/lib/helpers';

const EMPTY_FORM = {
  participant_id: '', title: '1:1 Meeting', meeting_date: todayStr(),
  start_time: '', end_time: '', location: '', agenda_content: '',
};

// The Location field doubles as a meeting link (Google Meet / Zoom URL) — render
// it as a clickable link when it looks like one instead of inert text.
const isUrl = (str) => /^https?:\/\//i.test(str.trim());

function LocationLink({ location }) {
  if (!isUrl(location)) return location;
  return (
    <a
      href={location} target="_blank" rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ color: 'var(--primary)' }}
    >
      <i className="fas fa-video" style={{ marginRight: 4 }} />Join Meeting
    </a>
  );
}

function MeetingCard({ meeting, myId, onOpenDetail }) {
  const other = meeting.organizer_id === myId ? meeting.participant : meeting.organizer;
  const role = meeting.organizer_id === myId ? 'Organizer' : 'Participant';
  return (
    <div className="card" style={{ padding: 20, cursor: 'pointer' }} onClick={() => onOpenDetail(meeting)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>{meeting.title}</h3>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            With {other ? fullName(other) : '—'} · {meeting.meeting_date}
            {meeting.start_time ? ` · ${fmtTime12(meeting.start_time)}` : ''}
            {meeting.location ? <> · <LocationLink location={meeting.location} /></> : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-secondary">{role}</span>
          <span className={`badge ${meeting.status === 'Completed' ? 'badge-success' : meeting.status === 'Cancelled' ? 'badge-danger' : 'badge-info'}`}>
            {meeting.status}
          </span>
        </div>
      </div>
    </div>
  );
}

export function OneOnOnesContent() {
  const { tenant, profile } = useAuth();

  const [tab, setTab] = useState('Upcoming');
  const [meetings, setMeetings] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState(null);
  const [summaryDraft, setSummaryDraft] = useState('');

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    setLoading(true);
    try {
      const [{ data: mData }, { data: eData }] = await Promise.all([
        listMyMeetings(tenant.id, profile.id),
        listActiveEmployees(tenant.id),
      ]);
      setMeetings(mData || []);
      setEmployees((eData || []).filter((e) => e.id !== profile.id));
    } finally {
      setLoading(false);
    }
  }, [tenant, profile]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = () => {
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const save = async () => {
    if (!form.participant_id) return showToast('Select who this meeting is with', 'error');
    if (!form.meeting_date) return showToast('Select a meeting date', 'error');
    setSaving(true);
    try {
      const { error } = await scheduleMeeting({
        tenantId: tenant.id,
        organizerId: profile.id,
        participantId: form.participant_id,
        title: form.title.trim() || '1:1 Meeting',
        agendaContent: form.agenda_content.trim(),
        meetingDate: form.meeting_date,
        startTime: form.start_time || null,
        endTime: form.end_time || null,
        location: form.location.trim(),
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('1:1 meeting scheduled', 'success');
      setShowModal(false);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const openDetail = (meeting) => {
    setDetail(meeting);
    setSummaryDraft(meeting.summary || '');
  };

  const cancelMeeting = async (id) => {
    if (!confirm('Cancel this meeting?')) return;
    const { error } = await updateMeetingStatus(id, 'Cancelled');
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Meeting cancelled', 'info');
    setDetail(null);
    fetchData();
  };

  const completeMeeting = async () => {
    const { error } = await addMeetingSummary(detail.id, summaryDraft.trim());
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Meeting marked completed', 'success');
    setDetail(null);
    fetchData();
  };

  const filtered = meetings.filter((m) =>
    tab === 'Upcoming' ? m.status === 'Scheduled' : m.status !== 'Scheduled'
  );

  return (
    <>
      <div className="page-content">
        <div className="tabs" style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {['Upcoming', 'Past'].map((t) => (
            <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline'}`} style={{ borderRadius: '6px 6px 0 0' }} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        <div className="filter-bar">
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={openModal}>
              <i className="fas fa-plus" /> Schedule 1:1
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No {tab.toLowerCase()} 1:1 meetings
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filtered.map((m) => <MeetingCard key={m.id} meeting={m} myId={profile.id} onOpenDetail={openDetail} />)}
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="Schedule 1:1 Meeting" width="520px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <i className="fas fa-check" /> {saving ? 'Scheduling…' : 'Schedule'}
          </button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">With *</label>
          <select className="form-select" value={form.participant_id} onChange={(e) => setForm({ ...form, participant_id: e.target.value })}>
            <option value="">Select</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Title</label>
          <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input className="form-input" type="date" value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Location</label>
            <input className="form-input" placeholder="e.g. Meeting Room / Google Meet" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Time</label>
            <input className="form-input" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">End Time</label>
            <input className="form-input" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Agenda</label>
          <textarea className="form-input" rows={3} placeholder="What do you want to discuss?" value={form.agenda_content} onChange={(e) => setForm({ ...form, agenda_content: e.target.value })} />
        </div>
      </Modal>

      <Modal show={!!detail} onClose={() => setDetail(null)} title={detail ? detail.title : ''} width="560px">
        {detail && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              {detail.meeting_date}{detail.start_time ? ` · ${fmtTime12(detail.start_time)}` : ''}
              {detail.location ? <> · <LocationLink location={detail.location} /></> : ''}
            </div>
            {detail.agenda_content && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 6px' }}>Agenda</h4>
                <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{detail.agenda_content}</p>
              </div>
            )}

            {detail.status === 'Completed' ? (
              <div>
                <h4 style={{ margin: '0 0 6px' }}>Summary</h4>
                <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{detail.summary || '—'}</p>
              </div>
            ) : detail.status === 'Cancelled' ? (
              <p style={{ color: 'var(--text-muted)' }}>This meeting was cancelled.</p>
            ) : (
              <>
                <h4 style={{ margin: '0 0 6px' }}>Mark Completed</h4>
                <textarea className="form-input" rows={3} placeholder="Meeting summary / notes…" value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" onClick={completeMeeting}>
                    <i className="fas fa-check" /> Mark Completed
                  </button>
                  <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => cancelMeeting(detail.id)}>
                    <i className="fas fa-times" /> Cancel Meeting
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

export default function OneOnOnesPage() {
  return (
    <>
      <Header title="1:1 Meetings" breadcrumb="Schedule and track one-on-ones" />
      <OneOnOnesContent />
    </>
  );
}
