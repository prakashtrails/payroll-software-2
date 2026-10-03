import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ERP_MODULES, SUPPORT_EMAIL } from '@/lib/siteContent';
import './HomePage.css';

// Public "Coming soon" page for CrewCore ERP (pending-list item 6). No form or
// database writes: "Notify me" opens an email to the CrewCore team.

const NOTIFY_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('CrewCore ERP — early access')}&body=${encodeURIComponent(
  'Hi CrewCore team,\n\nPlease notify me when CrewCore ERP is available.\n\nCompany:\nNumber of employees:\nModules we need (inventory / purchase / invoicing / accounts / CRM):\nPhone:\n',
)}`;

export default function ErpPage() {
  const navigate = useNavigate();
  useEffect(() => { document.title = 'CrewCore ERP — Coming soon'; }, []);

  return (
    <div className="homepage">
      <nav className="navbar">
        <div className="container">
          <div className="navbar-content">
            <div className="navbar-left">
              <div className="logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
                <img src="/logo.png" alt="CrewCore" />
                <span>CrewCore</span>
              </div>
            </div>
            <div className="nav-buttons">
              <button className="btn-secondary" onClick={() => navigate('/login')}>Sign In</button>
              <button className="btn-primary" onClick={() => navigate('/signup')}>Register Company</button>
            </div>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="container">
          <div className="hero-inner">
            <span className="eyebrow">Coming soon</span>
            <h1>
              CrewCore ERP.<br />
              <span className="accent">Your whole business, one system.</span>
            </h1>
            <p>
              Inventory, purchase, GST invoicing, accounts and CRM — built on the same platform as
              your HR and payroll, so people costs, stock and sales finally live in one place.
            </p>
            <div className="hero-buttons">
              <a className="btn-primary btn-lg" href={NOTIFY_HREF}><i className="fas fa-bell" style={{ marginRight: 8 }} />Notify me at launch</a>
              <button className="btn-outline btn-lg" onClick={() => navigate('/')}>Explore CrewCore HR</button>
            </div>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="container">
          <div className="section-header">
            <h2>What's planned</h2>
            <p>Modules are being built in this order; early-access companies help shape them</p>
          </div>
          <div className="features-grid">
            {ERP_MODULES.map((m, i) => (
              <div className="feature-card" key={m.title}>
                <span className="feature-index">{String(i + 1).padStart(2, '0')}</span>
                <i className={`fas ${m.icon} feature-icon`}></i>
                <h3>{m.title}</h3>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="container">
          <div className="cta-content">
            <h2>Want early access?</h2>
            <p>Tell us your company size and the modules you need — we'll reach out before launch.</p>
            <a className="btn-primary btn-lg" href={NOTIFY_HREF}>Email the CrewCore team</a>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="footer-bottom">
            <p>&copy; 2026 CrewCore. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
