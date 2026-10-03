import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listProjects, createProject, updateProject,
  listProjectMembers, addProjectMember, removeProjectMember,
  listProjectTasks, createProjectTask, updateTaskStatus,
} from '@/services/projectService';
import { listActiveEmployees } from '@/services/employeeService';
import { TASK_STATUSES } from '@/services/taskService';
import { fullName, fmt } from '@/lib/helpers';

const STATUS_BADGE = { Active: 'badge-success', 'On Hold': 'badge-warning', Completed: 'badge-info', Cancelled: 'badge-danger' };

export default function ProjectsPage() {
  const { tenant, profile } = useAuth();
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: '', description: '', start_date: '', end_date: '' });

  const [activeProject, setActiveProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [newMemberId, setNewMemberId] = useState('');
  const [taskForm, setTaskForm] = useState({ title: '', assigned_to: '', due_date: '' });

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [projRes, empRes] = await Promise.all([listProjects(tenant.id), listActiveEmployees(tenant.id)]);
      setProjects(projRes.data);
      setEmployees(empRes.data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateProject = async () => {
    if (!projectForm.name.trim()) return showToast('Name is required', 'error');
    const { error } = await createProject(tenant.id, projectForm, profile.id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Project created', 'success');
    setShowProjectModal(false);
    setProjectForm({ name: '', description: '', start_date: '', end_date: '' });
    fetchData();
  };

  const openProject = async (p) => {
    setActiveProject(p);
    const [memRes, taskRes] = await Promise.all([listProjectMembers(p.id), listProjectTasks(p.id)]);
    setMembers(memRes.data);
    setTasks(taskRes.data);
  };

  const handleProjectStatus = async (status) => {
    const { error } = await updateProject(activeProject.id, { status });
    if (error) return showToast('Failed: ' + error.message, 'error');
    setActiveProject({ ...activeProject, status });
    fetchData();
  };

  const handleAddMember = async () => {
    if (!newMemberId) return;
    const { error } = await addProjectMember(tenant.id, activeProject.id, newMemberId);
    if (error) return showToast('Failed: ' + error.message, 'error');
    setNewMemberId('');
    const { data } = await listProjectMembers(activeProject.id);
    setMembers(data);
    fetchData();
  };

  const handleRemoveMember = async (id) => {
    await removeProjectMember(id);
    const { data } = await listProjectMembers(activeProject.id);
    setMembers(data);
    fetchData();
  };

  const handleAddTask = async () => {
    if (!taskForm.title.trim()) return showToast('Task title is required', 'error');
    const { error } = await createProjectTask(tenant.id, activeProject.id, taskForm);
    if (error) return showToast(error.message, 'error');
    setTaskForm({ title: '', assigned_to: '', due_date: '' });
    const { data } = await listProjectTasks(activeProject.id);
    setTasks(data);
    fetchData();
  };

  const handleTaskStatus = async (id, status) => {
    const { error } = await updateTaskStatus(id, status);
    if (error) showToast(error.message, 'error');
    const { data } = await listProjectTasks(activeProject.id);
    setTasks(data);
    fetchData();
  };

  return (
    <>
      <Header title="Projects" breadcrumb="Project tracking and task assignment"
        actions={<button className="btn btn-primary" onClick={() => setShowProjectModal(true)}><i className="fas fa-plus" style={{ marginRight: 6 }} />New Project</button>}
      />
      <div className="page-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Project</th><th>Status</th><th>Start</th><th>End</th><th>Members</th><th>Tasks</th><th>Actions</th></tr></thead>
                <tbody>
                  {projects.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No projects yet.</td></tr>
                  ) : projects.map((p) => {
                    const done = p.tasks?.filter((t) => t.status === 'Done').length || 0;
                    const total = p.tasks?.length || 0;
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</td>
                        <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{p.status}</span></td>
                        <td style={{ fontSize: 12 }}>{fmt.date(p.start_date)}</td>
                        <td style={{ fontSize: 12 }}>{fmt.date(p.end_date)}</td>
                        <td style={{ fontSize: 12 }}>{p.members?.length || 0}</td>
                        <td style={{ fontSize: 12 }}>{done}/{total}</td>
                        <td><button className="btn btn-outline btn-sm" onClick={() => openProject(p)}>Manage</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showProjectModal} onClose={() => setShowProjectModal(false)} title="New Project" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowProjectModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreateProject}>Create</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input className="form-input" value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={3} value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input className="form-input" type="date" value={projectForm.start_date} onChange={(e) => setProjectForm({ ...projectForm, start_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">End Date</label>
            <input className="form-input" type="date" value={projectForm.end_date} onChange={(e) => setProjectForm({ ...projectForm, end_date: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal show={!!activeProject} onClose={() => setActiveProject(null)} title={activeProject ? activeProject.name : ''} width="640px"
        footer={<button className="btn btn-outline" onClick={() => setActiveProject(null)}>Close</button>}
      >
        {activeProject && (
          <>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={activeProject.status} onChange={(e) => handleProjectStatus(e.target.value)}>
                <option>Active</option>
                <option>On Hold</option>
                <option>Completed</option>
                <option>Cancelled</option>
              </select>
            </div>

            <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>Members</h4>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <select className="form-select" value={newMemberId} onChange={(e) => setNewMemberId(e.target.value)}>
                <option value="">Add a member…</option>
                {employees.filter((e) => !members.some((m) => m.profile_id === e.id)).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
              </select>
              <button className="btn btn-outline btn-sm" onClick={handleAddMember}>Add</button>
            </div>
            {members.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No members yet.</p>
            ) : members.map((m) => (
              <div key={m.id} className="settings-list-row">
                <span style={{ fontSize: 13 }}>{fullName(m.profile)}</span>
                <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleRemoveMember(m.id)}><i className="fas fa-trash" /></button>
              </div>
            ))}

            <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>Tasks</h4>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <input className="form-input" placeholder="Task title" style={{ flex: 1, minWidth: 140 }} value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} />
              <select className="form-select" style={{ maxWidth: 160 }} value={taskForm.assigned_to} onChange={(e) => setTaskForm({ ...taskForm, assigned_to: e.target.value })}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.profile_id} value={m.profile_id}>{fullName(m.profile)}</option>)}
              </select>
              <input className="form-input" type="date" style={{ maxWidth: 160 }} value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} />
              <button className="btn btn-primary btn-sm" onClick={handleAddTask}>Add</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {tasks.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>No tasks yet.</td></tr>
                  ) : tasks.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontSize: 13 }}>{t.title}</td>
                      <td style={{ fontSize: 12 }}>{t.assignee ? fullName(t.assignee) : '—'}</td>
                      <td style={{ fontSize: 12 }}>{fmt.date(t.due_date)}</td>
                      <td>
                        <select className="form-select" style={{ fontSize: 12, padding: '4px 8px' }} value={t.status} onChange={(e) => handleTaskStatus(t.id, e.target.value)}>
                          {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
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
