import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { ToastContainer } from '../components/Toast';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { clearMustChangePassword } from '@/services/employeeService';

// ─── Force-password-change modal ─────────────────────────────────────────────

function ForcePasswordChange({ userId, onDone }) {
  const [form, setForm]       = useState({ password: '', confirm: '' });
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError('');
    const { password, confirm } = form;
    if (!password) return setError('Please enter a new password.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');

    setSaving(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;

      const { error: dbError } = await clearMustChangePassword(userId);
      if (dbError) console.warn('clearMustChangePassword:', dbError.message);

      onDone();
    } catch (err) {
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
                placeholder="Min. 8 characters"
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
  const { profile, refreshProfile } = useAuth();

  const handlePasswordSet = async () => {
    await refreshProfile();
  };

  return (
    <div className="layout">
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
      <ToastContainer />

      {profile?.must_change_password && (
        <ForcePasswordChange
          userId={profile.id}
          onDone={handlePasswordSet}
        />
      )}
    </div>
  );
}
