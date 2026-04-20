import React from 'react';
import { Outlet } from 'react-router-dom';
import { ToastContainer } from '../components/Toast';

export default function AuthLayout() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' }}>
      <Outlet />
      <ToastContainer />
    </div>
  );
}
