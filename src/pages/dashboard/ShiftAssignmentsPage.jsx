import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import { fetchShiftAssignments, bulkAssignShift } from '@/services/shiftAssignmentService';
import { listShifts } from '@/services/tenantService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, monthLabel, todayStr, scopedToOutlet } from '@/lib/helpers';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function blankBulkForm() {
  const t = todayStr();
  return { profileIds: [], shiftId: '', startDate: t, endDate: t, weekdays: [1, 2, 3, 4, 5] };
}

export default function ShiftAssignmentsPage() {
  const { tenant, profile } = useAuth();
  const { outletProfileIds } = useOutletView();
  const [month, setMonth]   = useState(new Date().getMonth());
  const [year, setYear]     = useState(new Date().getFullYear());
  const [shifts, setShifts]   = useState([]);
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankBulkForm());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const end   = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
      const [shiftsRes, empsRes, assignRes] = await Promise.all([
        listShifts(tenant.id),
        listActiveEmployees(tenant.id),
        fetchShiftAssignments(tenant.id, start, end),
      ]);
      setShifts(shiftsRes.data || []);
      setEmployees(scopedToOutlet(empsRes.data, outletProfileIds, 'id'));
      setAssignments(assignRes.data || []);
    } finally {
      setLoading(false);
    }
  }, [tenant, month, year, outletProfileIds]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const shiftAbbr = (name) => (name || '').split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const cellFor = (profileId, day) => {
    const dateISO = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return assignments.find((a) => a.profile_id === profileId && a.date === dateISO);
  };

  const toggleWeekday = (d) => setForm((p) => ({ ...p, weekdays: p.weekdays.includes(d) ? p.weekdays.filter((x) => x !== d) : [...p.weekdays, d] }));
  const toggleProfile = (id) => setForm((p) => ({ ...p, profileIds: p.profileIds.includes(id) ? p.profileIds.filter((x) => x !== id) : [...p.profileIds, id] }));

  const handleBulkAssign = async () => {
    if (!form.shiftId) return showToast('Select a shift', 'error');
    if (!form.profileIds.length) return showToast('Select at least one employee', 'error');
    const { error, count } = await bulkAssignShift(tenant.id, profile.id, form);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast(`Assigned ${count} shift-day${count !== 1 ? 's' : ''}`, 'success');
    setShowModal(false);
    setForm(blankBulkForm());
    fetchData();
  };

  return (
    <>
      <Header title="Shift Roster" breadcrumb="Bulk-assign shifts across a date range and weekday pattern" />
      <div className="page-content">
        <div className="filter-bar">
          <div className="month-selector">
            <button onClick={() => { let m = month - 1, y = year; if (m < 0) { m = 11; y--; } setMonth(m); setYear(y); }}><i className="fas fa-chevron-left" /></button>
            <span>{monthLabel(month, year)}</span>
            <button onClick={() => { let m = month + 1, y = year; if (m > 11) { m = 0; y++; } setMonth(m); setYear(y); }}><i className="fas fa-chevron-right" /></button>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <i className="fas fa-calendar-plus" /> Bulk Assign
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>Employee</th>
                    {days.map((d) => <th key={d} style={{ textAlign: 'center', minWidth: 30 }}>{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id}>
                      <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', whiteSpace: 'nowrap' }}>{fullName(e)}</td>
                      {days.map((d) => {
                        const a = cellFor(e.id, d);
                        return <td key={d} style={{ textAlign: 'center', color: a ? 'var(--primary)' : 'var(--text-muted)' }} title={a?.shift?.name}>{a ? shiftAbbr(a.shift?.name) : '—'}</td>;
                      })}
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr><td colSpan={days.length + 1} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No employees found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="Bulk Assign Shift" width="560px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleBulkAssign}>Assign</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Shift *</label>
          <select className="form-select" value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}>
            <option value="">Select Shift</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From</label>
            <input className="form-input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">To</label>
            <input className="form-input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Repeat on</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WEEKDAYS.map((w, i) => (
              <button key={w} type="button" className={`btn btn-sm ${form.weekdays.includes(i) ? 'btn-primary' : 'btn-outline'}`} onClick={() => toggleWeekday(i)}>{w}</button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Employees * ({form.profileIds.length} selected)</label>
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            {employees.map((e) => (
              <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 2px' }}>
                <input type="checkbox" checked={form.profileIds.includes(e.id)} onChange={() => toggleProfile(e.id)} />
                {fullName(e)}
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
