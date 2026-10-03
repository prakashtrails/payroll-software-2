import React, { useMemo, useState } from 'react';
import { fullName, getInitials, getAvatarColor } from '@/lib/helpers';

const UNASSIGNED_OUTLET = 'Unassigned';
const UNASSIGNED_DIVISION = 'No Division';
const UNASSIGNED_DEPARTMENT = 'No Department';

/**
 * Groups `employees` by `keyFn`, returning [{ key, label, items }], sorted by
 * label with any "unassigned" bucket pushed to the end.
 */
function groupBy(employees, keyFn, fallbackLabel) {
  const map = new Map();
  for (const e of employees) {
    const label = keyFn(e) || fallbackLabel;
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(e);
  }
  return Array.from(map.entries())
    .map(([label, items]) => ({ key: label, label, items }))
    .sort((a, b) => {
      if (a.label === fallbackLabel) return 1;
      if (b.label === fallbackLabel) return -1;
      return a.label.localeCompare(b.label);
    });
}

function DrillCard({ icon, label, count, sublabel, onClick }) {
  const [g1, g2] = getAvatarColor(label).split(',');
  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        margin: 0, padding: '18px 18px', textAlign: 'left', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 14, border: '1px solid var(--border-light)',
        transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--border-light)'; }}
    >
      <div
        style={{
          width: 46, height: 46, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 18, color: '#fff',
          background: `linear-gradient(135deg, ${g1}, ${g2})`, boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      >
        <i className={`fas ${icon}`} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {count} {sublabel}
        </div>
      </div>
      <i className="fas fa-chevron-right" style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }} />
    </div>
  );
}

