import React from 'react';
import { fullName, getInitials, getAvatarColor } from '@/lib/helpers';

/**
 * Recursive org-chart card. Connector lines are pure CSS (flex row of
 * children, each with a border-top + border-left "elbow") — no diagram
 * library needed for a shallow, mostly-static reporting tree.
 */
export default function OrgTreeNode({ node, depth = 0, collapsedIds, onToggleCollapse, onAssignManager, levelLabel }) {
  const isRoot = node.isSynthetic;
  const hasChildren = node.children && node.children.length > 0;
  const collapsed = collapsedIds.has(node.id);
  const [g1, g2] = isRoot ? ['#00AEEF', '#0078A8'] : getAvatarColor(node.id).split(',');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        className="card"
        style={{
          padding: '10px 14px', minWidth: 180, maxWidth: 220, display: 'flex', alignItems: 'center', gap: 10,
          border: isRoot ? '1px solid var(--primary)' : '1px solid var(--border)', position: 'relative',
        }}
      >
        <div
          style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: 600, fontSize: 13, color: '#fff',
            background: `linear-gradient(135deg, ${g1}, ${g2})`,
          }}
        >
          {isRoot ? <i className="fas fa-building" /> : getInitials(node.first_name, node.last_name)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={isRoot ? node.name : fullName(node)}>
            {isRoot ? node.name : fullName(node)}
          </div>
          {!isRoot && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {levelLabel || node.designation || node.role}
            </div>
          )}
        </div>
        {!isRoot && (
          <button
            className="btn-icon"
            title="Reassign manager"
            onClick={() => onAssignManager(node)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
          >
            <i className="fas fa-pen" style={{ fontSize: 12 }} />
          </button>
        )}
        {hasChildren && (
          <button
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => onToggleCollapse(node.id)}
            style={{
              position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)',
              width: 20, height: 20, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--card-bg, #fff)',
              cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}
          >
            <i className={`fas fa-chevron-${collapsed ? 'down' : 'up'}`} />
          </button>
        )}
      </div>

      {hasChildren && !collapsed && (
        <>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div style={{ display: 'flex', gap: 24, position: 'relative', paddingTop: 1 }}>
            {node.children.length > 1 && (
              <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: 1, background: 'var(--border)' }} />
            )}
            {node.children.map((child) => (
              <div key={child.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 1, height: 19, background: 'var(--border)' }} />
                <OrgTreeNode
                  node={child}
                  depth={depth + 1}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={onToggleCollapse}
                  onAssignManager={onAssignManager}
                  levelLabel={child.levelLabel}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
