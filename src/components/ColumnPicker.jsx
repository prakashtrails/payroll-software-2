import React, { useState } from 'react';

/**
 * Inline tick/untick panel for choosing which columns a report export
 * includes. `columns` is [{ key, label }] in the order they appear in the
 * sheet; `selected` is the Set of currently-checked keys; `onChange` receives
 * the next Set. Collapsed by default so it doesn't dominate the report card.
 */
export default function ColumnPicker({ columns, selected, onChange, disabled }) {
  const [open, setOpen] = useState(false);

  if (!columns?.length) return null;

  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) {
      // Keep at least one column selected — an empty export is never useful.
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  };

  const allChecked = columns.every((c) => selected.has(c.key));
  const toggleAll = () => onChange(allChecked ? new Set([columns[0].key]) : new Set(columns.map((c) => c.key)));

  return (
    <div style={{ fontSize: 12 }}>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        style={{ width: '100%' }}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        <i className={`fas fa-chevron-${open ? 'up' : 'down'}`} style={{ marginRight: 6 }} />
        Columns ({selected.size}/{columns.length})
      </button>
      {open && (
        <div style={{
          marginTop: 8, border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 10px', maxHeight: 180, overflowY: 'auto', background: 'var(--bg)',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={disabled} />
            Select all
          </label>
          {columns.map((c) => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.has(c.key)}
                onChange={() => toggle(c.key)}
                disabled={disabled}
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
