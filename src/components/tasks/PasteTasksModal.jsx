import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { fullName } from '@/lib/helpers';
import { createTasks } from '@/services/taskService';

const MAX_ROWS = 100;
const PRIORITY_ALIASES = {
  p0: 'Urgent', urgent: 'Urgent', critical: 'Urgent',
  p1: 'High', high: 'High',
  p2: 'Medium', medium: 'Medium', normal: 'Medium', '': 'Medium',
  p3: 'Low', low: 'Low',
};

// 2026-10-05, 05/10/2026, 05-10-2026, 5.10.26 → ISO date (day first, Indian format).
function parseDate(raw) {
  const s = (raw || '').trim();
  if (!s) return { value: '' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { value: s };
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return { error: `"${s}" is not a date` };
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? { error: `"${s}" is not a date` } : { value: iso };
}

// Excel/Sheets paste is tab-separated; Notepad lists may use " · ", "|" or ",".
const splitLine = (line) => {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(' · ')) return line.split(' · ');
  if (line.includes('|')) return line.split('|');
  return line.split(',');
};

/**
 * Create many tasks at once from a pasted list: Title · Owner · Priority · Due
 * per line (only the title is required; owner defaults to you). Everything
 * starts in To Do and goes in as one insert.
 */
export default function PasteTasksModal({ show, onClose, onCreated, tenantId, profile, people }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const findOwner = useMemo(() => {
    const byKey = new Map();
    const add = (key, p) => {
      const k = key.trim().toLowerCase();
      if (!k) return;
      if (!byKey.has(k)) byKey.set(k, p);
      else if (byKey.get(k) && byKey.get(k).id !== p.id) byKey.set(k, null); // null = ambiguous
    };
    people.forEach((p) => {
      add(fullName(p), p);
      add(`${p.first_name || ''} ${p.last_name || ''}`, p);
      add(p.first_name || '', p);
      if (p.employee_id) add(p.employee_id, p);
    });
    return (raw) => {
      const k = (raw || '').trim().toLowerCase();
      if (!k || k === 'me' || k === 'myself') return { person: people.find((p) => p.id === profile.id) || { id: profile.id } };
      const hit = byKey.get(k);
      if (hit === null) return { error: `"${raw.trim()}" matches more than one person — use the full name or employee ID` };
      if (!hit) return { error: `"${raw.trim()}" is not someone you can assign to` };
      return { person: hit };
    };
  }, [people, profile]);

  const rows = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_ROWS).map((line) => {
    const [title = '', owner = '', priority = '', due = ''] = splitLine(line).map((c) => c.trim());
    const errors = [];
    if (!title) errors.push('Title missing');
    if (title.length > 200) errors.push('Title over 200 characters');
    const o = findOwner(owner);
    if (o.error) errors.push(o.error);
    const pr = PRIORITY_ALIASES[priority.toLowerCase()];
    if (!pr) errors.push(`Priority "${priority}" — use P0–P3 or Low/Medium/High/Urgent`);
    const d = parseDate(due);
    if (d.error) errors.push(d.error);
    return { title, owner: o.person, priority: pr, due_date: d.value, errors };
  }), [text, findOwner]);

  const valid = rows.filter((r) => r.errors.length === 0);
  const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length;

  const close = () => { setText(''); onClose(); };

  const handleCreate = async () => {
    if (!valid.length) return;
    setSaving(true);
    try {
      const { error } = await createTasks(tenantId, valid.map((r) => ({
        title: r.title, assigned_to: r.owner.id, priority: r.priority, due_date: r.due_date || null,
      })));
      if (error) return showToast(error.message, 'error');
      showToast(`${valid.length} task${valid.length === 1 ? '' : 's'} created`, 'success');
      setText('');
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onClose={close} title="Paste tasks" width="760px"
      footer={<>
        <button className="btn btn-outline" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !valid.length || valid.length !== rows.length}>
          {saving ? 'Creating…' : `Create ${valid.length || ''} task${valid.length === 1 ? '' : 's'}`}
        </button>
      </>}
    >
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
        Paste from Excel, Google Sheets or Notepad — one task per line: <b>Title · Owner · Priority · Due date</b>.
        Only the title is required; owner defaults to you, priority to Medium. Everything starts in To Do.
      </p>
      <textarea className="form-input" rows={7} style={{ fontFamily: 'monospace', fontSize: 12 }} value={text}
        placeholder={'Prepare September MIS\tRavi Kumar\tP1\t10/10/2026\nUpdate vendor list\tme\tLow'}
        onChange={(e) => setText(e.target.value)} />
      {lineCount > MAX_ROWS && (
        <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>Only the first {MAX_ROWS} lines are used — paste the rest in another batch.</div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12, maxHeight: 280, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>#</th><th>Title</th><th>Owner</th><th>Priority</th><th>Due</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td style={{ fontSize: 12 }}>{r.title || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.owner ? (r.owner.id === profile.id ? 'You' : fullName(r.owner)) : '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.priority || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.due_date || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--danger)' }}>
                    {r.errors.length ? r.errors.join('; ') : <i className="fas fa-check" style={{ color: 'var(--success)' }} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && valid.length !== rows.length && (
        <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>Fix the highlighted lines to create the tasks.</div>
      )}
    </Modal>
  );
}
