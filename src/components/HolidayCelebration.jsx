import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getHolidayTheme } from '@/lib/holidayThemes';

const BRAND_GRADIENT = 'linear-gradient(145deg, #0A0816 0%, #1A1B2E 40%, #2D1B4E 70%, #1A0F2E 100%)';

function useParticles(emojis, count) {
  return useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      id: i,
      emoji: emojis[i % emojis.length],
      left: Math.random() * 100,
      duration: 2.6 + Math.random() * 1.8,
      delay: Math.random() * 1.1,
      size: 16 + Math.random() * 20,
      drift: (Math.random() - 0.5) * 120,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emojis.join(''), count]
  );
}

/**
 * Full-screen themed overlay shown briefly (a) as the login page's splash on
 * first load, and (b) right after a successful sign-in when today matches a
 * holiday on the tenant's calendar — replacing any one-off "wish" messaging
 * with a shared, always-on-theme animation. `holiday` is null for the plain
 * branded splash (no festival today); any holiday name is themed automatically
 * via getHolidayTheme, including ones added to a tenant's calendar in the future.
 */
export default function HolidayCelebration({ holiday, durationMs = 2600, onDone }) {
  const [exiting, setExiting] = useState(false);
  const doneRef = useRef(false);

  const theme = holiday ? getHolidayTheme(holiday.name) : null;
  const emojis = theme?.emojis || ['✨'];
  const particles = useParticles(emojis, holiday ? 26 : 10);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setExiting(true);
    setTimeout(() => onDone?.(), 450);
  };

  useEffect(() => {
    const t = setTimeout(finish, durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <div
      className={`holiday-overlay ${exiting ? 'holiday-overlay-exit' : ''}`}
      style={{ background: holiday ? theme.gradient : BRAND_GRADIENT }}
      onClick={finish}
      role="presentation"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="holiday-particle"
          style={{
            left: `${p.left}%`,
            fontSize: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            '--drift': `${p.drift}px`,
          }}
        >
          {p.emoji}
        </span>
      ))}
      <div className="holiday-overlay-content">
        {holiday ? (
          <i className={`fas ${theme.icon} holiday-overlay-icon`} />
        ) : (
          <img src="/logo.png" alt="CrewCore" className="holiday-overlay-logo" />
        )}
        <div className="holiday-overlay-title">{holiday ? holiday.name : 'CrewCore'}</div>
        <div className="holiday-overlay-subtitle">
          {holiday ? 'Wishing you a wonderful day!' : 'Smart Workforce Management'}
        </div>
      </div>
    </div>
  );
}
