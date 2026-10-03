import React from 'react';
import CircularProgress from './CircularProgress';

/**
 * Keka-style rings instead of a plain "3/3 remaining" line — self-approval
 * ring is primary since that's what the superadmin's per-tenant auto-approval
 * toggle (Toggle Services page) actually controls. Shared between the Leave
 * and Regularize Attendance pages, which both route through the same
 * self → manager → admin quota tiers (requestQuotaService).
 */
export default function QuotaRings({ quota, autoApprovalEnabled, title = 'Approval Quota', actionLabel = 'request' }) {
  // Nothing to show once the company has turned this off entirely — every
  // request just goes through the normal review chain, so a "self/manager
  // quota" card (including the manager ring) would be misleading noise
  // rather than useful information.
  if (!autoApprovalEnabled) return null;

  const { selfUsed, selfLimit, managerUsed, managerLimit } = quota;
  const selfLeft = Math.max(selfLimit - selfUsed, 0);

  const statusMsg = selfLeft > 0
    ? `${selfLeft} self-approval${selfLeft !== 1 ? 's' : ''} left this month — your next ${actionLabel} auto-approves instantly.`
    : `Self-approvals used up for this month. Requests now route to your manager.`;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header"><h3 style={{ margin: 0 }}>{title}</h3></div>
      <div style={{ padding: 16, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
        <CircularProgress
          used={selfUsed}
          total={selfLimit}
          label="Auto-Approvals"
          sublabel="this month"
        />
        <CircularProgress
          used={managerUsed}
          total={managerLimit}
          size={100}
          strokeWidth={10}
          label="Manager Approvals"
          sublabel="this month"
        />
        <div style={{ flex: 1, minWidth: 200, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className={`fas ${selfLeft > 0 ? 'fa-shield-alt' : 'fa-info-circle'}`} style={{ color: selfLeft > 0 ? 'var(--success)' : 'var(--text-muted)' }} />
          {statusMsg}
        </div>
      </div>
    </div>
  );
}
