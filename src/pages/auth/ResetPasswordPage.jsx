import React from 'react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ErrorBanner, SuccessBanner } from '@/components/OtpVerification';
import { validatePassword } from '@/lib/helpers';

const ICON_STYLE = {
  position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
  color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none',
};
const EYE_STYLE = {
  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', fontSize: 14, padding: 2,
};

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // Verify that user has a valid password recovery session
  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        // Supabase will automatically parse the recovery token from URL
        // when detectSessionInUrl is enabled
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (cancelled) return;

        if (sessionError) {
          setError('Failed to verify session. ' + sessionError.message);
          setIsValidSession(false);
          setCheckingSession(false);
          return;
        }

        if (session?.user) {
          // Valid session found (recovery link was processed)
          setIsValidSession(true);
          setCheckingSession(false);
          return;
        }

        // No session - check if there's a recovery token in the URL
        const hash = window.location.hash;
        if (hash.includes('type=recovery') && hash.includes('access_token')) {
          // Token is present but not yet processed, should be picked up by detectSessionInUrl.
          // Keep showing the loading state until this delayed re-check actually resolves —
          // resolving checkingSession immediately here flashed a false "invalid link" error.
          setTimeout(async () => {
            if (cancelled) return;
            const { data: { session: newSession } } = await supabase.auth.getSession();
            if (cancelled) return;
            if (newSession?.user) {
              setIsValidSession(true);
            } else {
              setError('Invalid or expired password reset link. Please request a new one.');
              setIsValidSession(false);
            }
            setCheckingSession(false);
          }, 500);
          return;
        }

        setError('Invalid or expired password reset link. Please request a new one.');
        setIsValidSession(false);
        setCheckingSession(false);
      } catch (err) {
        if (cancelled) return;
        setError('Failed to verify session: ' + err.message);
        setIsValidSession(false);
        setCheckingSession(false);
      }
    };

    checkSession();
    return () => { cancelled = true; };
  }, []);

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (!newPassword || !confirmPassword) {
      setError('Please enter both password and confirmation.');
      return;
    }

    const pwError = validatePassword(newPassword);
    if (pwError) {
      setError(pwError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      
      if (error) throw error;

      setSuccess('Password reset successfully! Redirecting to login...');
      
      // Sign out and redirect
      setTimeout(async () => {
        await supabase.auth.signOut();
        navigate('/login', { replace: true });
      }, 2000);
    } catch (err) {
      setError(err.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: 'center', padding: '48px 36px' }}>
          <div className="auth-logo" style={{ marginBottom: 24 }}>
            <div className="logo-icon"><img src="/logo.png" alt="CrewCore" /></div>
            <h1>CrewCore</h1>
          </div>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Verifying reset link…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="logo-icon"><img src="/logo.png" alt="CrewCore" /></div>
          <h1>CrewCore</h1>
          <span className="auth-tagline">Smart Workforce Management</span>
        </div>

        <div className="auth-title">
          <h2>Reset Password</h2>
          <p>Create a new password for your account</p>
        </div>

        {isValidSession ? (
          <form onSubmit={handleReset}>
            <ErrorBanner message={error} />
            <SuccessBanner message={success} />

            <div className="form-group">
              <label className="form-label">New Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  style={{ paddingLeft: 38, paddingRight: 42 }}
                  disabled={loading || success}
                />
                <i className="fas fa-lock" style={ICON_STYLE} />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={EYE_STYLE}
                  disabled={loading || success}
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                </button>
              </div>
              <div className="form-hint">
                Must be at least 8 characters with uppercase, lowercase, and numbers.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  style={{ paddingLeft: 38, paddingRight: 42 }}
                  disabled={loading || success}
                />
                <i className="fas fa-lock" style={ICON_STYLE} />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  style={EYE_STYLE}
                  disabled={loading || success}
                >
                  <i className={`fas ${showConfirm ? 'fa-eye-slash' : 'fa-eye'}`} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              disabled={loading || success}
              style={{ marginTop: 8, borderRadius: 12, fontSize: 14 }}
            >
              {loading ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Resetting…
                </>
              ) : (
                <>
                  <i className="fas fa-key" /> Reset Password
                </>
              )}
            </button>
          </form>
        ) : (
          <div style={{
            background: 'var(--danger-light)',
            color: 'var(--danger)',
            padding: '16px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: 14,
            marginBottom: 16,
          }}>
            <i className="fas fa-exclamation-circle" style={{ marginRight: 8 }} />
            {error || 'Unable to verify password reset link.'}
          </div>
        )}

        <div className="auth-divider">or</div>
        <div className="auth-footer">
          Remember your password?{' '}
          <a href="/login" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
            Back to login
          </a>
        </div>

        <div className="auth-trust">
          <div className="auth-trust-item"><i className="fas fa-shield-halved" /> Secure &amp; Encrypted</div>
          <div className="auth-trust-item"><i className="fas fa-building" /> Multi-tenant</div>
          <div className="auth-trust-item"><i className="fas fa-lock" /> RLS Protected</div>
        </div>
      </div>
    </div>
  );
}
