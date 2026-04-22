import React from 'react';
import { Outlet } from 'react-router-dom';
import { ToastContainer } from '../components/Toast';

export default function AuthLayout() {
  return (
    <div className="auth-bg">
      {/* Decorative blobs */}
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      <div className="auth-blob auth-blob-3" />
      <div className="auth-layout-inner">
        <Outlet />
      </div>
      <ToastContainer />
    </div>
  );
}
