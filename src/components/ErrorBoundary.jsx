import React from 'react';

/**
 * Catches unhandled render/lifecycle errors anywhere in the subtree
 * and shows a friendly recovery screen instead of a blank page.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg)',
      }}>
        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          padding: 40, maxWidth: 480, width: '100%',
          boxShadow: 'var(--shadow-lg)', textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, color: 'var(--danger)', marginBottom: 16 }}>
            <i className="fas fa-exclamation-triangle" />
          </div>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
            {this.state.message}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              this.setState({ hasError: false, message: '' });
              window.location.href = '/';
            }}
          >
            <i className="fas fa-redo" /> Reload App
          </button>
        </div>
      </div>
    );
  }
}
