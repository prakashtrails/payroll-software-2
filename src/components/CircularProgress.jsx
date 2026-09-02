import React from 'react';

/**
 * Keka-style circular "remaining" ring — a big number in the center instead
 * of a plain "x/y remaining" line of text. The colored arc represents what's
 * left (shrinks toward the danger color as `remaining` approaches 0), not
 * what's used, so a full bright ring reads as "plenty left" at a glance.
 */
export default function CircularProgress({
  used = 0, total = 0, size = 132, strokeWidth = 12, label = '', sublabel = '',
  unlimited = false, emptyText = 'disabled',
}) {
  const remaining = Math.max(total - used, 0);
  const ratio = total > 0 ? remaining / total : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = unlimited ? circumference : circumference * ratio;
  const dashOffset = circumference - arcLength;
  const cx = size / 2;
  const cy = size / 2;

  const color = unlimited
    ? 'var(--primary)'
    : total === 0
    ? 'var(--text-muted)'
    : ratio > 0.5 ? 'var(--success)'
    : ratio > 0 ? 'var(--warning-dark, #92400e)'
    : 'var(--danger)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
        {(unlimited || total > 0) && (
          <circle
            cx={cx} cy={cy} r={radius} fill="none"
            stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        )}
        <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: unlimited ? size * 0.34 : size * 0.3, fontWeight: 700, fill: 'var(--text-primary)' }}
        >
          {unlimited ? '∞' : total === 0 ? '—' : remaining}
        </text>
        <text x="50%" y="66%" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: size * 0.1, fill: 'var(--text-muted)' }}
        >
          {unlimited ? 'unlimited' : total === 0 ? emptyText : `of ${total}`}
        </text>
      </svg>
      {label && <div style={{ fontSize: 13, fontWeight: 600, textAlign: 'center' }}>{label}</div>}
      {sublabel && <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{sublabel}</div>}
    </div>
  );
}
