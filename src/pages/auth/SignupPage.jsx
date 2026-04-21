import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { lookupOrgCode, employeeJoinWorkspace } from '@/services/tenantService';
import { useDebounce } from '@/hooks/useDebounce';

// ─── shared helpers ──────────────────────────────────────────────────────────

function ErrorBanner({ message }) {
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

// ─── SUCCESS SCREEN ──────────────────────────────────────────────────────────

function SuccessScreen({ mode, companyName, joinCode, needsEmailConfirm, onLogin }) {
  return (
    <div className="auth-container">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 52, color: needsEmailConfirm ? 'var(--warning)' : 'var(--success)', marginBottom: 16 }}>
          <i className={`fas ${needsEmailConfirm ? 'fa-envelope' : mode === 'admin' ? 'fa-building' : 'fa-user-check'}`} />
        </div>
        <h2 style={{ marginBottom: 8, fontSize: 22 }}>
          {needsEmailConfirm ? 'Check Your Email!' : mode === 'admin' ? 'Workspace Created!' : 'You\'re In!'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
          {needsEmailConfirm
            ? <>We sent a confirmation link to your email. Click it to activate your account, then log in.</>
            : mode === 'admin'
              ? <>Your company <strong>{companyName}</strong> is all set up.</>
              : <>You've joined <strong>{companyName}</strong> successfully.</>}
        </p>

        {mode === 'admin' && joinCode && (
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Share this <strong>Organization Code</strong> with your employees so they can join:
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <span style={{
                fontSize: 28, fontWeight: 800, letterSpacing: 6,
                fontFamily: 'monospace', color: 'var(--primary)',
                background: 'var(--primary-light)', padding: '8px 20px',
                borderRadius: 'var(--radius-sm)',
              }}>
                {joinCode}
              </span>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => navigator.clipboard.writeText(joinCode)}
              >
                <i className="fas fa-copy" /> Copy
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              You can find this code anytime in <strong>Settings → Organization Code</strong>.
            </p>
          </div>
        )}

        <button className="btn btn-primary btn-block" onClick={onLogin}>
          <i className="fas fa-sign-in-alt" /> Go to Login
        </button>
      </div>
    </div>
  );
}

// ─── ADMIN (CREATE COMPANY) FORM ─────────────────────────────────────────────

function AdminSignupForm({ onSuccess }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', companyName: '', email: '', password: '', confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { signUp } = useAuth();

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError('');
    const { firstName, lastName, companyName, email, password, confirmPassword } = form;
    if (!firstName || !lastName || !companyName || !email || !password)
      return setError('Please fill in all fields.');
    if (password.length < 6)
      return setError('Password must be at least 6 characters.');
    if (password !== confirmPassword)
      return setError('Passwords do not match.');

    setSubmitting(true);
    try {
      const authData = await signUp(email, password);
      if (!authData?.user) throw new Error('Failed to create account. Please try again.');

      // Pass user.id explicitly so the RPC works even when email confirmation
      // is enabled (no session yet, so auth.uid() would be null inside the RPC).
      const { data: joinCode, error: rpcError } = await supabase.rpc('create_workspace', {
        p_company_name: companyName,
        p_first_name:   firstName,
        p_last_name:    lastName,
        p_user_id:      authData.user.id,
      });
      if (rpcError) throw new Error('Workspace setup failed: ' + rpcError.message);

      onSuccess({ companyName, joinCode, needsEmailConfirm: !authData.session });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <ErrorBanner message={error} />
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">First Name *</label>
          <input className="form-input" placeholder="John" value={form.firstName} onChange={set('firstName')} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Last Name *</label>
          <input className="form-input" placeholder="Doe" value={form.lastName} onChange={set('lastName')} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Company Name *</label>
        <input className="form-input" placeholder="e.g. Spice Garden Restaurant" value={form.companyName} onChange={set('companyName')} />
      </div>
      <div className="form-group">
        <label className="form-label">Work Email *</label>
        <input className="form-input" type="email" placeholder="john@yourcompany.com" value={form.email} onChange={set('email')} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Password *</label>
          <input className="form-input" type="password" placeholder="••••••••" value={form.password} onChange={set('password')} />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm Password *</label>
          <input className="form-input" type="password" placeholder="••••••••" value={form.confirmPassword} onChange={set('confirmPassword')} />
        </div>
      </div>
      <div className="form-hint" style={{ marginBottom: 16 }}>
        <i className="fas fa-shield-alt" style={{ color: 'var(--success)' }} />{' '}
        Your data is isolated — no other business can see your records.
      </div>
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting}>
        {submitting
          ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Setting up workspace…</>
          : <><i className="fas fa-building" /> Create Workspace</>}
      </button>
    </form>
  );
}

// ─── EMPLOYEE (JOIN COMPANY) FORM ────────────────────────────────────────────

