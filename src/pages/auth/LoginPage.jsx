import React from 'react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import OtpVerificationModal from '@/components/OtpVerificationModal';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { signIn, signOut, user, profile, loading } = useAuth();
  const navigate = useNavigate();

  // OTP state
  const [otpPending, setOtpPending] = useState(false); // waiting for OTP verification
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpTarget, setOtpTarget] = useState('');

  // Redirect if already logged in, profile loaded, and OTP not pending
  useEffect(() => {
    if (!loading && user && profile && !otpPending) {
      const dest = profile.role === 'employee' ? '/my-dashboard' : '/dashboard';
      navigate(dest, { replace: true });
    }
  }, [user, profile, loading, navigate, otpPending]);

  // After OTP is verified and submitting is done, redirect when profile arrives
  useEffect(() => {
    if (user && profile && submitting === false && !otpPending) {
      const dest = profile.role === 'employee' ? '/my-dashboard' : '/dashboard';
      navigate(dest, { replace: true });
    }
  }, [profile, user, submitting, navigate, otpPending]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Please enter your email and password'); return; }

    setSubmitting(true);
    try {
      await signIn(email, password);

      // Credentials valid — now require OTP via SMS
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('email', email)
        .maybeSingle();

      if (!userProfile?.phone) {
        // No phone on file — cannot send OTP, sign out
        await signOut();
        setError('No phone number on your profile. Please contact your admin to add one.');
        setSubmitting(false);
        return;
      }

      setOtpTarget(userProfile.phone);
      setOtpPending(true);
      setShowOtpModal(true);
      setSubmitting(false);
    } catch (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Please try again.'
          : err.message || 'Login failed. Please try again.'
      );
      setSubmitting(false);
    }
  };

  const handleOtpVerified = () => {
    setShowOtpModal(false);
    setOtpPending(false);
    // The useEffect above will handle the redirect once otpPending is false
  };

  const handleOtpCancel = async () => {
    setShowOtpModal(false);
    setOtpPending(false);
    // Sign out the user since OTP was not verified
    await signOut();
    setError('Login cancelled. OTP verification is required.');
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: 'center', padding: '48px 36px' }}>
          <div className="auth-logo" style={{ marginBottom: 24 }}>
            <div className="logo-icon">P</div>
            <h1>PayrollPro</h1>
          </div>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading your workspace...</p>
        </div>
      </div>
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

        <div className="auth-title">
          <h2>Welcome back</h2>
          <p>Sign in to your company workspace</p>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: 'var(--danger-light)', color: 'var(--danger)',
            padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            fontSize: '13px', marginBottom: '16px',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <i className="fas fa-exclamation-circle" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input" type="email"
                placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                autoFocus autoComplete="email"
                style={{ paddingLeft: 38 }}
              />
              <i className="fas fa-envelope" style={{
                position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none',
              }} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ paddingLeft: 38, paddingRight: 42 }}
              />
              <i className="fas fa-lock" style={{
                position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none',
              }} />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute', right: 12, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 14, padding: 2,
                }}
              >
                <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={submitting}
            style={{ marginTop: 8, borderRadius: 12, fontSize: 14, letterSpacing: 0.2 }}
          >
            {submitting ? (
              <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Signing in...</>
            ) : (
              <><i className="fas fa-arrow-right-to-bracket" /> Sign In</>
            )}
          </button>
        </form>

        <div className="auth-divider">or</div>

        <div className="auth-footer">
          Don&apos;t have an account?{' '}
          <Link to="/signup">Register your company</Link>
        </div>

        {/* Trust badges */}
        <div className="auth-trust">
          <div className="auth-trust-item">
            <i className="fas fa-shield-halved" />
            Secure & Encrypted
          </div>
          <div className="auth-trust-item">
            <i className="fas fa-building" />
            Multi-tenant
          </div>
          <div className="auth-trust-item">
            <i className="fas fa-lock" />
            RLS Protected
          </div>
        </div>
      </div>

      <OtpVerificationModal
        show={showOtpModal}
        to={otpTarget}
        channel="sms"
        onVerified={handleOtpVerified}
        onCancel={handleOtpCancel}
      />
    </div>
  );
}
