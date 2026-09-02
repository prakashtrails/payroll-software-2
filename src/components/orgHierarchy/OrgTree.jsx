import React, { useMemo, useState } from 'react';
import OrgTreeNode from './OrgTreeNode';

/**
 * Assembles a flat profiles list (with manager_id) into a tree client-side —
 * one query already happened upstream (getOrgTree), no per-node queries here.
 * Employees with no manager become children of a single synthetic root card
 * so single-vs-multiple-roots needs no special-cased layout.
 */
function buildTree(employees, tenantName) {
  const byId = new Map(employees.map((e) => [e.id, { ...e, children: [] }]));
  const roots = [];

  byId.forEach((node) => {
    if (node.manager_id && byId.has(node.manager_id)) {
      byId.get(node.manager_id).children.push(node);
    } else {
      roots.push(node);
    }
  });

  return { id: 'root', isSynthetic: true, name: tenantName || 'Organization', children: roots };
}

export default function OrgTree({ employees, tenantName, onAssignManager }) {
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());

  const tree = useMemo(() => buildTree(employees || [], tenantName), [employees, tenantName]);

  const toggleCollapse = (id) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (!employees || employees.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><i className="fas fa-sitemap" /></div>
        <h3>No employees to show</h3>
        <p>Once employees are added, their reporting structure appears here.</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', padding: '24px 12px', display: 'flex', justifyContent: 'center' }}>
      <OrgTreeNode
        node={tree}
        collapsedIds={collapsedIds}
        onToggleCollapse={toggleCollapse}
        onAssignManager={onAssignManager}
      />
    </div>
  );
}
