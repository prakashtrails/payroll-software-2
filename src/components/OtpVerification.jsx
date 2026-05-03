/**
 * components/OtpVerification.jsx
 *
 * Shared OTP UI components used in both LoginPage and SignupPage.
 * Keeps the 6-box input, resend timer, and banners in one place.
 */

import React, { useRef, useState, useEffect } from 'react';

/* ─── Banners ──────────────────────────────────────────────────────────────── */

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: 'var(--danger-light)', color: 'var(--danger)',
      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
      fontSize: 13, marginBottom: 16,
      display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      <i className="fas fa-exclamation-circle" style={{ marginTop: 2, flexShrink: 0 }} />
      <span>{message}</span>
    </div>
  );
}

export function SuccessBanner({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: 'var(--success-light)', color: 'var(--success)',
      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
      fontSize: 13, marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <i className="fas fa-check-circle" style={{ flexShrink: 0 }} />
      <span>{message}</span>
    </div>
  );
}

/* ─── 6-box OTP input ──────────────────────────────────────────────────────── */

export function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);

  const handleKey = (i, e) => {
    if (e.key === 'Backspace') {
      if (!value[i] && i > 0) refs.current[i - 1]?.focus();
      const a = value.split(''); a[i] = ''; onChange(a.join(''));
      return;
    }
    if (e.key === 'ArrowLeft'  && i > 0) { refs.current[i - 1]?.focus(); return; }
    if (e.key === 'ArrowRight' && i < 5) { refs.current[i + 1]?.focus(); return; }
  };

  const handleChange = (i, e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;
    if (raw.length > 1) {
      // Handle paste
      const a = value.split('');
      raw.slice(0, 6 - i).split('').forEach((ch, j) => { a[i + j] = ch; });
      onChange(a.join('').slice(0, 6));
      setTimeout(() => refs.current[Math.min(i + raw.length, 5)]?.focus(), 0);
      return;
    }
    const a = value.padEnd(6, '').split(''); a[i] = raw; onChange(a.join(''));
    if (i < 5) setTimeout(() => refs.current[i + 1]?.focus(), 0);
  };

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '8px 0' }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text" inputMode="numeric" maxLength={6}
          value={value[i] || ''} disabled={disabled}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKey(i, e)}
          onFocus={(e) => e.target.select()}
          style={{
            width: 44, height: 52, textAlign: 'center',
            fontSize: 22, fontWeight: 700,
            border: `2px solid ${value[i] ? 'var(--primary)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)', color: 'var(--text)',
            outline: 'none', transition: 'border-color .15s',
            caretColor: 'transparent',
          }}
        />
      ))}
    </div>
  );
}

/* ─── Resend countdown timer ───────────────────────────────────────────────── */

export function ResendTimer({ onResend, loading, cooldown = 60 }) {
  const [sec, setSec] = useState(cooldown);

  useEffect(() => {
    if (sec <= 0) return;
    const id = setTimeout(() => setSec((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [sec]);

  const handle = async () => { await onResend(); setSec(cooldown); };

  if (sec > 0) return (
    <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
      Resend OTP in{' '}
      <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
        {String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}
      </span>
    </p>
  );

  return (
    <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
      Didn&apos;t receive it?{' '}
      <button type="button" disabled={loading} onClick={handle} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--primary)', fontWeight: 700, fontSize: 12,
        padding: 0, textDecoration: 'underline',
      }}>
        {loading ? 'Sending…' : 'Resend OTP'}
      </button>
    </p>
  );
}

/* ─── OTP Step UI (step 2 of signup / login) ───────────────────────────────── */

/**
 * Reusable OTP verification panel.
 *
 * Props:
 *   identifier   — email or phone that OTP was sent to
 *   idType       — 'email' | 'phone'
 *   otp          — current OTP string (state lifted up)
 *   onChange     — setter for otp
 *   onVerify     — called when Verify button clicked
 *   onResend     — called when Resend is clicked
 *   onBack       — called when back arrow clicked
 *   verifying    — bool
 *   sending      — bool
 *   error        — string
 *   successMsg   — string
 */
export function OtpStepPanel({
  identifier, idType, otp, onChange,
  onVerify, onResend, onBack,
  verifying, sending, error, successMsg,
}) {
  return (
    <div>
      <SuccessBanner message={successMsg} />
      <ErrorBanner   message={error} />

      {/* Back */}
      <button type="button" onClick={onBack} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text-muted)', fontSize: 12, padding: '0 0 16px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <i className="fas fa-arrow-left" /> Edit {idType === 'phone' ? 'mobile number' : 'email'}
      </button>

      {/* Sent-to card */}
      <div style={{
        background: 'var(--bg)', borderRadius: 'var(--radius-md)',
        padding: '12px 16px', marginBottom: 20, fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <i className={`fas ${idType === 'phone' ? 'fa-mobile-alt' : 'fa-envelope'}`}
          style={{ color: 'var(--primary)', fontSize: 18 }} />
        <div>
          <div style={{ fontWeight: 600 }}>OTP sent to</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{identifier}</div>
        </div>
      </div>

      {/* Digit boxes */}
      <div className="form-group">
        <label className="form-label" style={{ textAlign: 'center', display: 'block' }}>
          Enter 6-Digit OTP
        </label>
        <OtpInput value={otp} onChange={onChange} disabled={verifying} />
        <div className="form-hint" style={{ textAlign: 'center', marginTop: 6 }}>
          OTP expires in 5 minutes
        </div>
      </div>

      <button
        type="button"
        onClick={onVerify}
        className="btn btn-primary btn-lg btn-block"
        disabled={verifying || otp.replace(/\D/g, '').length !== 6}
        style={{ marginTop: 8, borderRadius: 12, fontSize: 14 }}
      >
        {verifying
          ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Verifying…</>
          : <><i className="fas fa-shield-alt" /> Verify OTP</>}
      </button>

      <ResendTimer onResend={onResend} loading={sending} />
    </div>
  );
}