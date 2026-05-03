import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { lookupOrgCode, employeeJoinWorkspace } from '@/services/tenantService';
import { signUp as otpSignUp, sendOtp, verifyOtp, detectIdentifierType } from '@/services/otpService';
import { useDebounce } from '@/hooks/useDebounce';
import {
  ErrorBanner, SuccessBanner,
  OtpInput, ResendTimer,
  OtpStepPanel,
} from '@/components/OtpVerification';

/* ─── Progress Steps indicator ─────────────────────────────────────────────── */

function StepIndicator({ current, steps }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, gap: 0 }}>
      {steps.map((label, i) => {
        const num    = i + 1;
        const done   = num < current;
        const active = num === current;
        return (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: done || active ? 'var(--primary)' : 'var(--bg)',
                color:      done || active ? '#fff'           : 'var(--text-muted)',
                border:     `2px solid ${done || active ? 'var(--primary)' : 'var(--border)'}`,
                transition: 'all .2s',
              }}>
                {done ? <i className="fas fa-check" style={{ fontSize: 11 }} /> : num}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: active ? 'var(--primary)' : 'var(--text-muted)' }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                height: 2, width: 40, marginBottom: 18,
                background: done ? 'var(--primary)' : 'var(--border)',
                transition: 'background .2s',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─── SUCCESS SCREEN ────────────────────────────────────────────────────────── */

function SuccessScreen({ mode, companyName, joinCode, onLogin }) {
  return (
    <div className="auth-container">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 56, color: 'var(--success)', marginBottom: 16 }}>
          <i className={`fas ${mode === 'admin' ? 'fa-building' : 'fa-user-check'}`} />
        </div>
        <h2 style={{ marginBottom: 8, fontSize: 22 }}>
          {mode === 'admin' ? 'Workspace Created!' : "You're In!"}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
          {mode === 'admin'
            ? <> Your company <strong>{companyName}</strong> is all set up.</>
            : <> You&apos;ve joined <strong>{companyName}</strong> successfully.</>}
        </p>

        {mode === 'admin' && joinCode && (
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Share this <strong>Organization Code</strong> with your employees:
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
              <button className="btn btn-outline btn-sm"
                onClick={() => navigator.clipboard.writeText(joinCode)}>
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

/* ─── ADMIN SIGNUP (Create Company) ─────────────────────────────────────────── */

function AdminSignupForm({ onSuccess }) {
  const { signUp } = useAuth();

  // Step 1 form state
  const [form, setForm] = useState({
    firstName: '', lastName: '', companyName: '',
    email: '', phone: '', password: '', confirmPassword: '',
  });
  const [step,      setStep]      = useState(1); // 1=form, 2=otp
  const [error,     setError]     = useState('');
  const [submitting,setSubmitting]= useState(false);

  // Step 2 OTP state
  const [otp,        setOtp]       = useState('');
  const [otpTarget,  setOtpTarget] = useState('');  // email or phone that got OTP
  const [otpType,    setOtpType]   = useState('email');
  const [successMsg, setSuccessMsg]= useState('');
  const [sending,    setSending]   = useState(false);
  const [verifying,  setVerifying] = useState(false);
  const [isNewUser,  setIsNewUser] = useState(false);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  // Always use email for OTP since phone is disabled in otpService
  const getOtpIdentifier = () => {
    return { identifier: form.email.trim().toLowerCase(), type: 'email' };
  };


  /* Step 1 → validate & send OTP */
  const handleStep1 = async (e) => {
    e.preventDefault();
    setError('');
    const { firstName, lastName, companyName, email, password, confirmPassword } = form;

    if (!firstName || !lastName || !companyName || !email || !password)
      return setError('Please fill in all required fields.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setError('Please enter a valid email address.');
    if (form.phone && detectIdentifierType(form.phone.trim()) !== 'phone')
      return setError('Please enter a valid 10-digit mobile number.');
    if (password.length < 6)
      return setError('Password must be at least 6 characters.');
    if (password !== confirmPassword)
      return setError('Passwords do not match.');

    setSending(true);
    try {
      const { identifier, type } = getOtpIdentifier();
      await sendOtp(identifier);
      setOtpTarget(identifier);
      setOtpType(type);
      setOtp('');
      setSuccessMsg(`OTP sent to ${identifier}. Check your inbox.`);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setSending(false);
    }
  };

  /* Resend OTP */
  const handleResend = async () => {
    setSending(true);
    setError('');
    try {
      const { identifier } = getOtpIdentifier();
      await sendOtp(identifier, { shouldCreateUser: true });
      setSuccessMsg('OTP resent successfully.');
    } catch (err) {
      setError(err.message || 'Failed to resend OTP.');
    } finally {
      setSending(false);
    }
  };

  /* Step 2 → verify OTP then create workspace */
  const handleVerifyAndCreate = async () => {
    if (otp.replace(/\D/g, '').length !== 6) {
      setError('Please enter the complete 6-digit OTP.'); return;
    }
    setError(''); setVerifying(true);
    try {
      // 1. Verify OTP + atomically create/confirm user with password → get real session
      const authData = await verifyOtp(
        otpTarget,
        otp.replace(/\D/g, ''),
        true,           // isSignup — edge function handles user creation
        form.password,
        form.firstName,
        form.lastName
      );

      const user = authData?.user;
      if (!user) throw new Error('Could not establish user session. Please try again.');

      // 2. Create workspace — user is guaranteed in auth.users with confirmed email
      const { data: joinCode, error: rpcError } = await supabase.rpc('create_workspace', {
        p_company_name: form.companyName,
        p_first_name:   form.firstName,
        p_last_name:    form.lastName,
        p_user_id:      user.id,
      });

      if (rpcError) {
        const msg = rpcError.message || '';
        if (msg.includes('already exists') || msg.includes('already registered')) {
          throw new Error('An account with this email already exists. Please sign in instead.');
        }
        throw new Error('Workspace setup failed: ' + msg);
      }

      onSuccess({ companyName: form.companyName, joinCode });
    } catch (err) {
      console.error('Signup Process Error:', err);
      // Show the raw message so we can see the debugging timestamps
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  // Auto-submit when all 6 digits filled
  useEffect(() => {
    if (step === 2 && otp.replace(/\D/g, '').length === 6 && !verifying)
      handleVerifyAndCreate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  /* ── Step 1: Registration form ── */
  if (step === 1) return (
    <form onSubmit={handleStep1} noValidate>
      <StepIndicator current={1} steps={['Details', 'Verify OTP', 'Done']} />
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
        <input className="form-input" placeholder="e.g. Acme Pvt Ltd" value={form.companyName} onChange={set('companyName')} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Work Email *</label>
          <input className="form-input" type="email" placeholder="you@company.com" value={form.email} onChange={set('email')} />
        </div>
        <div className="form-group">
          <label className="form-label">Mobile Number</label>
          <input className="form-input" type="tel" placeholder="9876543210" value={form.phone} onChange={set('phone')} />
          <div className="form-hint">OTP will be sent to your work email</div>

        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Password *</label>
          <input className="form-input" type="password" placeholder="Min 6 chars" value={form.password} onChange={set('password')} />
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

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={sending}>
        {sending
          ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Sending OTP…</>
          : <><i className="fas fa-paper-plane" /> Continue — Send OTP</>}
      </button>
    </form>
  );

  /* ── Step 2: OTP verification ── */
  return (
    <>
      <StepIndicator current={2} steps={['Details', 'Verify OTP', 'Done']} />
      <OtpStepPanel
        identifier={otpTarget}
        idType={otpType}
        otp={otp}
        onChange={setOtp}
        onVerify={handleVerifyAndCreate}
        onResend={handleResend}
        onBack={() => { setStep(1); setOtp(''); setError(''); setSuccessMsg(''); }}
        verifying={verifying}
        sending={sending}
        error={error}
        successMsg={successMsg}
      />
    </>
  );
}

/* ─── EMPLOYEE JOIN FORM ─────────────────────────────────────────────────────── */

function EmployeeJoinForm({ onSuccess }) {
  const [form, setForm] = useState({
    orgCode: '', firstName: '', lastName: '',
    email: '', phone: '', password: '', confirmPassword: '',
  });
  const [companyPreview, setCompanyPreview] = useState('');
  const [lookingUp,  setLookingUp]  = useState(false);
  const [step,       setStep]       = useState(1);
  const [error,      setError]      = useState('');
  const [sending,    setSending]    = useState(false);
  const [verifying,  setVerifying]  = useState(false);
  const [otp,        setOtp]        = useState('');
  const [otpTarget,  setOtpTarget]  = useState('');
  const [otpType,    setOtpType]    = useState('email');
  const [successMsg, setSuccessMsg] = useState('');
  const [isNewUser,  setIsNewUser]  = useState(false);

  const debouncedCode = useDebounce(form.orgCode, 500);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  // Live org code lookup
  const doLookup = useCallback(async (code) => {
    if (code.length < 4) { setCompanyPreview(''); return; }
    setLookingUp(true);
    const { companyName } = await lookupOrgCode(code);
    setCompanyPreview(companyName || '');
    setLookingUp(false);
  }, []);

  useEffect(() => { doLookup(debouncedCode); }, [debouncedCode, doLookup]);

  const getOtpIdentifier = () => {
    if (form.phone.trim() && detectIdentifierType(form.phone.trim()) === 'phone')
      return { identifier: form.phone.trim(), type: 'phone' };
    return { identifier: form.email.trim().toLowerCase(), type: 'email' };
  };

  /* Step 1 → validate & send OTP */
  const handleStep1 = async (e) => {
    e.preventDefault();
    setError('');
    const { orgCode, firstName, lastName, email, password, confirmPassword } = form;

    if (!orgCode || !firstName || !lastName || !email || !password)
      return setError('Please fill in all required fields.');
    if (!companyPreview)
      return setError('Invalid organization code. Please check with your manager.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setError('Please enter a valid email address.');
    if (form.phone && detectIdentifierType(form.phone.trim()) !== 'phone')
      return setError('Please enter a valid 10-digit mobile number.');
    if (password.length < 6)
      return setError('Password must be at least 6 characters.');
    if (password !== confirmPassword)
      return setError('Passwords do not match.');

    setSending(true);
    try {
      const { identifier } = getOtpIdentifier();
      await sendOtp(identifier);
      setOtpTarget(identifier);
      setOtpType('email');
      setOtp('');
      setSuccessMsg(`OTP sent to ${identifier}. Check your inbox.`);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setSending(false);
    }
  };

  /* Resend OTP */
  const handleResend = async () => {
    setSending(true); setError('');
    try {
      const { identifier } = getOtpIdentifier();
      await sendOtp(identifier, { shouldCreateUser: true });
      setSuccessMsg('OTP resent successfully.');
    } catch (err) {
      setError(err.message || 'Failed to resend OTP.');
    } finally { setSending(false); }
  };


  /* Step 2 → verify OTP then join workspace */
  const handleVerifyAndJoin = async () => {
    if (otp.replace(/\D/g, '').length !== 6) {
      setError('Please enter the complete 6-digit OTP.'); return;
    }
    setError(''); setVerifying(true);
    try {
      // 1. Verify OTP + atomically create/confirm user with password → get real session
      const authData = await verifyOtp(
        otpTarget,
        otp.replace(/\D/g, ''),
        true,           // isSignup — edge function handles user creation
        form.password,
        form.firstName,
        form.lastName
      );

      const user = authData?.user;
      if (!user) throw new Error('Could not establish user session. Please try again.');

      // 2. Join workspace — user is guaranteed in auth.users with confirmed email
      const { error: joinError } = await supabase.rpc('employee_join_workspace', {
        p_org_code:   form.orgCode,
        p_first_name: form.firstName,
        p_last_name:  form.lastName,
        p_user_id:    user.id,
      });

      if (joinError) throw new Error('Join failed: ' + joinError.message);

      onSuccess({ companyName: companyPreview, mode: 'employee' });
    } catch (err) {
      console.error('Join Process Error:', err);
      // Show the raw message so we can see the debugging timestamps
      setError(err.message || 'Verification failed. Please try again.');
    } finally { setVerifying(false); }
  };

  useEffect(() => {
    if (step === 2 && otp.replace(/\D/g, '').length === 6 && !verifying)
      handleVerifyAndJoin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  /* ── Step 1: Join form ── */
  if (step === 1) return (
    <form onSubmit={handleStep1} noValidate>
      <StepIndicator current={1} steps={['Details', 'Verify OTP', 'Done']} />
      <ErrorBanner message={error} />

      {/* Org code */}
      <div className="form-group">
        <label className="form-label">Organization Code *</label>
        <div style={{ position: 'relative' }}>
          <input className="form-input"
            placeholder="e.g. ABC123"
            value={form.orgCode}
            onChange={(e) => setForm((p) => ({ ...p, orgCode: e.target.value.toUpperCase() }))}
            maxLength={8} autoFocus
            style={{ textTransform: 'uppercase', letterSpacing: 3, fontFamily: 'monospace', fontWeight: 700 }}
          />
          {lookingUp && (
            <div className="spinner" style={{
              width: 14, height: 14, borderWidth: 2,
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            }} />
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
          <div className="form-hint">Ask your manager for the organization code.</div>
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

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Your Email *</label>
          <input className="form-input" type="email" placeholder="you@email.com" value={form.email} onChange={set('email')} />
        </div>
        <div className="form-group">
          <label className="form-label">Mobile Number</label>
          <input className="form-input" type="tel" placeholder="9876543210" value={form.phone} onChange={set('phone')} />
          <div className="form-hint">OTP will be sent to your email</div>

        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Password *</label>
          <input className="form-input" type="password" placeholder="Min 6 chars" value={form.password} onChange={set('password')} />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm Password *</label>
          <input className="form-input" type="password" placeholder="••••••••" value={form.confirmPassword} onChange={set('confirmPassword')} />
        </div>
      </div>

      <button type="submit" className="btn btn-primary btn-lg btn-block"
        disabled={sending || !companyPreview}>
        {sending
          ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Sending OTP…</>
          : <><i className="fas fa-paper-plane" /> Continue — Send OTP</>}
      </button>
    </form>
  );

  /* ── Step 2: OTP verification ── */
  return (
    <>
      <StepIndicator current={2} steps={['Details', 'Verify OTP', 'Done']} />
      <OtpStepPanel
        identifier={otpTarget}
        idType={otpType}
        otp={otp}
        onChange={setOtp}
        onVerify={handleVerifyAndJoin}
        onResend={handleResend}
        onBack={() => { setStep(1); setOtp(''); setError(''); setSuccessMsg(''); }}
        verifying={verifying}
        sending={sending}
        error={error}
        successMsg={successMsg}
      />
    </>
  );
}

/* ─── MAIN SIGNUP PAGE ───────────────────────────────────────────────────────── */

export default function SignupPage() {
  const [mode,        setMode]        = useState('admin');
  const [successData, setSuccessData] = useState(null);
  const navigate = useNavigate();

  if (successData) {
    return (
      <SuccessScreen
        mode={successData.mode || 'admin'}
        companyName={successData.companyName}
        joinCode={successData.joinCode}
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
        <div style={{
          display: 'flex', background: 'var(--bg)',
          borderRadius: 'var(--radius-md)', padding: 4, gap: 4, marginBottom: 20,
        }}>
          {[
            { key: 'admin',    icon: 'fa-building',      label: 'Create My Company' },
            { key: 'employee', icon: 'fa-user-friends',  label: 'Join My Company'   },
          ].map(({ key, icon, label }) => (
            <button key={key} type="button" onClick={() => setMode(key)} style={{
              flex: 1, padding: '9px 12px', borderRadius: 'var(--radius-sm)',
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: mode === key ? 'var(--surface)' : 'transparent',
              color:      mode === key ? 'var(--text)'    : 'var(--text-muted)',
              boxShadow:  mode === key ? 'var(--shadow-sm)' : 'none',
              transition: 'all .15s',
            }}>
              <i className={`fas ${icon}`} style={{ marginRight: 6 }} />{label}
            </button>
          ))}
        </div>

        <div className="auth-title" style={{ marginBottom: 20 }}>
          {mode === 'admin' ? (
            <><h2>Register Your Business</h2><p>Set up your company workspace in seconds</p></>
          ) : (
            <><h2>Join Your Company</h2><p>Enter the org code your manager shared</p></>
          )}
        </div>

        {mode === 'admin'
          ? <AdminSignupForm
              onSuccess={({ companyName, joinCode }) =>
                setSuccessData({ mode: 'admin', companyName, joinCode })}
            />
          : <EmployeeJoinForm
              onSuccess={({ companyName }) =>
                setSuccessData({ mode: 'employee', companyName })}
            />}

        <div className="auth-divider">or</div>
        <div className="auth-footer">
          Already have an account?{' '}
          <Link to="/login">Sign in here</Link>
        </div>

      </div>
    </div>
  );
}