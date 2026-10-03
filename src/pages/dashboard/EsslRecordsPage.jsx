import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listEsslCodes, getEsslCodeDays, linkEsslCode } from '@/services/esslService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, fmtDuration } from '@/lib/helpers';

// Every code on the ESSL punch machine (all readers: OFFICE, FACTORY, DELHI,
// and any location the feed adds later), what the machine calls that person,
// and which CrewCore employee the code is mapped to. Everything is shown in
// capitals, the way Raniwala's HR reads it on the machine.

const UP = (v) => (v == null || v === '' ? '—' : String(v).toUpperCase());
const letters = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—');

export default function EsslRecordsPage() {
  const { tenant } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('ALL');
  const [linkFilter, setLinkFilter] = useState('all');

  const [viewing, setViewing] = useState(null);      // row whose punches are open
  const [days, setDays] = useState([]);
  const [daysLoading, setDaysLoading] = useState(false);

  const [linking, setLinking] = useState(null);      // row being linked
  const [employees, setEmployees] = useState([]);
  const [linkTo, setLinkTo] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const [savingLink, setSavingLink] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await listEsslCodes(tenant.id);
    if (error) showToast(error.message || 'Could not load ESSL records', 'error');
    setRows(data);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  // Locations come from the feed itself, so a new reader (e.g. GURUGRAM)
  // appears here as soon as the machine reports it — nothing to configure.
  const locations = useMemo(
    () => [...new Set(rows.map((r) => r.machine?.location).filter(Boolean))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows.filter((r) => {
      if (location !== 'ALL' && r.machine?.location !== location) return false;
      if (linkFilter === 'linked' && !r.profile) return false;
      if (linkFilter === 'unlinked' && (r.profile || r.machine?.left_on)) return false;
      if (linkFilter === 'left' && !r.machine?.left_on) return false;
      if (!q) return true;
      return [r.code, r.machine?.name, r.machine?.department, r.profile && fullName(r.profile), r.profile?.employee_id]
        .some((v) => String(v || '').toUpperCase().includes(q));
    });
  }, [rows, search, location, linkFilter]);

  const counts = useMemo(() => ({
    total: rows.length,
    linked: rows.filter((r) => r.profile).length,
    unlinked: rows.filter((r) => !r.profile && !r.machine?.left_on && r.stats).length,
    left: rows.filter((r) => r.machine?.left_on).length,
  }), [rows]);

  const openPunches = async (row) => {
    setViewing(row);
    setDays([]);
    setDaysLoading(true);
    const { data, error } = await getEsslCodeDays(tenant.id, row.code, row.profile?.id);
    if (error) showToast(error.message || 'Could not load punches', 'error');
    setDays(data);
    setDaysLoading(false);
  };

  const openLink = async (row) => {
    setLinking(row);
    setLinkTo('');
    setLinkSearch(row.machine?.name || '');
    if (!employees.length) {
      const { data } = await listActiveEmployees(tenant.id);
      setEmployees(data);
    }
  };

  const linkCandidates = useMemo(() => {
    const q = linkSearch.trim().toUpperCase();
    return employees
      .filter((e) => !q || [fullName(e), e.employee_id, e.essl_employee_code, e.department].some((v) => String(v || '').toUpperCase().includes(q)))
      .slice(0, 50);
  }, [employees, linkSearch]);

  const saveLink = async () => {
    const target = employees.find((e) => e.id === linkTo);
    if (!target) return;
    if (target.essl_employee_code && target.essl_employee_code !== linking.code
        && !window.confirm(`${UP(fullName(target))} is currently linked to ESSL ${target.essl_employee_code}. Move them to ${linking.code}?`)) {
      return;
    }
    setSavingLink(true);
    const { error } = await linkEsslCode(target.id, linking.code);
    setSavingLink(false);
    if (error) {
      showToast(/duplicate|unique/i.test(error.message) ? `ESSL ${linking.code} is already linked to another employee.` : error.message, 'error');
      return;
    }
    showToast(`ESSL ${linking.code} linked to ${UP(fullName(target))} — punches synced.`, 'success');
    setLinking(null);
    setEmployees([]);
    load();
  };

  const cutoff = tenant?.essl_attendance_from || null;

  return (
    <>
      <Header title="ESSL Records" breadcrumb="Punch-machine feed · refreshed every 2 minutes" />
      <div className="page-content">
        <div className="stats-row" style={{ marginBottom: 20 }}>
          {[
            { label: 'Codes on machine', value: counts.total, icon: 'fa-fingerprint', tone: 'primary' },
            { label: 'Linked to CrewCore', value: counts.linked, icon: 'fa-link', tone: 'success' },
            { label: 'Punching, not linked', value: counts.unlinked, icon: 'fa-user-plus', tone: 'warning' },
            { label: 'Left (per machine)', value: counts.left, icon: 'fa-user-slash', tone: 'danger' },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <div className="stat-icon" style={{ background: `var(--${s.tone}-light)`, color: `var(--${s.tone})` }}>
                <i className={`fas ${s.icon}`} />
              </div>
              <div>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
          {['ALL', ...locations].map((l) => (
            <button key={l} className={`btn btn-sm ${location === l ? 'btn-primary' : 'btn-outline'}`} onClick={() => setLocation(l)}>
              {l}
            </button>
          ))}
          <select className="form-select" style={{ width: 'auto' }} value={linkFilter} onChange={(e) => setLinkFilter(e.target.value)}>
            <option value="all">All codes</option>
            <option value="linked">Linked to CrewCore</option>
            <option value="unlinked">Not linked (active)</option>
            <option value="left">Left</option>
          </select>
          <input
            className="form-input"
            style={{ maxWidth: 260, marginLeft: 'auto' }}
            placeholder="Search code, name, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>EMP / ESSL Code</th>
                  <th>On Punch Machine</th>
                  <th>In CrewCore</th>
                  <th>Days Punched</th>
                  <th>Last Punch Day</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    {rows.length === 0 ? 'No punch-machine data has been received for this company yet.' : 'No codes match these filters.'}
                  </td></tr>
                ) : filtered.map((r) => {
                  const nameDiffers = r.profile && r.machine?.name && letters(r.machine.name) !== letters(fullName(r.profile));
                  return (
                    <tr key={r.code}>
                      <td>
                        <code style={{ fontWeight: 700, fontSize: 13 }}>{UP(r.code)}</code>
                      </td>
                      <td>
                        <div className="emp-name">{UP(r.machine?.name)}</div>
                        <div className="emp-role">
                          {UP(r.machine?.department)} · {UP(r.machine?.location)}
                          {r.machine?.shift && r.machine.shift !== r.machine.location ? ` · ${UP(r.machine.shift)} SHIFT` : ''}
                        </div>
                        {r.machine?.left_on && <span className="badge badge-danger" style={{ marginTop: 2 }}>LEFT {fmtDate(r.machine.left_on)}</span>}
                      </td>
                      <td>
                        {r.profile ? (
                          <>
                            <div className="emp-name">
                              {UP(fullName(r.profile))}
                              {nameDiffers && <i className="fas fa-triangle-exclamation" title="Name differs from the punch machine — check the code is mapped to the right person" style={{ color: 'var(--warning)', marginLeft: 6 }} />}
                            </div>
                            <div className="emp-role">
                              EMP {UP(r.profile.employee_id)} · {UP(r.profile.department)} · {UP(r.profile.designation)}
                            </div>
                            {r.profile.status && r.profile.status !== 'Active' && <span className="badge badge-secondary">{UP(r.profile.status)}</span>}
                          </>
                        ) : (
                          <span className="badge badge-warning">NOT LINKED</span>
                        )}
                      </td>
                      <td>
                        {r.stats ? <><strong>{r.stats.days_this_month}</strong> this month<div className="emp-role">{r.stats.days_punched} in total</div></> : '—'}
                      </td>
                      <td>{fmtDate(r.stats?.last_date)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm btn-outline" onClick={() => openPunches(r)} disabled={!r.stats} title="View punches">
                          <i className="fas fa-list" /> Punches
                        </button>{' '}
                        {r.profile ? (
                          <button className="btn btn-sm btn-outline" onClick={() => navigate(`/employees?edit=${r.profile.id}`)}>
                            <i className="fas fa-pen" /> Edit
                          </button>
                        ) : (
                          <>
                            <button className="btn btn-sm btn-primary" onClick={() => navigate(`/employees?newEssl=${encodeURIComponent(r.code)}`)}>
                              <i className="fas fa-user-plus" /> Create
                            </button>{' '}
                            <button className="btn btn-sm btn-outline" onClick={() => openLink(r)}>
                              <i className="fas fa-link" /> Link
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        show={!!viewing}
        onClose={() => setViewing(null)}
        width={760}
        title={viewing ? `ESSL ${UP(viewing.code)} · ${UP(viewing.profile ? fullName(viewing.profile) : viewing.machine?.name)}` : ''}
      >
        {viewing && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              MACHINE: {UP(viewing.machine?.name)} · {UP(viewing.machine?.department)} · {UP(viewing.machine?.location)}
              {viewing.profile
                ? <> · CREWCORE: EMP {UP(viewing.profile.employee_id)} · {UP(viewing.profile.department)} · {UP(viewing.profile.designation)}</>
                : <> · NOT LINKED — punches are kept here and move into attendance as soon as this code is set on an employee.</>}
            </div>
            <div className="table-wrap" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Date</th><th>First In</th><th>Last Out</th><th>Punches</th>{viewing.profile && <><th>CrewCore Status</th><th>Hours</th></>}</tr>
                </thead>
                <tbody>
                  {daysLoading ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
                  ) : days.map((d) => {
                    const missing = viewing.profile && !d.crewcore && cutoff && d.date >= cutoff;
                    return (
                      <tr key={d.date}>
                        <td>{fmtDate(d.date)}</td>
                        <td>{d.first_in || '—'}</td>
                        <td>{d.last_out || <span style={{ color: 'var(--warning)' }}>NO OUT</span>}</td>
                        <td>{d.punch_count || '—'}</td>
                        {viewing.profile && (
                          <>
                            <td>
                              {d.crewcore ? UP(d.crewcore.status)
                                : missing ? <span className="badge badge-danger">NOT IN CREWCORE</span>
                                : <span style={{ color: 'var(--text-muted)' }}>MACHINE ONLY</span>}
                            </td>
                            <td>{d.crewcore?.total_hours ? fmtDuration(d.crewcore.total_hours) : '—'}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {cutoff && viewing.profile && (
              <div className="form-hint" style={{ marginTop: 8 }}>
                Machine days from {fmtDate(cutoff)} onwards are written to attendance; earlier days are the machine's record only.
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        show={!!linking}
        onClose={() => setLinking(null)}
        title={linking ? `Link ESSL ${UP(linking.code)} · ${UP(linking.machine?.name)}` : ''}
        footer={<>
          <button className="btn btn-outline" onClick={() => setLinking(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveLink} disabled={!linkTo || savingLink}>
            {savingLink ? 'Linking…' : <><i className="fas fa-link" /> Link &amp; sync punches</>}
          </button>
        </>}
      >
        {linking && (
          <>
            <input className="form-input" placeholder="Search employee, EMP code…" value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} style={{ marginBottom: 10 }} />
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {linkCandidates.length === 0 ? (
                <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>No matching active employee. Use Create instead.</div>
              ) : linkCandidates.map((e) => (
                <label key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: linkTo === e.id ? 'var(--primary-light)' : undefined }}>
                  <input type="radio" name="linkTo" checked={linkTo === e.id} onChange={() => setLinkTo(e.id)} />
                  <div>
                    <div className="emp-name">{UP(fullName(e))}</div>
                    <div className="emp-role">
                      EMP {UP(e.employee_id)} · {UP(e.department)} · {UP(e.designation)}
                      {e.essl_employee_code ? ` · ALREADY ESSL ${UP(e.essl_employee_code)}` : ''}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
