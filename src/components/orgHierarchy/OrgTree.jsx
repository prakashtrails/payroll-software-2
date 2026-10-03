import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import OrgTreeNode from './OrgTreeNode';
import { fullName, getInitials, getAvatarColor } from '@/lib/helpers';

const UNLINKED_ID = 'unlinked';

/**
 * Assembles a flat profiles list (with manager_id) into a tree client-side —
 * one query already happened upstream (getOrgTree), no per-node queries here.
 * Employees with no manager become children of a single synthetic root card
 * so single-vs-multiple-roots needs no special-cased layout.
 *
 * With a department picked, only that department's people are kept: each one
 * hangs under their nearest in-department boss up the manager chain, and the
 * department's top people sit under a department card (with a note of who
 * they report to outside it).
 *
 * topManagement (Raniwala): per HR's HOD sheet the chart is headed by
 * Abhiyant Sir → Abhishek Sir → the heads with no manager_id. Until the two
 * have Management accounts, both are display-only cards. Top-level accounts that have no
 * employee code and nobody under them (logins not on HR's sheet) are parked
 * in a separate group instead of sitting beside the department heads.
 */
function buildTree(employees, { tenantName, topManagement, department }) {
  const all = new Map(employees.map((e) => [e.id, e]));
  const members = department ? employees.filter((e) => e.department === department) : employees;
  const byId = new Map(members.map((e) => [e.id, { ...e, children: [] }]));
  const roots = [];

  byId.forEach((node) => {
    let parentId = node.manager_id;
    const seen = new Set();
    while (parentId && !byId.has(parentId) && all.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      parentId = all.get(parentId).manager_id;
    }
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).children.push(node);
    } else {
      roots.push(node);
    }
    const directManager = all.get(node.manager_id);
    if (department && directManager && !byId.has(directManager.id)) {
      node.reportsTo = directManager;
    }
  });

  if (department) {
    return {
      id: `dept:${department}`, isSynthetic: true, icon: 'fa-layer-group', name: department,
      subtitle: `${members.length} ${members.length === 1 ? 'person' : 'people'}`, children: roots,
    };
  }

  if (!topManagement) {
    return { id: 'root', isSynthetic: true, name: tenantName || 'Organization', children: roots };
  }

  const linked = roots.filter((n) => n.employee_id || n.children.length > 0 || n.role === 'management');
  const unlinked = roots.filter((n) => !n.employee_id && n.children.length === 0 && n.role !== 'management');
  const unlinkedGroup = {
    id: UNLINKED_ID, isSynthetic: true, isGroup: true, icon: 'fa-user-slash', name: 'No manager / no emp code',
    subtitle: `${unlinked.length} account${unlinked.length === 1 ? '' : 's'} not on the HR sheet`, children: unlinked,
  };

  // Once the owners have real Management accounts (20260926_13 links the
  // heads to them), they head the chart themselves — no stand-in cards.
  if (linked.some((n) => n.role === 'management')) {
    return {
      id: 'root', isSynthetic: true, name: tenantName || 'Organization',
      children: unlinked.length > 0 ? [...linked, unlinkedGroup] : linked,
    };
  }

  const abhishek = {
    id: 'top:abhishek', isSynthetic: true, icon: 'fa-user-tie', name: 'ABHISHEK SIR',
    subtitle: `${linked.length} direct report${linked.length === 1 ? '' : 's'}`, children: linked,
  };
  const children = unlinked.length > 0 ? [abhishek, unlinkedGroup] : [abhishek];
  return {
    id: 'root', isSynthetic: true, icon: 'fa-user-tie', name: 'ABHIYANT SIR', subtitle: 'Top management',
    children, headCount: linked.length,
  };
}

const CARD_W = 260;
const CARD_H = 104;
const CARD_H_DEPT = 122; // department view adds a "Reports to" line
const H_GAP = 28;
const V_GAP = 64;
const GROUP_PAD = 14;
const GROUP_TOP = 40;
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 1.6;
const ANIM_MS = 450;

