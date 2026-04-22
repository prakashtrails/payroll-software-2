import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

let toastId = 0;
let addToastGlobal = null;

export function showToast(msg, type = 'info') {
  if (addToastGlobal) addToastGlobal(msg, type);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg, type) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    addToastGlobal = addToast;
    return () => { addToastGlobal = null; };
  }, [addToast]);

  const icons = {
    info: 'fa-info-circle',
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
  };

  return createPortal(
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <i className={`fas ${icons[t.type] || icons.info}`} style={{ fontSize: 16 }} />
          {t.msg}
        </div>
      ))}
    </div>,
    document.body
  );
}
