import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMyTasks } from '@/services/projectService';
import { TASK_STATUSES, updateTask } from '@/services/taskService';
import { fmt, todayStr } from '@/lib/helpers';
import StatusChangeModal from '@/components/tasks/StatusChangeModal';
import { statusNeeds, needsInput } from '@/components/tasks/taskUi';

export function MyProjectsContent() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusReq, setStatusReq] = useState(null);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const { data } = await listMyTasks(profile.id);
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const applyStatus = async (t, patch) => {
    const { error } = await updateTask(t.id, patch);
    if (error) showToast('Failed: ' + error.message, 'error');
    else setStatusReq(null);
    fetchData();
  };

  // The task register rules (due date to start, reasons, proof for review) are asked for up front.
  const handleStatus = (t, status) => {
    if (status === t.status) return;
    const needs = statusNeeds(t, status, profile, todayStr());
    if (needsInput(needs)) setStatusReq({ task: t, status, needs });
    else applyStatus(t, { status, status_note: null });
  };

  return (
    <div className="page-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Task</th><th>Project</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {tasks.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No tasks assigned to you.</td></tr>
                  ) : tasks.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                        {t.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.description}</div>}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.project?.name}</td>
                      <td style={{ fontSize: 12 }}>{fmt.date(t.due_date)}</td>
                      <td>
                        <select className="form-select" style={{ fontSize: 12, padding: '4px 8px' }} value={t.status} onChange={(e) => handleStatus(t, e.target.value)}>
                          {TASK_STATUSES.filter((s) => s !== 'Cancelled' || t.status === 'Cancelled').map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <StatusChangeModal request={statusReq} onClose={() => { setStatusReq(null); fetchData(); }} onConfirm={applyStatus} />
      </div>
  );
}

export default function MyProjectsPage() {
  return (
    <>
      <Header title="My Projects" breadcrumb="Tasks assigned to you across all projects" />
      <MyProjectsContent />
    </>
  );
}
