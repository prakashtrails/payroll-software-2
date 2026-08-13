import React, { useEffect, useRef, useState } from 'react';

export default function Modal({ show, onClose, title, width, children, footer, fullScreen = false }) {
  // Once the user has touched any field, a stray/accidental click on the
  // backdrop (easy to rack up while filling a long form — adding an employee,
  // posting a job, scheduling a meeting) must never discard their in-progress
  // input. Only the explicit × button or a footer action (e.g. Cancel) closes
  // the modal from then on; the backdrop click just flashes a brief reminder
  // instead of doing nothing silently.
  const [interacted, setInteracted] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const hintTimer = useRef(null);

  useEffect(() => {
    if (show) { setInteracted(false); setShowHint(false); }
  }, [show]);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const handleOverlayClick = () => {
    if (!interacted) {
      onClose();
      return;
    }
    setShowHint(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setShowHint(false), 2200);
  };

  return (
    <div className={`modal-overlay ${show ? 'show' : ''}`} onClick={handleOverlayClick}>
      <div
        className={`modal ${fullScreen ? 'modal-fullscreen' : ''}`}
        style={!fullScreen && width ? { width } : undefined}
        onClick={(e) => e.stopPropagation()}
        onChangeCapture={() => setInteracted(true)}
        onInputCapture={() => setInteracted(true)}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
        {showHint && (
          <div className="modal-discard-hint" style={{
            padding: '8px 20px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center',
          }}>
            Click × or Cancel to close — your entry is kept safe.
          </div>
        )}
      </div>
    </div>
  );
}