// Soft tinted boxes for "Group by department": [background, border, label].
const GROUP_COLORS = [
  ['#FEF8F8', '#F3C4C4', '#B94A48'],
  ['#F4F9FE', '#B9D8F2', '#2B6CB0'],
  ['#F5FBF3', '#BFE0B3', '#3D7A2B'],
  ['#FAF6FE', '#D9C6F2', '#6B46C1'],
  ['#FFFAF0', '#F2D9A6', '#9C6B12'],
  ['#F2FBFA', '#A8DDD8', '#1D7F78'],
];
const groupColor = (dept) => {
  const hash = [...(dept || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return GROUP_COLORS[hash % GROUP_COLORS.length];
};

/** Parent lookup + flat list of real people, for search / "Me" / reveal. */
function indexTree(tree) {
  const parents = new Map();
  const people = [];
  const walk = (n) => {
    if (!n.isSynthetic) people.push(n);
    (n.children || []).forEach((c) => { parents.set(c.id, n.id); walk(c); });
  };
  walk(tree);
  return { parents, people };
}

/**
 * Keka opens on the top of the org: the header chain stays open and every
 * person with reports starts collapsed (their count shows on the toggle).
 * A single department is small enough to open fully.
 */
function defaultCollapsed(tree, department) {
  const ids = new Set();
  if (department) return ids;
  const walk = (n) => {
    if (n.children && n.children.length > 0) {
      if (!n.isSynthetic || n.isGroup) ids.add(n.id);
      n.children.forEach(walk);
    }
  };
  walk(tree);
  return ids;
}

function collectExpandableIds(node, acc = new Set()) {
  if (node.children && node.children.length > 0) {
    acc.add(node.id);
    node.children.forEach((c) => collectExpandableIds(c, acc));
  }
  return acc;
}

/** Sorted, deduped list of department names present in the org (blank ones excluded). */
function collectDepartments(employees) {
  return Array.from(new Set((employees || []).map((e) => e.department).filter(Boolean))).sort();
}

/**
 * Tidy top-down layout: every subtree is as wide as its widest row, a parent
 * is centred over its children, and connectors are elbow segments (parent
 * stem → horizontal bus → child stems). With groupByDept, siblings are sorted
 * by department and each run of same-department siblings gets a tinted box.
 * Returns plain rectangles so the renderer can key + transition each one.
 */
function computeLayout(tree, collapsedIds, groupByDept, cardH) {
  const nodes = [];
  const lines = [];
  const groups = [];
  const pad = groupByDept ? GROUP_PAD : 0;

  const kidsOf = (n) => {
    if (!n.children || n.children.length === 0 || collapsedIds.has(n.id)) return [];
    if (!groupByDept) return n.children;
    return [...n.children].sort((a, b) => (a.department || '').localeCompare(b.department || ''));
  };
  const runsOf = (kids) => {
    if (!groupByDept) return [kids];
    const runs = [];
    kids.forEach((k) => {
      const last = runs[runs.length - 1];
      if (last && (last[0].department || '') === (k.department || '')) last.push(k);
      else runs.push([k]);
    });
    return runs;
  };

  const sizes = new Map();
  const measure = (n) => {
    const kids = kidsOf(n);
    if (kids.length === 0) {
      sizes.set(n.id, { w: CARD_W, runs: [], childrenW: 0 });
      return CARD_W;
    }
    const runs = runsOf(kids).map((run) => ({
      run,
      w: run.reduce((s, k) => s + measure(k), 0) + H_GAP * (run.length - 1) + 2 * pad,
    }));
    const childrenW = runs.reduce((s, r) => s + r.w, 0) + H_GAP * (runs.length - 1);
    const w = Math.max(CARD_W, childrenW);
    sizes.set(n.id, { w, runs, childrenW });
    return w;
  };

  const place = (n, left, top) => {
    const { w, runs, childrenW } = sizes.get(n.id);
    const cx = Math.round(left + w / 2);
    nodes.push({ node: n, x: cx - CARD_W / 2, y: top });
    let bottom = top + cardH;
    if (runs.length === 0) return bottom;

    const busY = top + cardH + V_GAP / 2;
    const childTop = top + cardH + V_GAP + (groupByDept ? GROUP_TOP : 0);
    const kidCenters = [];
    let cursor = left + (w - childrenW) / 2;

    runs.forEach(({ run, w: runW }) => {
      let inner = cursor + pad;
      let runBottom = childTop + cardH;
      run.forEach((k) => {
        const kw = sizes.get(k.id).w;
        kidCenters.push({ id: k.id, cx: Math.round(inner + kw / 2) });
        runBottom = Math.max(runBottom, place(k, inner, childTop));
        inner += kw + H_GAP;
      });
      if (groupByDept) {
        const boxY = childTop - GROUP_TOP + 8;
        groups.push({
          id: `g:${n.id}:${run[0].department || '-'}`,
          label: run[0].department || 'No department',
          count: run.length,
          x: cursor, y: boxY, w: runW, h: runBottom + pad - boxY,
        });
      }
      bottom = Math.max(bottom, runBottom + pad);
      cursor += runW + H_GAP;
    });

    lines.push({ id: `v:${n.id}`, x: cx, y: top + cardH, w: 1, h: busY - (top + cardH) });
    const minX = Math.min(...kidCenters.map((k) => k.cx));
    const maxX = Math.max(...kidCenters.map((k) => k.cx));
    if (maxX > minX) lines.push({ id: `h:${n.id}`, x: minX, y: busY, w: maxX - minX + 1, h: 1 });
    kidCenters.forEach((k) => lines.push({ id: `k:${k.id}`, x: k.cx, y: busY, w: 1, h: childTop - busY }));
    return bottom;
  };

  const totalW = measure(tree);
  const totalH = place(tree, 0, 0);
  return { nodes, lines, groups, width: totalW, height: totalH, byId: new Map(nodes.map((p) => [p.node.id, p])) };
}

const clampZoom = (k) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

export default function OrgTree({
  employees, tenantName, topManagement = false, meId, myDepartment, onAssignManager,
}) {
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [groupByDept, setGroupByDept] = useState(false);
  const [goTo, setGoTo] = useState('top');
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [animating, setAnimating] = useState(false);
  const [panning, setPanning] = useState(false);
  const [focusedId, setFocusedId] = useState(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const viewportRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const animTimer = useRef(null);
  const focusTimer = useRef(null);
  const pendingRef = useRef(null);
  const lastTreeRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const revealAfterTreeRef = useRef(null);

  const tree = useMemo(
    () => buildTree(employees || [], { tenantName, topManagement, department: departmentFilter }),
    [employees, tenantName, topManagement, departmentFilter]
  );
  const { parents, people } = useMemo(() => indexTree(tree), [tree]);
  const departments = useMemo(() => collectDepartments(employees), [employees]);
  const defaults = useMemo(() => defaultCollapsed(tree, departmentFilter), [tree, departmentFilter]);

  // Collapse state belongs to one tree; a new tree (department switch or a
  // reload) starts from that tree's defaults instead of stale ids.
  const [collapseState, setCollapseState] = useState({ tree: null, ids: new Set() });
  const collapsedIds = collapseState.tree === tree ? collapseState.ids : defaults;
  const setCollapsed = useCallback(
    (updater) => setCollapseState((prev) => {
      const current = prev.tree === tree ? prev.ids : defaults;
      return { tree, ids: typeof updater === 'function' ? updater(current) : updater };
    }),
    [tree, defaults]
  );

  const cardH = departmentFilter ? CARD_H_DEPT : CARD_H;
  const layout = useMemo(
    () => computeLayout(tree, collapsedIds, groupByDept, cardH),
    [tree, collapsedIds, groupByDept, cardH]
  );

  // ── view helpers ───────────────────────────────────────────────────────
  const applyView = useCallback((next, animate) => {
    clearTimeout(animTimer.current);
    setAnimating(!!animate);
    setView(next);
    if (animate) animTimer.current = setTimeout(() => setAnimating(false), ANIM_MS + 40);
  }, []);

  const viewportSize = () => {
    const el = viewportRef.current;
    return el ? { vw: el.clientWidth, vh: el.clientHeight } : { vw: 1000, vh: 600 };
  };

  /** Top of the org: root centred at the top, zoomed out only as far as stays readable. */
  const showTop = useCallback((lay, animate) => {
    const { vw, vh } = viewportSize();
    const root = lay.byId.get(tree.id);
    const fitK = Math.min(1, (vw - 80) / lay.width, (vh - 80) / lay.height);
    const k = clampZoom(Math.max(fitK, 0.6));
    const rootCx = root ? root.x + CARD_W / 2 : lay.width / 2;
    applyView({ x: vw / 2 - rootCx * k, y: 40, k }, animate);
  }, [tree, applyView]);

  const fitAll = useCallback(() => {
    const { vw, vh } = viewportSize();
    const k = clampZoom(Math.min(1, (vw - 80) / layout.width, (vh - 80) / layout.height));
    applyView({ x: (vw - layout.width * k) / 2, y: Math.max(30, (vh - layout.height * k) / 2), k }, true);
  }, [layout, applyView]);

  const centerOn = useCallback((lay, id, animate = true) => {
    const pos = lay.byId.get(id);
    if (!pos) return;
    const { vw, vh } = viewportSize();
    const k = viewRef.current.k < 0.6 ? 0.85 : viewRef.current.k;
    applyView({ x: vw / 2 - (pos.x + CARD_W / 2) * k, y: vh * 0.32 - (pos.y + cardH / 2) * k, k }, animate);
  }, [applyView, cardH]);

  const zoomAround = useCallback((factor, px, py, animate) => {
    const v = viewRef.current;
    const k = clampZoom(v.k * factor);
    if (k === v.k) return;
    applyView({ x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k), k }, animate);
  }, [applyView]);

  const zoomButton = (factor) => {
    const { vw, vh } = viewportSize();
    zoomAround(factor, vw / 2, vh / 2, true);
  };

  // ── interactions ───────────────────────────────────────────────────────
  const toggleCollapse = useCallback((id) => {
    const pos = layout.byId.get(id);
    const v = viewRef.current;
    if (pos) pendingRef.current = { type: 'anchor', id, sx: v.x + pos.x * v.k, sy: v.y + pos.y * v.k };
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, [layout, setCollapsed]);

  const flash = (id) => {
    clearTimeout(focusTimer.current);
    setFocusedId(id);
    focusTimer.current = setTimeout(() => setFocusedId(null), 1800);
  };

  /** Open every ancestor of `id` so it is on the chart, then fly to it. */
  const reveal = useCallback((id) => {
    const ancestors = [];
    for (let p = parents.get(id); p; p = parents.get(p)) ancestors.push(p);
    const needsOpen = ancestors.some((a) => collapsedIds.has(a));
    if (needsOpen) {
      pendingRef.current = { type: 'focus', id };
      setCollapsed((prev) => {
        const next = new Set(prev);
        ancestors.forEach((a) => next.delete(a));
        return next;
      });
    } else {
      centerOn(layout, id);
    }
    flash(id);
  }, [parents, collapsedIds, setCollapsed, centerOn, layout]);

  const onSelectCard = useCallback((node) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    centerOn(layout, node.id);
  }, [centerOn, layout]);

  // After every relayout, run whatever the triggering action asked for:
  // keep a toggled card still, fly to a searched person, or reset to top.
  useLayoutEffect(() => {
    if (lastTreeRef.current !== tree) {
      const first = lastTreeRef.current === null;
      lastTreeRef.current = tree;
      pendingRef.current = null;
      const revealId = revealAfterTreeRef.current;
      revealAfterTreeRef.current = null;
      if (revealId && parents.has(revealId)) reveal(revealId);
      else showTop(layout, !first);
      return;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    if (pending.type === 'anchor') {
      const pos = layout.byId.get(pending.id);
      if (!pos) return;
      const v = viewRef.current;
      applyView({ x: pending.sx - pos.x * v.k, y: pending.sy - pos.y * v.k, k: v.k }, true);
    } else if (pending.type === 'focus') {
      centerOn(layout, pending.id);
    } else if (pending.type === 'top') {
      showTop(layout, true);
    }
  }, [layout, tree, parents, reveal, showTop, centerOn, applyView]);

  const meInTree = !!meId && people.some((p) => p.id === meId);
  const canMyDept = !!myDepartment && departments.includes(myDepartment);

  const goTop = () => {
    setGoTo('top');
    if (departmentFilter) { setDepartmentFilter(''); return; }
    pendingRef.current = { type: 'top' };
    setCollapsed(new Set(defaults));
  };
  const goMe = () => {
    setGoTo('me');
    if (departmentFilter) {
      // Wait for the full tree to come back, then reveal (see layout effect).
      revealAfterTreeRef.current = meId;
      setDepartmentFilter('');
    } else {
      reveal(meId);
    }
  };
  const goMyDept = () => { setGoTo('dept'); setDepartmentFilter(myDepartment); };

  const changeDepartment = (d) => {
    setDepartmentFilter(d);
    setGoTo(d && d === myDepartment ? 'dept' : 'top');
  };

  // Drag to pan (window listeners so a drag can leave the viewport).
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, a')) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.sx;
      const dy = ev.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) { d.moved = true; setPanning(true); }
      applyView({ x: d.vx + dx, y: d.vy + dy, k: viewRef.current.k }, false);
    };
    const up = () => {
      if (dragRef.current?.moved) suppressClickRef.current = true;
      dragRef.current = null;
      setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // A click that follows a drag is swallowed once, then cleared.
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Wheel zooms around the cursor; needs a non-passive listener to stop page scroll.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top, false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  useEffect(() => () => { clearTimeout(animTimer.current); clearTimeout(focusTimer.current); }, []);

  // ── search ─────────────────────────────────────────────────────────────
  const term = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return [];
    return people.filter((p) => [fullName(p), p.employee_id, p.designation, p.department]
      .filter(Boolean).join(' ').toLowerCase().includes(term)).slice(0, 8);
  }, [people, term]);

  const pickResult = (p) => {
    setQuery('');
    setSearchOpen(false);
    setGoTo(null);
    reveal(p.id);
  };

  const onSearchKey = (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(results.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); pickResult(results[activeIdx] || results[0]); }
    if (e.key === 'Escape') setSearchOpen(false);
  };

  // The heavy layer only re-renders when the layout changes — pan/zoom only
  // touches the world transform.
  const worldContent = useMemo(() => (
    <>
      {layout.groups.map((g) => {
        const [bg, border, label] = groupColor(g.label);
        return (
          <div key={g.id} className="org-group" style={{ left: g.x, top: g.y, width: g.w, height: g.h, background: bg, borderColor: border }}>
            <span className="org-group-label" style={{ color: label }}>{g.label} · {g.count}</span>
          </div>
        );
      })}
      {layout.lines.map((l) => (
        <div key={l.id} className="org-line" style={{ left: l.x, top: l.y, width: l.w, height: l.h }} />
      ))}
      {layout.nodes.map(({ node, x, y }) => (
        <div key={node.id} className="org-node" style={{ transform: `translate(${x}px, ${y}px)` }}>
          <div className="org-node-enter">
            <OrgTreeNode
              node={node}
              width={CARD_W}
              height={cardH}
              collapsed={collapsedIds.has(node.id)}
              focused={focusedId === node.id}
              onToggleCollapse={toggleCollapse}
              onAssignManager={onAssignManager}
              onSelect={onSelectCard}
            />
          </div>
        </div>
      ))}
    </>
  ), [layout, cardH, collapsedIds, focusedId, toggleCollapse, onAssignManager, onSelectCard]);

  if (!employees || employees.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><i className="fas fa-sitemap" /></div>
        <h3>No employees to show</h3>
        <p>Once employees are added, their reporting structure appears here.</p>
      </div>
    );
  }

  const totalCount = departmentFilter ? people.length : (employees || []).length;
  const topLevelCount = tree.headCount ?? tree.children.filter((c) => !c.isSynthetic).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '14px 16px 10px' }}>
        <div className="org-search">
          <i className="fas fa-search" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search name or EMP code"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setActiveIdx(0); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={onSearchKey}
            style={{ paddingLeft: 32, fontSize: 13, height: 36, width: '100%' }}
          />
          {searchOpen && term && (
            <div className="org-search-results">
              {results.length === 0 && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)' }}>No one matches “{query}”</div>}
              {results.map((p, i) => (
                <div
                  key={p.id}
                  className={`org-search-item${i === activeIdx ? ' is-active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); pickResult(p); }}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <div className="org-card-avatar" style={{ width: 28, height: 28, fontSize: 11, background: getAvatarColor(p.id).split(',')[0] }}>
                    {getInitials(p.first_name, p.last_name)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(p)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[p.employee_id && `#${p.employee_id}`, p.designation, p.department].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {departments.length > 0 && (
          <select
            className="form-select"
            value={departmentFilter}
            onChange={(e) => changeDepartment(e.target.value)}
            style={{ fontSize: 13, height: 36, minWidth: 190 }}
            title="Show only one department's structure"
          >
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Go to</span>
          <div className="org-segment">
            <button className={goTo === 'dept' ? 'is-active' : ''} onClick={goMyDept} disabled={!canMyDept} title={canMyDept ? `Show ${myDepartment}` : 'Your department is not on this chart'}>
              <i className="fas fa-users" /> My Department
            </button>
            <button className={goTo === 'top' ? 'is-active' : ''} onClick={goTop}>
              <i className="fas fa-sitemap" /> Top of the Org
            </button>
            <button className={goTo === 'me' ? 'is-active' : ''} onClick={goMe} disabled={!meInTree} title={meInTree ? 'Find me on the chart' : 'You are not on this chart'}>
              <i className="far fa-user" /> Me
            </button>
          </div>
          <label className={`org-switch${groupByDept ? ' is-on' : ''}`} onClick={() => setGroupByDept((g) => !g)}>
            <span className="org-switch-track" /> Group by department
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
          <span>
            <strong style={{ color: 'var(--text)' }}>{totalCount}</strong> employee{totalCount === 1 ? '' : 's'}
            {departmentFilter && <> in <strong style={{ color: 'var(--text)' }}>{departmentFilter}</strong></>}
          </span>
          {!departmentFilter && (
            <span><strong style={{ color: 'var(--text)' }}>{departments.length}</strong> department{departments.length === 1 ? '' : 's'}</span>
          )}
          <span>
            <strong style={{ color: 'var(--text)' }}>{topLevelCount}</strong>{' '}
            {departmentFilter ? 'at the top of this department' : topManagement ? 'reporting to Abhishek Sir' : 'at the top level'}
          </span>
          {departmentFilter && (
            <button className="btn btn-outline btn-sm" onClick={() => changeDepartment('')}>
              <i className="fas fa-xmark" style={{ marginRight: 6 }} /> Show full structure
            </button>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            <button className="btn-link" style={{ fontSize: 12, background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}
              onClick={() => { pendingRef.current = { type: 'top' }; setCollapsed(new Set()); }}>
              Expand all
            </button>
            <button className="btn-link" style={{ fontSize: 12, background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}
              onClick={() => { pendingRef.current = { type: 'top' }; setCollapsed(collectExpandableIds(tree)); }}>
              Collapse all
            </button>
          </span>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`org-viewport${panning ? ' is-panning' : ''}`}
        onPointerDown={onPointerDown}
      >
        <div
          className={`org-world${animating ? ' is-animating' : ''}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          {worldContent}
        </div>

        <div className="org-zoom-panel">
          <button title="Zoom in" onClick={() => zoomButton(1.2)}><i className="fas fa-plus" /></button>
          <button title="Zoom out" onClick={() => zoomButton(1 / 1.2)}><i className="fas fa-minus" /></button>
          <button title="Fit to screen" onClick={fitAll}><i className="fas fa-expand" /></button>
          <button title="Back to top" onClick={() => showTop(layout, true)}><i className="fas fa-crosshairs" /></button>
        </div>
        <div className="org-zoom-label">{Math.round(view.k * 100)}%</div>
        <div style={{ position: 'absolute', left: 16, bottom: 14, fontSize: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}>
          Drag to move · scroll to zoom · click a card to centre it
        </div>
      </div>
    </div>
  );
}
