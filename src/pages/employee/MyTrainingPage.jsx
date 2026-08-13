import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { fetchMySkillMap, listTrainingEvents, listMyEnrollments, enrollInEvent, submitTrainingFeedback } from '@/services/trainingService';
import { fmt } from '@/lib/helpers';

export default function MyTrainingPage() {
  const { profile, tenant } = useAuth();
  const [skills, setSkills]       = useState([]);
  const [events, setEvents]       = useState([]);
  const [myEnrollments, setMyEnrollments] = useState([]);
  const [loading, setLoading]     = useState(true);

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);
    try {
      const [skillsRes, eventsRes, enrollRes] = await Promise.all([
        fetchMySkillMap(profile.id), listTrainingEvents(tenant.id), listMyEnrollments(profile.id),
      ]);
      setSkills(skillsRes.data);
      setEvents(eventsRes.data.filter((ev) => new Date(ev.event_date) >= new Date(new Date().toDateString())));
      setMyEnrollments(enrollRes.data);
    } finally {
      setLoading(false);
    }
  }, [profile, tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isEnrolled = (eventId) => myEnrollments.some((e) => e.event_id === eventId);

  const handleEnroll = async (eventId) => {
    const { error } = await enrollInEvent(tenant.id, eventId, profile.id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Enrolled', 'success');
    fetchData();
  };

  const handleFeedback = async (enrollmentId) => {
    const rating = parseInt(prompt('Rate this training 1-5:') || '');
    if (!rating) return;
    const notes = prompt('Any comments? (optional)') || '';
    const { error } = await submitTrainingFeedback(enrollmentId, rating, notes);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Feedback saved', 'success');
    fetchData();
  };

  return (
    <>
      <Header title="My Training" breadcrumb="Skill map and available training events" />
      <div className="page-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="grid-2">
            <div className="card">
              <div className="card-header"><h3>My Skill Map</h3></div>
              <div className="card-body">
                {skills.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No skills assessed yet.</p>
                ) : skills.map((s) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                    <span>{s.skill?.name}</span>
                    <span>{'★'.repeat(s.level)}{'☆'.repeat(5 - s.level)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Upcoming Events</h3></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Program</th><th>Date</th><th>Action</th></tr></thead>
                  <tbody>
                    {events.length === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>No upcoming events</td></tr>
                    ) : events.map((ev) => (
                      <tr key={ev.id}>
                        <td>{ev.program?.title}</td>
                        <td>{fmt.date(ev.event_date)}</td>
                        <td>
                          {isEnrolled(ev.id)
                            ? <span className="badge badge-success">Enrolled</span>
                            : <button className="btn btn-outline btn-sm" onClick={() => handleEnroll(ev.id)}>Enroll</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {myEnrollments.length > 0 && (
              <div className="card" style={{ gridColumn: '1 / -1' }}>
                <div className="card-header"><h3>My Trainings</h3></div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Program</th><th>Date</th><th>Status</th><th>Feedback</th></tr></thead>
                    <tbody>
                      {myEnrollments.map((e) => (
                        <tr key={e.id}>
                          <td>{e.event?.program?.title}</td>
                          <td>{fmt.date(e.event?.event_date)}</td>
                          <td><span className="badge badge-info">{e.status}</span></td>
                          <td>
                            {e.feedback_rating
                              ? '★'.repeat(e.feedback_rating)
                              : <button className="btn btn-outline btn-sm" onClick={() => handleFeedback(e.id)}>Give Feedback</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
