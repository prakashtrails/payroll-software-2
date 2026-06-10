import React, { useState, useRef, useEffect, useCallback } from 'react';

const CX = 110, CY = 110, R_NUM = 78, R_INNER = 52;

function polarPos(index, total, r) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
}

const HOURS   = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export default function TimePicker({ value = '', onChange, placeholder = 'Select time', disabled }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('hour');
  const [pos,  setPos]  = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const dropRef    = useRef(null);

  const h24 = value ? parseInt(value.split(':')[0], 10) : -1;
  const min  = value ? parseInt(value.split(':')[1], 10) : 0;
  const isPM = h24 >= 12;
  const h12  = h24 < 0 ? -1 : (h24 % 12 || 12);

  const openPicker = () => {
    if (disabled) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropH = 380;
    const top = window.innerHeight - rect.bottom > dropH
      ? rect.bottom + 6
      : rect.top - dropH - 6;
    setPos({ top, left: Math.min(rect.left, window.innerWidth - 244) });
    setMode('hour');
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

  const pickHour = (h) => {
    const h24new = isPM ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
    onChange(`${String(h24new).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    setMode('minute');
  };

  const pickMinute = (m) => {
    onChange(`${String(h24 < 0 ? 9 : h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    setOpen(false);
    setMode('hour');
  };

  const toggleAMPM = () => {
    if (h24 < 0) return;
    const newH24 = isPM ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12);
    onChange(`${String(newH24).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  };

  // Hand angle
  const handAngle = mode === 'hour'
    ? ((h12 < 0 ? 0 : (h12 === 12 ? 0 : h12)) / 12) * 2 * Math.PI - Math.PI / 2
    : (min / 60) * 2 * Math.PI - Math.PI / 2;
  const handLen = mode === 'hour' ? R_NUM : R_NUM;
  const handX = CX + handLen * Math.cos(handAngle);
  const handY = CY + handLen * Math.sin(handAngle);

  const displayVal = h24 < 0
    ? <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>
    : `${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;

  return (
    <>
      <div
        ref={triggerRef}
        className="form-input"
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none', opacity: disabled ? 0.6 : 1 }}
        onClick={openPicker}
      >
        <i className="fas fa-clock" style={{ color: 'var(--primary)', fontSize: 13 }} />
        <span style={{ flex: 1, fontSize: 13 }}>{displayVal}</span>
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
            width: 240, background: 'var(--card-bg)',
            border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: '14px 14px 12px',
          }}
        >
          {/* Time display */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 10 }}>
            <span
              onClick={() => setMode('hour')}
              style={{
                fontSize: 26, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
                color: mode === 'hour' ? 'var(--primary)' : 'var(--text)',
                background: mode === 'hour' ? 'rgba(var(--primary-rgb,59,130,246),.12)' : 'transparent',
                borderRadius: 6, padding: '2px 6px',
              }}
            >
              {h24 < 0 ? '--' : String(h12).padStart(2, '0')}
            </span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-muted)' }}>:</span>
            <span
              onClick={() => setMode('minute')}
              style={{
                fontSize: 26, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
                color: mode === 'minute' ? 'var(--primary)' : 'var(--text)',
                background: mode === 'minute' ? 'rgba(var(--primary-rgb,59,130,246),.12)' : 'transparent',
                borderRadius: 6, padding: '2px 6px',
              }}
            >
              {h24 < 0 ? '--' : String(min).padStart(2, '0')}
            </span>
            <button
              onClick={toggleAMPM}
              style={{
                marginLeft: 6, fontSize: 11, fontWeight: 700,
                background: 'var(--primary)', color: '#fff',
                border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
              }}
            >
              {isPM ? 'PM' : 'AM'}
            </button>
          </div>

          {/* Mode label */}
          <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            {mode === 'hour' ? 'Select Hour' : 'Select Minute'}
          </div>

          {/* Clock face */}
          <svg width={212} height={212} viewBox="0 0 220 220" style={{ display: 'block', margin: '0 auto' }}>
            {/* Face */}
            <circle cx={CX} cy={CY} r={106} fill="var(--bg)" />
            <circle cx={CX} cy={CY} r={106} fill="none" stroke="var(--border)" strokeWidth={1.5} />

            {/* Tick marks */}
            {Array.from({ length: 60 }).map((_, i) => {
              const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
              const isMajor = i % 5 === 0;
              const r1 = 102, r2 = isMajor ? 93 : 98;
              return (
                <line key={i}
                  x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)}
                  x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)}
                  stroke="var(--border)" strokeWidth={isMajor ? 1.5 : 0.8}
                />
              );
            })}

            {/* Hand */}
            {h24 >= 0 && (
              <>
                <line x1={CX} y1={CY} x2={handX} y2={handY}
                  stroke="var(--primary)" strokeWidth={2} strokeLinecap="round" />
                <circle cx={CX} cy={CY} r={4} fill="var(--primary)" />
                <circle cx={handX} cy={handY} r={5} fill="var(--primary)" />
              </>
            )}

            {/* Numbers */}
            {mode === 'hour'
              ? HOURS.map((h, i) => {
                  const p = polarPos(i, 12, R_NUM);
                  const sel = h === h12;
                  return (
                    <g key={h} style={{ cursor: 'pointer' }} onClick={() => pickHour(h)}>
                      <circle cx={p.x} cy={p.y} r={16}
                        fill={sel ? 'var(--primary)' : 'transparent'}
                        stroke={sel ? 'var(--primary)' : 'transparent'}
                      />
                      <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                        fontSize={13} fontWeight={sel ? 700 : 500}
                        fill={sel ? '#fff' : 'var(--text)'}
                        style={{ pointerEvents: 'none' }}
                      >{h}</text>
                    </g>
                  );
                })
              : MINUTES.map((m, i) => {
                  const p = polarPos(i, 12, R_NUM);
                  const sel = m === Math.round(min / 5) * 5 % 60 && min === m;
                  return (
                    <g key={m} style={{ cursor: 'pointer' }} onClick={() => pickMinute(m)}>
                      <circle cx={p.x} cy={p.y} r={16}
                        fill={sel ? 'var(--primary)' : 'transparent'}
                        stroke={sel ? 'var(--primary)' : 'transparent'}
                      />
                      <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                        fontSize={12} fontWeight={sel ? 700 : 500}
                        fill={sel ? '#fff' : 'var(--text)'}
                        style={{ pointerEvents: 'none' }}
                      >{String(m).padStart(2, '0')}</text>
                    </g>
                  );
                })
            }
          </svg>
        </div>
      )}
    </>
  );
}
