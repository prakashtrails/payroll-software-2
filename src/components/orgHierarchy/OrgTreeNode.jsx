import React from 'react';
import { fullName, getInitials, getAvatarColor } from '@/lib/helpers';

/**
 * One org-chart card (Keka-style): avatar, name, designation, code/location
 * and a DIVISION > DEPARTMENT footer. Positioning, connectors and animation
 * live in OrgTree — this only renders the card at a fixed width/height so the
 * layout maths there stays exact.
 *
 * Synthetic nodes (top-management / department / "no manager" group) reuse
 * the same card with an icon avatar instead of initials.
 */
export default function OrgTreeNode({
  node, width, height, collapsed, focused, onToggleCollapse, onAssignManager, onSelect,
}) {
  const isSynthetic = !!node.isSynthetic;
  const directCount = node.children ? node.children.length : 0;
  const avatarColor = isSynthetic
    ? (node.isGroup ? '#94A3B8' : 'var(--primary)')
    : getAvatarColor(node.id).split(',')[0];

  const secondLine = isSynthetic ? node.subtitle : (node.designation || node.role);
  const thirdLine = isSynthetic
    ? null
    : [node.employee_id && `#${node.employee_id}`, node.outlet_location].filter(Boolean).join(' · ');
  const deptLine = !isSynthetic && [node.division, node.department].filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i).join(' > ');

  const classes = ['org-card'];
  if (isSynthetic && !node.isGroup) classes.push('is-top');
  if (node.isGroup) classes.push('is-group');
  if (focused) classes.push('is-focused');

  return (
    <div
      className={classes.join(' ')}
      style={{ width, height }}
      data-org-card
      onClick={() => onSelect(node)}
      title={isSynthetic ? node.name : `${fullName(node)}${node.designation ? ` — ${node.designation}` : ''}`}
    >
      <div className="org-card-avatar" style={{ background: avatarColor }}>
        {isSynthetic ? <i className={`fas ${node.icon || 'fa-building'}`} /> : getInitials(node.first_name, node.last_name)}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="org-card-name">{isSynthetic ? node.name : fullName(node)}</div>
        {secondLine && <div className="org-card-line">{secondLine}</div>}
        {thirdLine && <div className="org-card-line">{thirdLine}</div>}
        {deptLine && <div className="org-card-dept">{deptLine}</div>}
        {node.reportsTo && (
          <div className="org-card-line" style={{ fontSize: 11, marginTop: 2 }}>
            <i className="fas fa-arrow-up" style={{ fontSize: 9, marginRight: 4 }} />
            Reports to {fullName(node.reportsTo)}
          </div>
        )}
      </div>

      {!isSynthetic && (
        <button
          className="org-card-edit"
          title="Reassign manager"
          onClick={(e) => { e.stopPropagation(); onAssignManager(node); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <i className="fas fa-pen" style={{ fontSize: 11 }} />
        </button>
      )}

      {directCount > 0 && (
        <button
          className="org-toggle"
          title={collapsed ? `Show ${directCount} direct report${directCount === 1 ? '' : 's'}` : 'Collapse'}
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {collapsed ? directCount : <i className="fas fa-minus" style={{ fontSize: 9 }} />}
        </button>
      )}
    </div>
  );
}
