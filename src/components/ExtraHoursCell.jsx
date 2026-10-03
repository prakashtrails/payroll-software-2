import React from 'react';
import { fmtDuration, raniwalaExtraHours, raniwalaPayableOtHours } from '@/lib/helpers';

// Raniwala: raw time past the 8h 30m day, plus what it earns — OT hours
// (slabbed, only for OT-ticked employees) and/or comp off credited by the
// DB for working a weekly off / holiday (attendance.comp_off_credit).
export default function ExtraHoursCell({ totalHours, overtime, compOffCredit }) {
  const extra = raniwalaExtraHours(totalHours);
  const ot = overtime ? raniwalaPayableOtHours(totalHours) : 0;
  if (!extra && !compOffCredit) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {extra > 0 && <span>+{fmtDuration(extra)}</span>}
      {overtime && extra > 0 && (
        <span
          className={`badge ${ot ? 'badge-success' : 'badge-secondary'}`}
          title={ot ? `Paid as ${ot}h overtime` : 'Under 2h extra — no overtime'}
        >
          OT {ot}h
        </span>
      )}
      {compOffCredit > 0 && (
        <span className="badge badge-purple" title="Comp off earned for working a weekly off / holiday">
          Comp Off +{compOffCredit}
        </span>
      )}
    </span>
  );
}
