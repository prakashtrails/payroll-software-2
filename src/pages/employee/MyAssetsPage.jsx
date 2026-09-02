import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { listMyAssignments } from '@/services/assetService';
import { fmt } from '@/lib/helpers';

export function MyAssetsContent() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const { data } = await listMyAssignments(profile.id);
      setAssignments(data);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const current = assignments.filter((a) => !a.returned_at);
  const past = assignments.filter((a) => a.returned_at);

  return (
    <div className="page-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="grid-2">
            <div className="card">
              <div className="card-header"><h3>Currently With You</h3></div>
              <div className="card-body">
                {current.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No assets currently assigned to you.</p>
                ) : current.map((a) => (
                  <div key={a.id} className="settings-list-row">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{a.asset?.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.asset?.category} · Since {fmt.date(a.assigned_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Past Assignments</h3></div>
              <div className="card-body">
                {past.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No returned assets yet.</p>
                ) : past.map((a) => (
                  <div key={a.id} className="settings-list-row">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{a.asset?.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt.date(a.assigned_at)} – {fmt.date(a.returned_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
  );
}

export default function MyAssetsPage() {
  return (
    <>
      <Header title="My Assets" breadcrumb="Company equipment assigned to you" />
      <MyAssetsContent />
    </>
  );
}
