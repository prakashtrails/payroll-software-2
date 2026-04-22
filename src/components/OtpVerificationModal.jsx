import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendOtp, verifyOtp } from '@/services/otpService';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

function maskDestination(to, channel) {
  if (channel === 'sms') {
    if (to.length <= 4) return to;
    return to.slice(0, 3) + '****' + to.slice(-4);
  }
  // email
  const [local, domain] = to.split('@');
  if (!domain) return to;
  return local.charAt(0) + '***@' + domain;
}

export default function OtpVerificationModal({ show, to, channel, onVerified, onCancel }) {
  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef([]);
  const timerRef = useRef(null);

  // Send OTP when modal opens
  const doSend = useCallback(async () => {
    setSending(true);
    setError('');
    try {
      await sendOtp(to, channel);
      setSent(true);
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setSending(false);
    }
  }, [to, channel]);

  useEffect(() => {
    if (show && to && channel) {
      setDigits(Array(OTP_LENGTH).fill(''));
      setError('');
      setSent(false);
      doSend();
    }
    return () => clearInterval(timerRef.current);
  }, [show, to, channel, doSend]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) { clearInterval(timerRef.current); return 0; }
          return c - 1;
        });
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [cooldown]);

  // Focus first input when sent
  useEffect(() => {
    if (sent && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [sent]);

  const handleChange = (index, value) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    setError('');

    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill('');
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    const focusIdx = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIdx]?.focus();
  };

  const handleVerify = async () => {
    const code = digits.join('');
    if (code.length !== OTP_LENGTH) {
      setError('Please enter the complete 6-digit code');
      return;
    }
    setVerifying(true);
    setError('');
    try {
      const result = await verifyOtp(to, code);
      if (result.verified) {
        onVerified();
      } else {
        setError('Invalid code. Please try again.');
        setDigits(Array(OTP_LENGTH).fill(''));
        inputRefs.current[0]?.focus();
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = () => {
    if (cooldown > 0) return;
    setDigits(Array(OTP_LENGTH).fill(''));
    doSend();
  };

  if (!show) return null;

  return (
    <div className="modal-overlay show" onClick={onCancel}>
      <div
        className="modal"
        style={{ width: 420, maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>
            <i className={`fas ${channel === 'sms' ? 'fa-mobile-alt' : 'fa-envelope'}`}
               style={{ marginRight: 8, color: 'var(--primary)' }} />
            Verify {channel === 'sms' ? 'Phone Number' : 'Email Address'}
          </h3>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>

        <div className="modal-body" style={{ textAlign: 'center', padding: '24px 28px' }}>
          {sending && !sent ? (
            <div style={{ padding: '32px 0' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Sending verification code...
              </p>
            </div>
          ) : (
            <>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
                We sent a 6-digit code to{' '}
                <strong style={{ color: 'var(--text)' }}>{maskDestination(to, channel)}</strong>
              </p>

              {/* OTP digit inputs */}
              <div style={{
                display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16,
              }}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => (inputRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onPaste={i === 0 ? handlePaste : undefined}
                    style={{
                      width: 44, height: 52,
                      textAlign: 'center', fontSize: 22, fontWeight: 700,
                      fontFamily: 'monospace',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      outline: 'none',
                      transition: 'border-color 0.15s',
                      background: 'var(--bg)',
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'var(--primary)'; }}
                    onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; }}
                  />
                ))}
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  background: 'var(--danger-light)', color: 'var(--danger)',
                  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, marginBottom: 16,
                  display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
                }}>
                  <i className="fas fa-exclamation-circle" />
                  {error}
                </div>
              )}

              {/* Verify button */}
              <button
                className="btn btn-primary btn-block"
                onClick={handleVerify}
                disabled={verifying || digits.join('').length !== OTP_LENGTH}
                style={{ marginBottom: 16, borderRadius: 10, fontSize: 14 }}
              >
                {verifying ? (
                  <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Verifying...</>
                ) : (
                  <><i className="fas fa-check-circle" /> Verify Code</>
                )}
              </button>

              {/* Resend */}
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Didn't receive the code?{' '}
                {cooldown > 0 ? (
                  <span>Resend in <strong>{cooldown}s</strong></span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={sending}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--primary)', fontWeight: 600, fontSize: 12,
                      textDecoration: 'underline', padding: 0,
                    }}
                  >
                    Resend Code
                  </button>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
