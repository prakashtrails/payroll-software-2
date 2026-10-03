import React from 'react';
import { regularizeExtensionNotice } from '@/lib/helpers';

/** Banner shown on the regularize screens only while the tenant's extended window is open. */
export default function RegularizeExtensionNotice({ tenant, style }) {
  const text = regularizeExtensionNotice(tenant);
  if (!text) return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex', gap: 10, alignItems: 'flex-start',
        padding: '12px 14px', borderRadius: 10, marginBottom: 16,
        border: '1px solid var(--warning)', borderLeft: '4px solid var(--warning)',
        fontSize: 13, lineHeight: 1.5, color: 'var(--text)',
        ...style,
      }}
    >
      <i className="fas fa-triangle-exclamation" style={{ color: 'var(--warning)', marginTop: 2 }} />
      <span>{text}</span>
    </div>
  );
}
