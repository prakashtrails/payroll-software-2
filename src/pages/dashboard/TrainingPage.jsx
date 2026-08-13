import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listSkills, createSkill, deleteSkill, fetchMySkillMap, upsertEmployeeSkill,
  listTrainingPrograms, createTrainingProgram, deleteTrainingProgram,
  listTrainingEvents, createTrainingEvent,
} from '@/services/trainingService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, fmt } from '@/lib/helpers';

export default function TrainingPage() {
  const { tenant, profile } = useAuth();
  const [tab, setTab] = useState('skills');
  const [skills, setSkills]     = useState([]);
  const [employees, setEmployees] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [events, setEvents]     = useState([]);
  const [loading, setLoading]   = useState(true);

  const [newSkillName, setNewSkillName] = useState('');
  const [assessEmp, setAssessEmp] = useState(null);
  const [assessMap, setAssessMap] = useState({});

  const [showProgramModal, setShowProgramModal] = useState(false);
  const [programForm, setProgramForm] = useState({ title: '', description: '' });
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventForm, setEventForm] = useState({ program_id: '', event_date: '', trainer: '', location: '', capacity: '' });

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [skillsRes, empRes, progRes, evRes] = await Promise.all([
        listSkills(tenant.id), listActiveEmployees(tenant.id), listTrainingPrograms(tenant.id), listTrainingEvents(tenant.id),
      ]);
      setSkills(skillsRes.data);
      setEmployees(empRes.data);
      setPrograms(progRes.data);
      setEvents(evRes.data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddSkill = async () => {
    if (!newSkillName.trim()) return;
    const { error } = await createSkill(tenant.id, newSkillName);
    if (error) return showToast('Failed: ' + error.message, 'error');
    setNewSkillName('');
    fetchData();
  };

  const openAssess = async (emp) => {
    setAssessEmp(emp);
    const { data } = await fetchMySkillMap(emp.id);
    const map = {};
    data.forEach((s) => { map[s.skill_id] = s.level; });
    setAssessMap(map);
  };

  const saveAssessment = async () => {
    for (const skillId of Object.keys(assessMap)) {
      await upsertEmployeeSkill(tenant.id, assessEmp.id, skillId, assessMap[skillId], profile.id);
    }
    showToast('Skill map saved', 'success');
    setAssessEmp(null);
  };

  const handleCreateProgram = async () => {
    if (!programForm.title.trim()) return showToast('Title is required', 'error');
    const { error } = await createTrainingProgram(tenant.id, programForm);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Program created', 'success');
    setShowProgramModal(false);
    setProgramForm({ title: '', description: '' });
    fetchData();
  };

  const handleCreateEvent = async () => {
    if (!eventForm.program_id || !eventForm.event_date) return showToast('Select a program and date', 'error');
    const { error } = await createTrainingEvent(tenant.id, eventForm);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Event scheduled', 'success');
    setShowEventModal(false);
    setEventForm({ program_id: '', event_date: '', trainer: '', location: '', capacity: '' });
    fetchData();
  };

  return (
    <>
      <Header title="Training & Skills" breadcrumb="Skill maps and training programs" />
      <div className="page-content">
        <div className="filter-bar">
          <button className={`btn btn-sm ${tab === 'skills' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('skills')}>Skills</button>
          <button className={`btn btn-sm ${tab === 'training' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('training')}>Training</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : tab === 'skills' ? (
          <div className="grid-2">
            <div className="card">
              <div className="card-header"><h3>Skills</h3></div>
              <div className="card-body">
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input className="form-input" placeholder="New skill name" value={newSkillName} onChange={(e) => setNewSkillName(e.target.value)} />
                  <button className="btn btn-primary btn-sm" onClick={handleAddSkill}>Add</button>
                </div>
                {skills.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No skills defined yet.</p>
                ) : skills.map((s) => (
                  <div key={s.id} className="settings-list-row">
                    <span style={{ fontSize: 13 }}>{s.name}</span>
                    <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => { await deleteSkill(s.id); fetchData(); }}><i className="fas fa-trash" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Employee Skill Maps</h3></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Designation</th><th>Actions</th></tr></thead>
                  <tbody>
                    {employees.map((e) => (
                      <tr key={e.id}>
                        <td>{fullName(e)}</td>
                        <td>{e.designation || '—'}</td>
                        <td><button className="btn btn-outline btn-sm" onClick={() => openAssess(e)}>Assess</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <h3>Programs</h3>
                <button className="btn btn-primary btn-sm" onClick={() => setShowProgramModal(true)}><i className="fas fa-plus" /> Add</button>
              </div>
              <div className="card-body">
                {programs.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No training programs yet.</p>
                ) : programs.map((p) => (
                  <div key={p.id} className="settings-list-row">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.description}</div>
                    </div>
                    <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => { await deleteTrainingProgram(p.id); fetchData(); }}><i className="fas fa-trash" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Events</h3>
                <button className="btn btn-primary btn-sm" onClick={() => setShowEventModal(true)}><i className="fas fa-plus" /> Schedule</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Program</th><th>Date</th><th>Trainer</th><th>Enrolled</th></tr></thead>
                  <tbody>
                    {events.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>No events scheduled</td></tr>
                    ) : events.map((ev) => (
                      <tr key={ev.id}>
                        <td>{ev.program?.title}</td>
                        <td>{fmt.date(ev.event_date)}</td>
                        <td>{ev.trainer || '—'}</td>
                        <td>{ev.enrollments?.length || 0}{ev.capacity ? `/${ev.capacity}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal show={!!assessEmp} onClose={() => setAssessEmp(null)} title={`Skill Assessment — ${assessEmp ? fullName(assessEmp) : ''}`} width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setAssessEmp(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAssessment}>Save</button>
        </>}
      >
        {skills.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>Add skills first.</div>
        ) : skills.map((s) => (
          <div className="form-group" key={s.id}>
            <label className="form-label">{s.name} (1–5)</label>
            <input className="form-input" type="number" min="1" max="5" value={assessMap[s.id] || ''}
              onChange={(e) => setAssessMap({ ...assessMap, [s.id]: parseInt(e.target.value) || 0 })} />
          </div>
        ))}
      </Modal>

      <Modal show={showProgramModal} onClose={() => setShowProgramModal(false)} title="New Training Program" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowProgramModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreateProgram}>Save</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Title *</label>
          <input className="form-input" value={programForm.title} onChange={(e) => setProgramForm({ ...programForm, title: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={3} value={programForm.description} onChange={(e) => setProgramForm({ ...programForm, description: e.target.value })} />
        </div>
      </Modal>

      <Modal show={showEventModal} onClose={() => setShowEventModal(false)} title="Schedule Training Event" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowEventModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreateEvent}>Schedule</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Program *</label>
          <select className="form-select" value={eventForm.program_id} onChange={(e) => setEventForm({ ...eventForm, program_id: e.target.value })}>
            <option value="">Select Program</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input className="form-input" type="date" value={eventForm.event_date} onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Capacity</label>
            <input className="form-input" type="number" value={eventForm.capacity} onChange={(e) => setEventForm({ ...eventForm, capacity: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Trainer</label>
          <input className="form-input" value={eventForm.trainer} onChange={(e) => setEventForm({ ...eventForm, trainer: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Location</label>
          <input className="form-input" value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
