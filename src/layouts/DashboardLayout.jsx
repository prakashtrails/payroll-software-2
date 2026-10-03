import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import AssistantWidget from '../components/AssistantWidget';
import { ToastContainer, showToast } from '../components/Toast';
import { useAuth } from '@/context/AuthContext';
import { OutletViewProvider } from '@/context/OutletViewContext';
import { FeatureProvider } from '@/context/FeatureContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { supabase } from '@/lib/supabase';
import { clearMustChangePassword, recordCurrentPassword } from '@/services/employeeService';
import { validatePassword } from '@/lib/helpers';

// ─── Force-password-change modal ─────────────────────────────────────────────

function ForcePasswordChange({ onDone, onSessionExpired }) {
  const [form, setForm]       = useState({ password: '', confirm: '' });
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError('');
    const { password, confirm } = form;
    const pwError = validatePassword(password);
    if (pwError) return setError(pwError);
    if (password !== confirm) return setError('Passwords do not match.');

    setSaving(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;

      const { error: dbError } = await clearMustChangePassword();
      if (dbError) throw new Error('Could not save password change: ' + dbError.message);

      // Best-effort (awaited so it can't be cut short by onDone() unmounting
      // this modal before the request lands) — a failure here shouldn't block
      // the employee's own password change, just leave HR's copy stale.
      await recordCurrentPassword(password);

      onDone();
    } catch (err) {
      // An admin resetting this same employee's password (e.g. a second reset
      // while this modal was already open) revokes the browser's existing Auth
      // session server-side. Without this check, updateUser() would keep failing
      // with "Auth session missing!" forever, trapping the employee in this
      // non-dismissable modal with no way out — the fix is a fresh login instead.
      if (err.message?.includes('Auth session missing') || err.name === 'AuthSessionMissingError') {
        onSessionExpired();
        return;
      }
      setError(err.message || 'Could not update password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    /* Full-screen backdrop — not dismissible */
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-xl)', padding: '36px 32px',
        width: '100%', maxWidth: 420,
      }}>
        {/* Icon */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 60, height: 60, borderRadius: '50%',
            background: 'var(--warning-light)', color: 'var(--warning)',
            fontSize: 26, marginBottom: 12,
          }}>
            <i className="fas fa-lock" />
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Set Your Password</h2>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            You're using a temporary password. Please create a new password before continuing.
          </p>
        </div>

        {error && (
          <div style={{
            background: 'var(--danger-light)', color: 'var(--danger)',
            padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            fontSize: 13, marginBottom: 16,
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <i className="fas fa-exclamation-circle" style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label">New Password *</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input"
                type={showPw ? 'text' : 'password'}
                placeholder="Min. 8 chars, upper, lower & number"
                value={form.password}
                onChange={set('password')}
                autoFocus
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: 4,
                }}
              >
                <i className={`fas ${showPw ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Confirm New Password *</label>
            <input
              className="form-input"
              type={showPw ? 'text' : 'password'}
              placeholder="Re-enter your password"
              value={form.confirm}
              onChange={set('confirm')}
            />
          </div>

          <div className="form-hint" style={{ marginBottom: 20 }}>
            <i className="fas fa-shield-alt" style={{ color: 'var(--success)' }} />{' '}
            Your temporary password will be replaced immediately.
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={saving}
          >
            {saving
              ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Saving…</>
              : <><i className="fas fa-check" /> Set Password & Continue</>}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function DashboardLayout() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Auto-close the mobile drawer whenever the route changes.
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Prevent the page behind the drawer from scrolling while it's open.
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const handlePasswordSet = async () => {
    await refreshProfile();
  };

  const handleSessionExpired = async () => {
    await signOut();
    showToast('Your session expired because the password was changed. Please log in again with your temporary password.', 'warning');
    navigate('/login', { replace: true });
  };

  return (
    <NotificationProvider>
      <OutletViewProvider>
        <FeatureProvider>
          <div className="layout">
            <button
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <i className="fas fa-bars" />
            </button>
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <main className="main-content">
              <Outlet />
            </main>
            <ToastContainer />
            <AssistantWidget />

            {profile?.must_change_password && (
              <ForcePasswordChange onDone={handlePasswordSet} onSessionExpired={handleSessionExpired} />
            )}
          </div>
        </FeatureProvider>
      </OutletViewProvider>
    </NotificationProvider>
  );
}
