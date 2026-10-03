import { useEffect, useState, useCallback, useMemo } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import {
  listFeatures, listCompanyFeatureToggles, resolveFeatureState, setFeatureToggle, clearFeatureOverride,
} from '@/services/featureService';

// Curated, outlet-scoped subset a manager (this outlet's HR) can toggle for
// their own outlet only — must match outlet_hr_toggleable_feature_keys() in
// 20260918_8_outlet_manager_feature_toggle_rls.sql, which is what actually
// enforces this list (and the caller's own outlet_id) server-side. This
// array only controls what shows up in the UI; the RLS policy is the real
// gate, so there's no risk in this list drifting loose.
const OUTLET_HR_FEATURE_KEYS = [
  'performance_kras', 'performance_one_on_ones', 'performance_feedback',
  'performance_pip', 'performance_reviews',
  'hiring', 'recruitment_pipeline', 'headcount_requests', 'interviews',
  'offer_letters', 'refer',
  'grievances',
];

export default function HrFeatureSettingsPage() {
  const { tenant, profile } = useAuth();
  const { outlets } = useOutletView();
  // HR (admin) picks which outlet to configure, or '' for company-wide; an
  // outlet manager (other tenants) is locked to their own outlet.
  const isHr = profile?.role === 'admin';
  const [hrOutletId, setHrOutletId] = useState('');
  const outletId = isHr ? (hrOutletId || null) : (profile?.outlet_id || null);
  const [features, setFeatures] = useState([]);
  const [toggles, setToggles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(async () => {
    if (!tenant?.id) { setLoading(false); return; }
    setLoading(true);
    const [{ data: featureData }, { data: toggleData }] = await Promise.all([
      listFeatures(),
      listCompanyFeatureToggles(tenant.id),
    ]);
    setFeatures((featureData || []).filter((f) => OUTLET_HR_FEATURE_KEYS.includes(f.key)));
    setToggles(toggleData || []);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const byCategory = new Map();
    for (const f of features) {
      if (!byCategory.has(f.category)) byCategory.set(f.category, []);
      byCategory.get(f.category).push(f);
    }
    return Array.from(byCategory.entries());
  }, [features]);

  const handleToggle = async (f) => {
    const effective = resolveFeatureState(toggles, f.key, outletId, !f.is_premium);
    setSavingKey(f.key);
    const { error } = await setFeatureToggle(tenant.id, outletId, f.key, !effective, profile?.id);
    setSavingKey(null);
    if (error) return showToast('Failed to update: ' + error.message, 'error');
    load();
  };

  const handleReset = async (f) => {
    setSavingKey(f.key);
    const { error } = await clearFeatureOverride(tenant.id, outletId, f.key);
    setSavingKey(null);
    if (error) return showToast('Failed to reset: ' + error.message, 'error');
    load();
  };

  return (
    <>
      <Header title="HR Settings" breadcrumb={isHr ? "Turn employee-portal features on or off, company-wide or per outlet" : "Turn features on or off for your outlet's employee portal"} />
      <div className="page-content">
        {isHr && (
          <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label className="form-label" style={{ margin: 0 }}>Apply to</label>
            <select className="form-select" style={{ maxWidth: 280 }} value={hrOutletId} onChange={(e) => setHrOutletId(e.target.value)}>
              <option value="">All outlets (company-wide)</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>An outlet setting overrides the company-wide one for that outlet.</span>
          </div>
        )}
        {!outletId && !isHr ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            You're not assigned to an outlet, so there's nothing to configure here yet.
          </div>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          grouped.map(([category, items]) => (
            <div className="card" key={category} style={{ marginBottom: 16 }}>
              <div className="card-header"><h3>{category}</h3></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Feature</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {items.map((f) => {
                      const explicitRow = toggles.find((t) => t.feature_key === f.key && t.outlet_id === outletId);
                      const effective = resolveFeatureState(toggles, f.key, outletId, !f.is_premium);
                      return (
                        <tr key={f.key}>
                          <td>
                            <strong>{f.name}</strong>
                            {f.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.description}</div>}
                          </td>
                          <td>
                            <span className={`badge ${effective ? 'badge-success' : 'badge-danger'}`}>{effective ? 'Enabled' : 'Disabled'}</span>
                            {!explicitRow && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>(inherited)</span>}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <button
                                className="btn btn-outline btn-icon btn-sm"
                                disabled={savingKey === f.key}
                                onClick={() => handleToggle(f)}
                                title={effective ? 'Disable' : 'Enable'}
                              >
                                <i className={`fas ${effective ? 'fa-toggle-on' : 'fa-toggle-off'}`} style={{ color: effective ? 'var(--success)' : 'var(--text-muted)' }} />
                              </button>
                              {explicitRow && (
                                <button className="btn btn-outline btn-sm" disabled={savingKey === f.key} onClick={() => handleReset(f)} title="Reset to default (inherit)">
                                  Reset
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
