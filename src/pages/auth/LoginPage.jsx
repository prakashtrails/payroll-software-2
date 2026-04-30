import React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { detectIdentifierType } from '@/services/otpService';
import {
  ErrorBanner, SuccessBanner,
  OtpInput, ResendTimer,
  OtpStepPanel,
} from '@/components/OtpVerification';


/* ─── Inline style constants ──────────────────────────────────────────────── */

const ICON_STYLE = {
  position:'absolute',left:13,top:'50%',transform:'translateY(-50%)',
  color:'var(--text-muted)',fontSize:13,pointerEvents:'none',
};
const EYE_STYLE = {
  position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',
  background:'none',border:'none',cursor:'pointer',
  color:'var(--text-muted)',fontSize:14,padding:2,
};

/* ─── Password form ───────────────────────────────────────────────────────── */

function PasswordLoginForm({ onSuccess }) {
  const { signIn } = useAuth();
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [error, setError]           = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await signIn(email, password);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <ErrorBanner message={error} />
      <div className="form-group">
        <label className="form-label">Email Address</label>
        <div style={{position:'relative'}}>
          <input className="form-input" type="email"
            placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)}
            autoComplete="email" style={{paddingLeft:38}} />
          <i className="fas fa-envelope" style={ICON_STYLE} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Password</label>
        <div style={{position:'relative'}}>
          <input className="form-input" type={showPass?'text':'password'}
            placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)}
            autoComplete="current-password" style={{paddingLeft:38,paddingRight:42}} />
          <i className="fas fa-lock" style={ICON_STYLE} />
          <button type="button" onClick={()=>setShowPass(!showPass)} style={EYE_STYLE}>
            <i className={`fas ${showPass?'fa-eye-slash':'fa-eye'}`} />
          </button>
        </div>
      </div>
      <button type="submit" className="btn btn-primary btn-lg btn-block"
        disabled={submitting} style={{marginTop:8,borderRadius:12,fontSize:14}}>
        {submitting
          ? <><div className="spinner" style={{width:18,height:18,borderWidth:2}} /> Signing in…</>
          : <><i className="fas fa-arrow-right-to-bracket" /> Sign In</>}
      </button>
    </form>
  );
}

/* ─── OTP form ────────────────────────────────────────────────────────────── */

