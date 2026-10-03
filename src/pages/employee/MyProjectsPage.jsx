import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMyTasks, updateTaskStatus } from '@/services/projectService';
import { TASK_STATUSES } from '@/services/taskService';
import { fmt } from '@/lib/helpers';

export function MyProjectsContent() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const handleStatus = async (id, status) => {
    const { error } = await updateTaskStatus(id, status);
    if (error) return showToast('Failed: ' + error.message, 'error');
    fetchData();
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
                        <select className="form-select" style={{ fontSize: 12, padding: '4px 8px' }} value={t.status} onChange={(e) => handleStatus(t.id, e.target.value)}>
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
