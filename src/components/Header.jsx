import React from 'react';
import { useAuth } from '@/context/AuthContext';

export default function Header({ title, breadcrumb, actions }) {
  const { tenant } = useAuth();

  return (
    <header className="header">
      <div className="header-left">
        <div>
          <h1>{title}</h1>
          {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
        </div>
      </div>
      <div className="header-right">
        {actions}
      </div>
    </header>
  );
}
