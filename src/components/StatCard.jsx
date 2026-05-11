import React from 'react';

export default function StatCard({ icon, iconColor, value, label }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconColor || 'blue'}`}>
        <i className={`fas ${icon}`} />
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
