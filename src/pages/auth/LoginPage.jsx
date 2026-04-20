import React from 'react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Link } from 'react-router-dom';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { signIn, user, profile, loading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in and profile is loaded
  useEffect(() => {
    if (!loading && user && profile) {
      const dest = profile.role === 'employee' ? '/my-dashboard' : '/dashboard';
      navigate(dest, { replace: true });
    }
  }, [user, profile, loading, navigate]);

  // After signIn, profile loads async — redirect when it arrives
  useEffect(() => {
    if (user && profile && submitting === false) {
      const dest = profile.role === 'employee' ? '/my-dashboard' : '/dashboard';
      navigate(dest, { replace: true });
    }
  }, [profile, user, submitting, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Please enter your email and password'); return; }

    setSubmitting(true);
    try {
      await signIn(email, password);
      // Redirect is handled by useEffect above once profile loads
    } catch (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Please try again.'
          : err.message || 'Login failed. Please try again.'
      );
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</p>
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
            <input
              className="form-input" type="email"
              placeholder="you@company.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
              autoFocus autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: 42 }}
              />
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
            style={{ marginTop: 8 }}
          >
            {submitting ? (
              <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Signing in...</>
            ) : (
              <><i className="fas fa-sign-in-alt" /> Sign In</>
            )}
          </button>
        </form>

        <div className="auth-divider">or</div>

        <div className="auth-footer">
          Don&apos;t have an account?{' '}
          <Link to="/signup">Register your company</Link>
        </div>
      </div>
    </div>
  );
}
