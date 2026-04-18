import React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Link } from 'react-router-dom';

export default function SignupPage() {
  const [step, setStep] = useState(1); // 1=form, 2=success
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', companyName: '', email: '', password: '', confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) =>
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const validate = () => {
    const { firstName, lastName, companyName, email, password, confirmPassword } = formData;
    if (!firstName || !lastName || !companyName || !email || !password)
      return 'Please fill in all fields';
    if (password.length < 6)
      return 'Password must be at least 6 characters';
    if (password !== confirmPassword)
      return 'Passwords do not match';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setSubmitting(true);
    try {
      // Step 1: Create Supabase Auth user
      const authData = await signUp(formData.email, formData.password);
      if (!authData?.user) throw new Error('Failed to create account. Please try again.');

      // Step 2: Call the SECURITY DEFINER RPC to create tenant + profile atomically
      // This bypasses RLS safely on the server side
      const { data: rpcData, error: rpcError } = await supabase.rpc('create_workspace', {
        p_company_name: formData.companyName,
        p_first_name:   formData.firstName,
        p_last_name:    formData.lastName,
      });

      if (rpcError) {
        // If workspace creation fails, surface a clear message
        console.error('create_workspace RPC error:', rpcError);
        throw new Error('Workspace setup failed: ' + rpcError.message);
      }

      console.log('Workspace created:', rpcData);
      setStep(2);

      // Auto-redirect to login after 2.5 seconds
      setTimeout(() => navigate('/login'), 2500);

    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 2) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, color: 'var(--success)', marginBottom: 20 }}>
            <i className="fas fa-check-circle" />
          </div>
          <h2 style={{ marginBottom: 8, fontSize: 22 }}>Workspace Created!</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
            <strong>{formData.companyName}</strong> is all set up.<br />
            Your salary components and departments have been configured.
          </p>
          <div style={{
            background: 'var(--success-light)', color: 'var(--success)',
            padding: 12, borderRadius: 8, fontSize: 12, marginBottom: 20,
          }}>
            <i className="fas fa-info-circle" /> Redirecting to login in a moment...
          </div>
          <button className="btn btn-primary btn-block" onClick={() => navigate('/login')}>
            <i className="fas fa-sign-in-alt" /> Go to Login
          </button>
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
          <h2>Register Your Business</h2>
          <p>Create your company workspace in seconds</p>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            background: 'var(--danger-light)', color: 'var(--danger)',
            padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            fontSize: '13px', marginBottom: '16px',
            display: 'flex', alignItems: 'flex-start', gap: '8px',
          }}>
            <i className="fas fa-exclamation-circle" style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Name row */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">First Name *</label>
              <input
                className="form-input" name="firstName"
                placeholder="John" value={formData.firstName}
                onChange={handleChange} autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Last Name *</label>
              <input
                className="form-input" name="lastName"
                placeholder="Doe" value={formData.lastName}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Company / Restaurant Name *</label>
            <input
              className="form-input" name="companyName"
              placeholder="e.g. Spice Garden Restaurant"
              value={formData.companyName} onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Work Email *</label>
            <input
              className="form-input" type="email" name="email"
              placeholder="john@yourcompany.com"
              value={formData.email} onChange={handleChange}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Password *</label>
              <input
                className="form-input" type="password" name="password"
                placeholder="••••••••"
                value={formData.password} onChange={handleChange}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password *</label>
              <input
                className="form-input" type="password" name="confirmPassword"
                placeholder="••••••••"
                value={formData.confirmPassword} onChange={handleChange}
              />
            </div>
          </div>

          <div className="form-hint" style={{ marginBottom: 16 }}>
            <i className="fas fa-shield-alt" style={{ color: 'var(--success)' }} />
            {' '}Your data is isolated — no other business can see your records.
          </div>

          <button
            type="submit" className="btn btn-primary btn-lg btn-block"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                Setting up workspace...
              </>
            ) : (
              <><i className="fas fa-building" /> Create Workspace</>
            )}
          </button>
        </form>

        <div className="auth-divider">or</div>

        <div className="auth-footer">
          Already have an account?{' '}
          <Link to="/login">Sign in here</Link>
        </div>
      </div>
    </div>
  );
}
