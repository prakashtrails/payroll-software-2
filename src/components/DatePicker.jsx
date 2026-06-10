import React, { useState, useRef, useEffect } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function DatePicker({ value = '', onChange, placeholder = 'Select date', max, min: minDate, disabled }) {
  const [open,      setOpen]      = useState(false);
  const [pos,       setPos]       = useState({ top: 0, left: 0 });
  const [viewYear,  setViewYear]  = useState(() => value ? parseInt(value.slice(0,4)) : new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value ? parseInt(value.slice(5,7)) - 1 : new Date().getMonth());
  const triggerRef = useRef(null);
  const dropRef    = useRef(null);

  const today = todayISO();

  // Sync view to value when value changes externally
  useEffect(() => {
    if (value) {
      setViewYear(parseInt(value.slice(0, 4)));
      setViewMonth(parseInt(value.slice(5, 7)) - 1);
    }
  }, [value]);

  const openPicker = () => {
    if (disabled) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropH = 320;
    const top = window.innerHeight - rect.bottom > dropH
      ? rect.bottom + 6
      : rect.top - dropH - 6;
    setPos({ top, left: Math.min(rect.left, window.innerWidth - 292) });
    setOpen(true);
  };

  useEffect(() => {
    const handler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        dropRef.current    && !dropRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const daysInMonth   = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekDay  = new Date(viewYear, viewMonth, 1).getDay();

  const pickDay = (day) => {
    const ds = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if ((max && ds > max) || (minDate && ds < minDate)) return;
    onChange(ds);
    setOpen(false);
  };

  const displayVal = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  return (
    <>
      <div
        ref={triggerRef}
        className="form-input"
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none', opacity: disabled ? 0.6 : 1 }}
        onClick={openPicker}
      >
        <i className="fas fa-calendar-alt" style={{ color: 'var(--primary)', fontSize: 13 }} />
        <span style={{ flex: 1, fontSize: 13, color: value ? 'inherit' : 'var(--text-muted)' }}>
          {displayVal || placeholder}
        </span>
        {value && (
          <i className="fas fa-times" style={{ color: 'var(--text-muted)', fontSize: 11 }}
            onClick={e => { e.stopPropagation(); onChange(''); }} />
        )}
      </div>

      {open && (
        <div
          ref={dropRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
            width: 284, background: 'var(--card-bg)',
            border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: '14px 12px 10px',
          }}
        >
          {/* Month / Year header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={prevMonth} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, color: 'var(--text)' }}>
              <i className="fas fa-chevron-left" style={{ fontSize: 12 }} />
            </button>
            <strong style={{ fontSize: 14 }}>{MONTHS[viewMonth]} {viewYear}</strong>
            <button onClick={nextMonth} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, color: 'var(--text)' }}>
              <i className="fas fa-chevron-right" style={{ fontSize: 12 }} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {DAY_LABELS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {Array.from({ length: firstWeekDay }).map((_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const ds = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const isSelected = ds === value;
              const isToday    = ds === today;
              const isDisabled = (max && ds > max) || (minDate && ds < minDate);

              return (
                <div
                  key={day}
                  onClick={() => !isDisabled && pickDay(day)}
                  style={{
                    textAlign: 'center', padding: '6px 0', fontSize: 12,
                    borderRadius: 6,
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    background: isSelected ? 'var(--primary)' : isToday ? 'rgba(var(--primary-rgb,59,130,246),.1)' : 'transparent',
                    color: isDisabled ? 'var(--text-muted)'
                          : isSelected ? '#fff'
                          : isToday ? 'var(--primary)'
                          : 'var(--text)',
                    fontWeight: isSelected || isToday ? 700 : 400,
                    opacity: isDisabled ? 0.35 : 1,
                    outline: isToday && !isSelected ? '1px solid var(--primary)' : 'none',
                    transition: 'background 0.1s',
                  }}
                >
                  {day}
                </div>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div style={{ marginTop: 10, textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <button
              onClick={() => { if (!((max && today > max) || (minDate && today < minDate))) { onChange(today); setOpen(false); } }}
              disabled={(max && today > max) || (minDate && today < minDate)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </>
  );
}