function EmployeeJoinForm({ onSuccess }) {
  const [form, setForm] = useState({
    orgCode: '', firstName: '', lastName: '', email: '', password: '', confirmPassword: '',
  });
  const [companyPreview, setCompanyPreview] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const debouncedCode = useDebounce(form.orgCode, 500);

  // Live preview: look up company name as user types the org code
  const doLookup = useCallback(async (code) => {
    if (code.length < 4) { setCompanyPreview(''); return; }
    setLookingUp(true);
    const { companyName } = await lookupOrgCode(code);
    setCompanyPreview(companyName || '');
    setLookingUp(false);
  }, []);

  useEffect(() => { doLookup(debouncedCode); }, [debouncedCode, doLookup]);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError('');
    const { orgCode, firstName, lastName, email, password, confirmPassword } = form;
    if (!orgCode || !firstName || !lastName || !email || !password)
      return setError('Please fill in all fields.');
    if (!companyPreview)
      return setError('Invalid organization code. Please check with your manager.');
    if (password.length < 6)
      return setError('Password must be at least 6 characters.');
    if (password !== confirmPassword)
      return setError('Passwords do not match.');

    setSubmitting(true);
    try {
      // Create the Supabase auth account
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) throw authError;
      if (!authData?.user) throw new Error('Failed to create account. Please try again.');

      // Link to the workspace. Pass user.id explicitly so this works even when
      // email confirmation is enabled (session is null → auth.uid() is null in RPC).
      await employeeJoinWorkspace(orgCode, firstName, lastName, authData.user.id);

      onSuccess({ companyName: companyPreview, mode: 'employee', needsEmailConfirm: !authData.session });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <ErrorBanner message={error} />

      <div className="form-group">
        <label className="form-label">Organization Code *</label>
        <div style={{ position: 'relative' }}>
          <input
            className="form-input"
            placeholder="e.g. ABC123"
            value={form.orgCode}
            onChange={(e) => setForm((p) => ({ ...p, orgCode: e.target.value.toUpperCase() }))}
            maxLength={8}
            autoFocus
            style={{ textTransform: 'uppercase', letterSpacing: 3, fontFamily: 'monospace', fontWeight: 700 }}
          />
          {lookingUp && (
            <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} />
          )}
        </div>
        {companyPreview ? (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="fas fa-check-circle" /> Joining: <strong>{companyPreview}</strong>
          </div>
        ) : form.orgCode.length >= 4 && !lookingUp ? (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>
            <i className="fas fa-times-circle" /> Code not found. Check with your manager.
          </div>
        ) : (
          <div className="form-hint">Ask your manager for the 6-character org code.</div>
        )}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">First Name *</label>
          <input className="form-input" placeholder="John" value={form.firstName} onChange={set('firstName')} />
        </div>
        <div className="form-group">
          <label className="form-label">Last Name *</label>
          <input className="form-input" placeholder="Doe" value={form.lastName} onChange={set('lastName')} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Your Email *</label>
        <input className="form-input" type="email" placeholder="you@email.com" value={form.email} onChange={set('email')} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Password *</label>
          <input className="form-input" type="password" placeholder="••••••••" value={form.password} onChange={set('password')} />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm Password *</label>
          <input className="form-input" type="password" placeholder="••••••••" value={form.confirmPassword} onChange={set('confirmPassword')} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting || !companyPreview}>
        {submitting
          ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Joining…</>
          : <><i className="fas fa-user-plus" /> Join Workspace</>}
      </button>
    </form>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function SignupPage() {
  const [mode, setMode]         = useState('admin'); // 'admin' | 'employee'
  const [successData, setSuccessData] = useState(null);
  const navigate = useNavigate();

  if (successData) {
    return (
      <SuccessScreen
        mode={successData.mode || 'admin'}
        companyName={successData.companyName}
        joinCode={successData.joinCode}
        needsEmailConfirm={successData.needsEmailConfirm}
        onLogin={() => navigate('/login')}
      />
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="logo-icon">P</div>
          <h1>PayrollPro</h1>
          <span className="auth-tagline">Smart Payroll for Modern Teams</span>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 'var(--radius-md)', padding: 4, gap: 4, marginBottom: 24 }}>
          <button
            type="button"
            onClick={() => setMode('admin')}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 'var(--radius-sm)',
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: mode === 'admin' ? 'var(--surface)' : 'transparent',
              color: mode === 'admin' ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: mode === 'admin' ? 'var(--shadow-sm)' : 'none',
              transition: 'all .15s',
            }}
          >
            <i className="fas fa-building" style={{ marginRight: 6 }} />
            Create My Company
          </button>
          <button
            type="button"
            onClick={() => setMode('employee')}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 'var(--radius-sm)',
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: mode === 'employee' ? 'var(--surface)' : 'transparent',
              color: mode === 'employee' ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: mode === 'employee' ? 'var(--shadow-sm)' : 'none',
              transition: 'all .15s',
            }}
          >
            <i className="fas fa-user-friends" style={{ marginRight: 6 }} />
            Join My Company
          </button>
        </div>

        <div className="auth-title" style={{ marginBottom: 20 }}>
          {mode === 'admin' ? (
            <>
              <h2>Register Your Business</h2>
              <p>Set up your company workspace in seconds</p>
            </>
          ) : (
            <>
              <h2>Join Your Company</h2>
              <p>Enter the org code your manager shared with you</p>
            </>
          )}
        </div>

        {mode === 'admin' ? (
          <AdminSignupForm
            onSuccess={({ companyName, joinCode }) =>
              setSuccessData({ mode: 'admin', companyName, joinCode })}
          />
        ) : (
          <EmployeeJoinForm
            onSuccess={({ companyName }) =>
              setSuccessData({ mode: 'employee', companyName })}
          />
        )}

        <div className="auth-divider">or</div>
        <div className="auth-footer">
          Already have an account?{' '}
          <Link to="/login">Sign in here</Link>
        </div>
      </div>
    </div>
  );
}
