import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { fmt } from '@/lib/helpers';
import { effectiveDue } from '@/services/taskService';

/**
 * Collects what a status change needs under the register rules (due date to
 * start, a reason for Blocked / late Done, a deliverable link or note when it
 * goes to review) and hands one patch back. The DB enforces the same rules.
 */
export default function StatusChangeModal({ request, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setNote(''); setLink(''); setDue(''); }, [request]);

  if (!request) return <Modal show={false} onClose={onClose} title="" />;
  const { task, status, needs } = request;
  const late = status === 'Done' && needs.reason;

  const submit = async () => {
    if (needs.due && !due) return showToast('Pick a due date first', 'error');
    if (needs.reason && !note.trim()) return showToast(status === 'Blocked' ? 'Say what is blocking this task' : 'Add a reason for the delay', 'error');
    if (link && !/^https?:\/\/\S+$/i.test(link.trim())) return showToast('Links must start with http:// or https://', 'error');
    if (needs.proof && !link.trim() && !note.trim()) return showToast('Add a deliverable link, or a note if there is no document', 'error');
    const patch = { status, status_note: note.trim() || null };
    if (needs.due) patch.due_date = due;
    if (link.trim()) patch.deliverables = [...(task.deliverables || []), { label: 'Deliverable', url: link.trim() }];
    setSaving(true);
    try { await onConfirm(task, patch); } finally { setSaving(false); }
  };

  const title = status === 'Blocked' ? 'Mark as Blocked' : status === 'Done' ? 'Mark as Done' : `Move to ${status}`;

  return (
    <Modal show onClose={onClose} title={title} width="480px"
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Confirm'}</button>
      </>}
    >
      <p style={{ fontSize: 13, margin: '0 0 14px', fontWeight: 600 }}>{task.title}</p>

      {needs.due && (
        <div className="form-group">
          <label className="form-label">Due date *</label>
          <input className="form-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            A task needs a due date before work starts. It is locked once set — later slips go on a revised due date.
          </div>
        </div>
      )}

      {needs.proof && (
        <div className="form-group">
          <label className="form-label">Deliverable link</label>
          <input className="form-input" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            This goes to review. Link the finished work, or explain below if there is no document.
          </div>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">
          {status === 'Blocked' ? 'What is blocking it? *' : late ? 'Reason for the delay *' : needs.proof ? 'Completion note' : 'Note (optional)'}
        </label>
        <textarea className="form-input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        {late && (
          <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
            Due {fmt.date(effectiveDue(task))} — this is being closed late.
          </div>
        )}
      </div>
    </Modal>
  );
}
