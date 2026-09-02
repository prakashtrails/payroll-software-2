import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listChecklistItems, createChecklistItem, deleteChecklistItem,
  listProcesses, startProcess, updateProcess, updateTaskStatus,
  assignBuddy, requestKra, markKraReceived, seedRecruitmentChecklist,
} from '@/services/onboardingService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, fmt } from '@/lib/helpers';

const STATUS_BADGE = { 'In Progress': 'badge-info', Completed: 'badge-success', Cancelled: 'badge-danger' };
const TASK_STATUS_BADGE = { Pending: 'badge-warning', 'In Progress': 'badge-info', Done: 'badge-success' };

export default function OnboardingPage() {
  const { tenant, profile } = useAuth();
  const [tab, setTab] = useState('processes');
  const [items, setItems] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newItem, setNewItem] = useState({ title: '', description: '', category: 'General' });

  const [showStartModal, setShowStartModal] = useState(false);
  const [startForm, setStartForm] = useState({ profile_id: '', target_date: '', notes: '' });

  const [activeProcess, setActiveProcess] = useState(null);
  const [kraTargetId, setKraTargetId] = useState('');

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [itemsRes, procRes, empRes] = await Promise.all([
        listChecklistItems(tenant.id), listProcesses(tenant.id), listActiveEmployees(tenant.id),
      ]);
      setItems(itemsRes.data);
      setProcesses(procRes.data);
      setEmployees(empRes.data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (activeProcess) {
      const fresh = processes.find((p) => p.id === activeProcess.id);
      if (fresh) setActiveProcess(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processes]);

  const handleAddItem = async () => {
    if (!newItem.title.trim()) return showToast('Title is required', 'error');
    const { error } = await createChecklistItem(tenant.id, newItem);
    if (error) return showToast('Failed: ' + error.message, 'error');
    setNewItem({ title: '', description: '', category: 'General' });
    fetchData();
  };

  const handleStart = async () => {
    if (!startForm.profile_id) return showToast('Select an employee', 'error');
    const { error } = await startProcess(tenant.id, startForm.profile_id, startForm, profile.id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Onboarding started', 'success');
    setShowStartModal(false);
    setStartForm({ profile_id: '', target_date: '', notes: '' });
    fetchData();
  };

  const handleProcessStatus = async (id, status) => {
    const { error } = await updateProcess(id, { status });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Status updated', 'success');
    fetchData();
  };

  const handleTaskStatus = async (id, status) => {
    const { error } = await updateTaskStatus(id, status);
    if (error) return showToast('Failed: ' + error.message, 'error');
    fetchData();
  };

  const handleAssignBuddy = async (processId, buddyId) => {
    if (!buddyId) return;
    const { error } = await assignBuddy(processId, buddyId);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Buddy assigned', 'success');
    fetchData();
  };

  const handleRequestKra = async (processId) => {
    if (!kraTargetId) return showToast('Select who to request KRAs from', 'error');
    const { error } = await requestKra(processId, tenant.id, kraTargetId, profile.id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('KRA request sent', 'success');
    setKraTargetId('');
    fetchData();
  };

  const handleMarkKraReceived = async (processId) => {
    const { error } = await markKraReceived(processId);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('KRA marked received', 'success');
    fetchData();
  };

  const handleSeedChecklist = async () => {
    const { error } = await seedRecruitmentChecklist(tenant.id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Default checklist items added', 'success');
    fetchData();
  };

  return (
    <>
      <Header title="Onboarding" breadcrumb="New-hire checklists and tracking"
        actions={<button className="btn btn-primary" onClick={() => setShowStartModal(true)}><i className="fas fa-plus" style={{ marginRight: 6 }} />Start Onboarding</button>}
      />
      <div className="page-content">
        <div className="filter-bar">
          <button className={`btn btn-sm ${tab === 'processes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('processes')}>Onboarding</button>
          <button className={`btn btn-sm ${tab === 'checklist' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('checklist')}>Checklist Library</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : tab === 'checklist' ? (
          <div className="card">
            <div className="card-header">
              <h3>Checklist Items</h3>
              <button className="btn btn-outline btn-sm" onClick={handleSeedChecklist}>Add recruitment SOP defaults</button>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input className="form-input" placeholder="Task title" style={{ flex: '1 1 160px' }} value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} />
                <input className="form-input" placeholder="Category" style={{ flex: '1 1 120px', maxWidth: 160 }} value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} />
                <button className="btn btn-primary btn-sm" onClick={handleAddItem}>Add</button>
              </div>
              {items.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No checklist items yet — add the tasks every new hire should complete.</p>
              ) : items.map((item) => (
                <div key={item.id} className="settings-list-row">
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {item.category}</span></div>
                    {item.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.description}</div>}
                  </div>
                  <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => { await deleteChecklistItem(item.id); fetchData(); }}><i className="fas fa-trash" /></button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Status</th><th>Started</th><th>Target Date</th><th>Tasks</th><th>Actions</th></tr></thead>
                <tbody>
                  {processes.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No onboarding processes started yet.</td></tr>
                  ) : processes.map((p) => {
                    const done = p.tasks?.filter((t) => t.status === 'Done').length || 0;
                    const total = p.tasks?.length || 0;
                    return (
                      <tr key={p.id}>
                        <td>{fullName(p.profile)}</td>
                        <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{p.status}</span></td>
                        <td>{fmt.date(p.start_date)}</td>
                        <td>{fmt.date(p.target_date)}</td>
                        <td>{done}/{total}</td>
                        <td><button className="btn btn-outline btn-sm" onClick={() => setActiveProcess(p)}>Manage</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showStartModal} onClose={() => setShowStartModal(false)} title="Start Onboarding" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowStartModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleStart}>Start</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Employee *</label>
          <select className="form-select" value={startForm.profile_id} onChange={(e) => setStartForm({ ...startForm, profile_id: e.target.value })}>
            <option value="">Select employee</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Target Completion Date</label>
          <input className="form-input" type="date" value={startForm.target_date} onChange={(e) => setStartForm({ ...startForm, target_date: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-input" rows={3} value={startForm.notes} onChange={(e) => setStartForm({ ...startForm, notes: e.target.value })} />
        </div>
      </Modal>

      <Modal show={!!activeProcess} onClose={() => setActiveProcess(null)} title={activeProcess ? `Onboarding — ${fullName(activeProcess.profile)}` : ''} width="560px"
        footer={<button className="btn btn-outline" onClick={() => setActiveProcess(null)}>Close</button>}
      >
        {activeProcess && (
          <>
            {activeProcess.referral_id && <span className="badge badge-info" style={{ marginBottom: 12, display: 'inline-block' }}>From Recruitment</span>}
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={activeProcess.status} onChange={(e) => handleProcessStatus(activeProcess.id, e.target.value)}>
                <option>In Progress</option>
                <option>Completed</option>
                <option>Cancelled</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Buddy (first 15 days)</label>
                <select className="form-select" value={activeProcess.buddy_id || ''} onChange={(e) => handleAssignBuddy(activeProcess.id, e.target.value)}>
                  <option value="">Select buddy…</option>
                  {employees.filter((e) => e.id !== activeProcess.profile_id).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
                </select>
                {activeProcess.buddy_ends_on && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Supports through {fmt.date(activeProcess.buddy_ends_on)}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">KRA Handover</label>
                {activeProcess.kra_received_at ? (
                  <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 8 }}><i className="fas fa-check-circle" /> Received</div>
                ) : activeProcess.kra_requested_at ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Requested {fmt.date(activeProcess.kra_requested_at)}</span>
                    <button className="btn btn-outline btn-sm" onClick={() => handleMarkKraReceived(activeProcess.id)}>Mark Received</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select className="form-select" style={{ fontSize: 12 }} value={kraTargetId} onChange={(e) => setKraTargetId(e.target.value)}>
                      <option value="">Request from…</option>
                      {employees.filter((e) => e.id !== activeProcess.profile_id).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
                    </select>
                    <button className="btn btn-outline btn-sm" onClick={() => handleRequestKra(activeProcess.id)}>Request</button>
                  </div>
                )}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead><tr><th>Task</th><th>Category</th><th>Status</th></tr></thead>
                <tbody>
                  {(activeProcess.tasks || []).length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>No tasks on this process.</td></tr>
                  ) : activeProcess.tasks.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontSize: 13 }}>{t.title}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.category}</td>
                      <td>
                        <select className="form-select" style={{ fontSize: 12, padding: '4px 8px' }} value={t.status} onChange={(e) => handleTaskStatus(t.id, e.target.value)}>
                          <option>Pending</option>
                          <option>In Progress</option>
                          <option>Done</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
