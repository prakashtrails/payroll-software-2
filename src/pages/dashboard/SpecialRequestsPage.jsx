import React, { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listAllSpecialRequests, updateSpecialRequestStatus } from '@/services/specialRequestService';
import { fmt } from '@/lib/helpers';

const TYPE_BADGE = {
  Overtime: 'badge-info',
  'Late Arrival': 'badge-warning',
  'Comp Off': 'badge-success',
};

export default function SpecialRequestsPage() {
  const { tenant, profile } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [typeFilter, setTypeFilter] = useState('All');

  const fetchRequests = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const { data, error } = await listAllSpecialRequests(tenant.id);
    if (error) showToast(error.message, 'error');
    else setRequests(data);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleStatusChange = async (id, status) => {
    const { error } = await updateSpecialRequestStatus(id, status, profile.id);
    if (error) showToast(error.message, 'error');
    else {
      showToast(`Request ${status.toLowerCase()} successfully`, 'success');
      fetchRequests();
    }
  };

  const filtered = requests.filter(r => {
    const matchStatus = statusFilter === 'All' || r.status === statusFilter;
    const matchType = typeFilter === 'All' || r.request_type === typeFilter;
    return matchStatus && matchType;
  });

  const pending = requests.filter(r => r.status === 'Pending').length;

  return (
    <div className="page-container">
      <Header
        title="Special Requests"
        breadcrumb="Dashboard / Special Requests"
      />

      {pending > 0 && (
        <div style={{
          background: 'var(--warning-light, #fffbeb)',
          border: '1px solid var(--warning)',
          borderRadius: 8,
          padding: '10px 16px',
          marginTop: 16,
          fontSize: 13,
          color: 'var(--warning-dark, #92400e)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <i className="fas fa-clock" />
          {pending} pending request{pending !== 1 ? 's' : ''} awaiting your approval.
          {' '}Approving Overtime credits 1 comp-off day. Approving Late Arrival = full-day pay. Approving Comp Off deducts 1 comp-off day.
        </div>
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>
            Requests
            {filtered.length > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>({filtered.length})</span>}
          </h3>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            <div className="flex gap-1">
              {['Pending', 'Approved', 'Rejected', 'All'].map(s => (
                <button
                  key={s}
                  className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-1" style={{ borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
              {['All', 'Overtime', 'Late Arrival', 'Comp Off'].map(t => (
                <button
                  key={t}
                  className={`btn btn-sm ${typeFilter === t ? 'btn-secondary' : 'btn-outline'}`}
                  onClick={() => setTypeFilter(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Date</th>
                <th>Details</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No requests found.</td></tr>
              ) : filtered.map(req => (
                <tr key={req.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      {req.profile?.first_name} {req.profile?.last_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{req.profile?.department}</div>
                    {req.profile?.comp_off_balance > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--success)', marginTop: 2 }}>
                        <i className="fas fa-umbrella-beach" style={{ marginRight: 3 }} />
                        {req.profile.comp_off_balance} comp off
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${TYPE_BADGE[req.request_type] || 'badge-info'}`}>
                      {req.request_type}
                    </span>
                  </td>
                  <td>{fmt.date(req.request_date)}</td>
                  <td style={{ fontSize: 12 }}>
                    {req.request_type === 'Late Arrival'
                      ? <span><i className="fas fa-clock" style={{ marginRight: 4 }} />{req.late_hours}</span>
                      : req.request_type === 'Overtime'
                        ? <span><i className="fas fa-business-time" style={{ marginRight: 4 }} />{req.overtime_hours}h overtime</span>
                        : <span><i className="fas fa-umbrella-beach" style={{ marginRight: 4 }} />Comp off day</span>}
                  </td>
                  <td style={{ maxWidth: 200, fontSize: 12 }} title={req.reason}>{req.reason}</td>
                  <td>
                    <span className={`badge ${
                      req.status === 'Approved' ? 'badge-success'
                      : req.status === 'Rejected' ? 'badge-danger'
                      : 'badge-warning'
                    }`}>
                      {req.status}
                    </span>
                    {req.status !== 'Pending' && req.approver && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        By: {req.approver.first_name}
                      </div>
                    )}
                  </td>
                  <td>
                    {req.status === 'Pending' && (
                      <div className="flex gap-1">
                        <button
                          className="btn btn-sm btn-success"
                          title={
                            req.request_type === 'Overtime'
                              ? 'Approve — credits 1 comp-off day'
                              : req.request_type === 'Comp Off'
                                ? 'Approve — deducts 1 comp-off day'
                                : 'Approve — full day, no deduction'
                          }
                          onClick={() => handleStatusChange(req.id, 'Approved')}
                        >
                          <i className="fas fa-check" />
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          title="Reject"
                          onClick={() => handleStatusChange(req.id, 'Rejected')}
                        >
                          <i className="fas fa-times" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