function PersonCard({ person }) {
  const [g1, g2] = getAvatarColor(person.id).split(',');
  return (
    <div className="card" style={{ margin: 0, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 42, height: 42, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#fff',
          background: `linear-gradient(135deg, ${g1}, ${g2})`, boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      >
        {getInitials(person.first_name, person.last_name)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={fullName(person)}>
          {fullName(person)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {person.designation || person.role}
        </div>
      </div>
      {person.role && person.role !== 'employee' && (
        <span className="badge badge-info" style={{ textTransform: 'capitalize', flexShrink: 0 }}>{person.role}</span>
      )}
    </div>
  );
}

const GRID_STYLE = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 };

/**
 * Outlet-wise structure drill-down: Outlet → Division → Department → Person.
 * Purely a navigation/visualization layer over the same active-employee list
 * OrgHierarchyPage already loads — nothing here mutates data (see OrgTree for
 * the editable manager-reporting chart). Selecting a department narrows the
 * view down to just that department's people; a breadcrumb lets you jump
 * back up to any earlier level.
 */
export default function OutletOrgExplorer({ employees, outlets, tenantName }) {
  const [path, setPath] = useState([]); // [{level:'outlet'|'division'|'department', key, label}]

  const outletNameById = useMemo(() => new Map((outlets || []).map((o) => [o.id, o.name])), [outlets]);

  // Every configured outlet gets a bucket even with zero employees right now,
  // so a freshly-created branch is still visible to drill into.
  const outletGroups = useMemo(() => {
    const map = new Map();
    (outlets || []).forEach((o) => map.set(o.name, []));
    (employees || []).forEach((e) => {
      const label = (e.outlet_id && outletNameById.get(e.outlet_id)) || UNASSIGNED_OUTLET;
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(e);
    });
    return Array.from(map.entries())
      .map(([label, items]) => ({ key: label, label, items }))
      .sort((a, b) => (a.label === UNASSIGNED_OUTLET ? 1 : b.label === UNASSIGNED_OUTLET ? -1 : a.label.localeCompare(b.label)));
  }, [employees, outlets, outletNameById]);

  const outletStep = path[0];
  const divisionStep = path[1];
  const departmentStep = path[2];

  const outletEmployees = outletStep
    ? (outletGroups.find((g) => g.key === outletStep.key)?.items || [])
    : [];
  const divisionGroups = useMemo(
    () => (outletStep ? groupBy(outletEmployees, (e) => e.division, UNASSIGNED_DIVISION) : []),
    [outletStep, outletEmployees]
  );

  const divisionEmployees = divisionStep
    ? (divisionGroups.find((g) => g.key === divisionStep.key)?.items || [])
    : [];
  const departmentGroups = useMemo(
    () => (divisionStep ? groupBy(divisionEmployees, (e) => e.department, UNASSIGNED_DEPARTMENT) : []),
    [divisionStep, divisionEmployees]
  );

  const departmentEmployees = departmentStep
    ? (departmentGroups.find((g) => g.key === departmentStep.key)?.items || [])
    : [];

  const drillTo = (level, group) => {
    const step = { level, key: group.key, label: group.label };
    if (level === 'outlet') setPath([step]);
    else if (level === 'division') setPath([path[0], step]);
    else if (level === 'department') setPath([path[0], path[1], step]);
  };

  const goTo = (index) => setPath(path.slice(0, index + 1)); // index -1 handled by "All Outlets" button below
  const totalCount = (employees || []).length;

  if (!employees || employees.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><i className="fas fa-store" /></div>
        <h3>No employees to show</h3>
        <p>Once employees are added and assigned to an outlet, the branch structure appears here.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: '12px 16px', borderBottom: '1px solid var(--border-light)', fontSize: 13,
        }}
      >
        <button
          className={`btn btn-sm ${path.length === 0 ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setPath([])}
        >
          <i className="fas fa-building" style={{ marginRight: 6 }} />{tenantName || 'All Outlets'}
        </button>
        {path.map((step, i) => (
          <React.Fragment key={step.level}>
            <i className="fas fa-chevron-right" style={{ color: 'var(--text-muted)', fontSize: 10 }} />
            <button
              className={`btn btn-sm ${i === path.length - 1 ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => goTo(i)}
            >
              {step.label}
            </button>
          </React.Fragment>
        ))}

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{totalCount}</strong> employee{totalCount === 1 ? '' : 's'} across{' '}
          <strong style={{ color: 'var(--text)' }}>{outletGroups.length}</strong> outlet{outletGroups.length === 1 ? '' : 's'}
        </span>
      </div>

      <div style={{ padding: '20px 20px', minHeight: 200 }}>
        {!outletStep && (
          <div style={GRID_STYLE}>
            {outletGroups.map((g) => (
              <DrillCard
                key={g.key}
                icon="fa-store"
                label={g.label}
                count={g.items.length}
                sublabel={`employee${g.items.length === 1 ? '' : 's'}`}
                onClick={() => drillTo('outlet', g)}
              />
            ))}
          </div>
        )}

        {outletStep && !divisionStep && (
          divisionGroups.length === 1 && divisionGroups[0].key === UNASSIGNED_DIVISION ? (
            // No divisions configured for this outlet — skip straight to departments
            // instead of forcing a click through a single "No Division" card.
            <DepartmentGrid
              groups={groupBy(outletEmployees, (e) => e.department, UNASSIGNED_DEPARTMENT)}
              onDrill={(g) => setPath([outletStep, { level: 'division', key: UNASSIGNED_DIVISION, label: UNASSIGNED_DIVISION }, { level: 'department', key: g.key, label: g.label }])}
            />
          ) : (
            <div style={GRID_STYLE}>
              {divisionGroups.map((g) => (
                <DrillCard
                  key={g.key}
                  icon="fa-diagram-project"
                  label={g.label}
                  count={g.items.length}
                  sublabel={`employee${g.items.length === 1 ? '' : 's'}`}
                  onClick={() => drillTo('division', g)}
                />
              ))}
            </div>
          )
        )}

        {divisionStep && !departmentStep && (
          <DepartmentGrid groups={departmentGroups} onDrill={(g) => drillTo('department', g)} />
        )}

        {departmentStep && (
          <div style={GRID_STYLE}>
            {departmentEmployees.map((p) => <PersonCard key={p.id} person={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function DepartmentGrid({ groups, onDrill }) {
  return (
    <div style={GRID_STYLE}>
      {groups.map((g) => (
        <DrillCard
          key={g.key}
          icon="fa-sitemap"
          label={g.label}
          count={g.items.length}
          sublabel={`employee${g.items.length === 1 ? '' : 's'}`}
          onClick={() => onDrill(g)}
        />
      ))}
    </div>
  );
}
