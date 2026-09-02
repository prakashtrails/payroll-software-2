import React, { useState } from 'react';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { setDirectManager } from '@/services/orgHierarchyService';
import { fullName } from '@/lib/helpers';

/** Reassigns node.employee's direct manager among the tenant's other active employees. */
export default function AssignManagerModal({ show, onClose, employee, candidates, onAssigned }) {
  const [managerId, setManagerId] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (show) setManagerId(employee?.manager_id || '');
  }, [show, employee]);

  if (!employee) return null;

  const options = (candidates || []).filter((c) => c.id !== employee.id);

  const save = async () => {
    setSaving(true);
    const { error } = await setDirectManager(employee.id, managerId || null);
    setSaving(false);
    if (error) {
      showToast(error.message || 'Could not update manager', 'error');
      return;
    }
    showToast('Manager updated', 'success');
    onAssigned();
    onClose();
  };

  return (
    <Modal
      show={show}
      onClose={onClose}
      title={`Reassign manager — ${fullName(employee)}`}
      width={420}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Direct manager</label>
        <select className="form-select" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          <option value="">No manager (top of hierarchy)</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>{fullName(c)} — {c.designation || c.role}</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
