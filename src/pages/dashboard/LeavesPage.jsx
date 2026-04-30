import React, { useEffect, useState } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listAllLeaveRequests, updateLeaveStatus } from '@/services/leaveService';
import { fmt, todayStr } from '@/lib/helpers';

export default function LeavesPage() {
  const { tenant, profile } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Pending'); // Pending, Approved, Rejected, All

  useEffect(() => {
    fetchRequests();
  }, [tenant]);

  const fetchRequests = async () => {
    if (!tenant) return;
    setLoading(true);
    const { data, error } = await listAllLeaveRequests(tenant.id);
    if (error) showToast(error.message, 'error');
    else setRequests(data);
    setLoading(false);
  };

  const handleStatusChange = async (id, status) => {
    const { error } = await updateLeaveStatus(id, status, profile.id);
    if (error) showToast(error.message, 'error');
    else {
      showToast(`Leave ${status.toLowerCase()} successfully`, 'success');
      fetchRequests();
    }
  };

  const filteredRequests = requests.filter(r => filter === 'All' || r.status === filter);

  return (
    <div className="page-container">
      <Header 
        title="Leave Management" 
        breadcrumb="Dashboard / Leaves"
      />

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Requests</h3>
          <div className="flex gap-2">
            {['Pending', 'Approved', 'Rejected', 'All'].map(s => (
              <button 
                key={s} 
                className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave Type</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></td></tr>
              ) : filteredRequests.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No leave requests found.</td></tr>
              ) : filteredRequests.map(req => {
                const start = new Date(req.start_date);
                const end = new Date(req.end_date);
                const diffTime = Math.abs(end - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                
                return (
                  <tr key={req.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{req.profile?.first_name} {req.profile?.last_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{req.profile?.department}</div>
                    </td>
                    <td><span className="badge badge-info">{req.leave_type}</span></td>
                    <td>{fmt.date(req.start_date)}</td>
                    <td>{fmt.date(req.end_date)}</td>
                    <td>{diffDays}</td>
                    <td style={{ maxWidth: 200, fontSize: 12 }} title={req.reason}>{req.reason}</td>
                    <td>
                      <span className={`badge ${
                        req.status === 'Approved' ? 'badge-success' : 
                        req.status === 'Rejected' ? 'badge-danger' : 'badge-warning'
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td>
                      {req.status === 'Pending' && (
                        <div className="flex gap-1">
                          <button 
                            className="btn btn-sm btn-success" 
                            title="Approve"
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
                      {req.status !== 'Pending' && req.approver && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          By: {req.approver.first_name}
                        </div>
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
  );
}