function OtpLoginForm({ onSuccess }) {
  const { sendOtp, verifyOtp } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [idType,     setIdType]     = useState(null);
  const [step,       setStep]       = useState(1);
  const [otp,        setOtp]        = useState('');
  const [resolvedId, setResolvedId] = useState('');

  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const [sending,    setSending]    = useState(false);
  const [verifying,  setVerifying]  = useState(false);

  const handleIdentifierChange = (e) => {
    const val = e.target.value;
    setIdentifier(val);
    setIdType(detectIdentifierType(val));
    setError('');
  };

  /* Step 1 */
  const handleSendOtp = useCallback(async (e) => {
    e?.preventDefault();
    setError(''); setSuccess('');
    if (!identifier.trim()) { setError('Please enter your email or mobile number.'); return; }
    if (!idType)             { setError('Please enter a valid email or mobile number.'); return; }
    setSending(true);
    try {
      const result = await sendOtp(identifier, { shouldCreateUser: true });
      setResolvedId(result.identifier);
      setOtp(''); setStep(2);
      setSuccess(result.type==='email'
        ? `OTP sent to ${result.identifier}. Check your inbox.`
        : `OTP sent to ${result.identifier} via SMS.`);
    } catch(err) {
      if (err.message?.includes('not found')||err.message?.includes('User not found'))
        setError('No account found. Please sign up first.');
      else if (err.message?.includes('rate'))
        setError('Too many attempts. Please wait and try again.');
      else
        setError(err.message||'Failed to send OTP. Please try again.');
    } finally { setSending(false); }
  }, [identifier, idType, sendOtp]);

  /* Step 2 */
  const handleVerifyOtp = useCallback(async (e) => {
    e?.preventDefault(); setError('');
    if (otp.replace(/\D/g,'').length!==6) { setError('Please enter the complete 6-digit OTP.'); return; }
    setVerifying(true);
    try {
      await verifyOtp(resolvedId, otp.replace(/\D/g,''), false); // false = not signup
      onSuccess();
    } catch(err) {
      if (err.message?.includes('expired')||err.message?.includes('Token has expired'))
        setError('OTP expired. Please request a new one.');
      else if (err.message?.includes('invalid'))
        setError('Incorrect OTP. Please try again.');
      else
        setError(err.message||'Verification failed. Please try again.');
    } finally { setVerifying(false); }
  }, [otp, resolvedId, idType, verifyOtp, onSuccess]);

  /* Auto-submit when all 6 digits are filled */
  useEffect(() => {
    if (step===2 && otp.replace(/\D/g,'').length===6 && !verifying) handleVerifyOtp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  /* ── Step 1 ── */
  if (step===1) return (
    <form onSubmit={handleSendOtp} noValidate>
      <ErrorBanner message={error} />
      <div className="form-group">
        <label className="form-label">Email or Mobile Number</label>
        <div style={{position:'relative'}}>
          <input className="form-input" type="text" inputMode="email"
            placeholder="you@company.com"
            value={identifier} onChange={handleIdentifierChange}
            autoFocus style={{paddingLeft:38,paddingRight:idType?80:12}} />
          <i className="fas fa-envelope" style={ICON_STYLE} />
          {idType && (
            <span style={{
              position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',
              fontSize:10,fontWeight:700,letterSpacing:0.5,
              background:'var(--primary-light)',color:'var(--primary)',
              padding:'2px 8px',borderRadius:99,
            }}>{idType==='email'?'EMAIL':'PHONE'}</span>
          )}
        </div>
        <div className="form-hint">We&apos;ll send a 6-digit OTP to your email.</div>
      </div>
      <button type="submit" className="btn btn-primary btn-lg btn-block"
        disabled={sending||!idType} style={{marginTop:8,borderRadius:12,fontSize:14}}>
        {sending
          ? <><div className="spinner" style={{width:18,height:18,borderWidth:2}} /> Sending OTP…</>
          : <><i className="fas fa-paper-plane" /> Send OTP</>}
      </button>
    </form>
  );

  /* ── Step 2 ── */
  return (
    <OtpStepPanel
      identifier={resolvedId}
      idType={idType}
      otp={otp}
      onChange={setOtp}
      onVerify={handleVerifyOtp}
      onResend={handleSendOtp}
      onBack={() => { setStep(1); setOtp(''); setError(''); setSuccess(''); }}
      verifying={verifying}
      sending={sending}
      error={error}
      successMsg={success}
    />
  );
}

/* ─── Main LoginPage ──────────────────────────────────────────────────────── */

export default function LoginPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [loginMode, setLoginMode] = useState('password');

  useEffect(() => {
    if (!loading && user && profile) {
      navigate(profile.role==='employee'?'/my-dashboard':'/dashboard', { replace:true });
    }
  }, [user, profile, loading, navigate]);

  // no-op: redirect fires automatically from useEffect above when profile loads
  const handleSuccess = useCallback(() => {}, []);

  if (loading) return (
    <div className="auth-container">
      <div className="auth-card" style={{textAlign:'center',padding:'48px 36px'}}>
        <div className="auth-logo" style={{marginBottom:24}}>
          <div className="logo-icon">P</div><h1>PayrollPro</h1>
        </div>
        <div className="spinner" style={{margin:'0 auto 16px'}} />
        <p style={{color:'var(--text-muted)',fontSize:13}}>Loading your workspace…</p>
      </div>
    </div>
  );

  return (
    <div className="auth-container">
      <div className="auth-card">

        {/* Logo */}
        <div className="auth-logo">
          <div className="logo-icon">P</div>
          <h1>PayrollPro</h1>
          <span className="auth-tagline">Smart Payroll for Modern Teams</span>
        </div>

        <div className="auth-title">
          <h2>Welcome back</h2>
          <p>Sign in to your company workspace</p>
        </div>

        {/* Mode toggle */}
        <div style={{
          display:'flex',background:'var(--bg)',
          borderRadius:'var(--radius-md)',padding:4,gap:4,marginBottom:24,
        }}>
          {[
            { key:'password', icon:'fa-lock',       label:'Password' },
            { key:'otp',      icon:'fa-mobile-alt', label:'OTP Login' },
          ].map(({key,icon,label}) => (
            <button key={key} type="button" onClick={()=>setLoginMode(key)}
              style={{
                flex:1,padding:'9px 12px',borderRadius:'var(--radius-sm)',
                border:'none',cursor:'pointer',fontSize:13,fontWeight:600,
                background:loginMode===key?'var(--surface)':'transparent',
                color:loginMode===key?'var(--text)':'var(--text-muted)',
                boxShadow:loginMode===key?'var(--shadow-sm)':'none',
                transition:'all .15s',
                display:'flex',alignItems:'center',justifyContent:'center',gap:7,
              }}>
              <i className={`fas ${icon}`} />{label}
            </button>
          ))}
        </div>

        {loginMode==='password'
          ? <PasswordLoginForm onSuccess={handleSuccess} />
          : <OtpLoginForm     onSuccess={handleSuccess} />}

        <div className="auth-divider">or</div>
        <div className="auth-footer">
          Don&apos;t have an account?{' '}
          <Link to="/signup">Register your company</Link>
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