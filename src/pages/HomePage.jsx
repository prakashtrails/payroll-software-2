import React from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import './HomePage.css';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="homepage">
      {/* Navigation */}
      <nav className="navbar">
        <div className="container">
          <div className="navbar-content">
            <div className="logo">
              <img src="/logo.png" alt="CrewCore" />
              <span>CrewCore</span>
            </div>
            <div className="nav-buttons">
              <button className="btn-secondary" onClick={() => navigate('/login')}>
                Sign In
              </button>
              <button className="btn-primary" onClick={() => navigate('/signup')}>
                Register Company
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="container">
          <div className="hero-content">
            <div className="hero-text">
              <h1>Workforce &amp; Payroll, Made Simple</h1>
              <p>
                CrewCore brings your team, attendance, leaves, and payroll together in one
                intuitive platform — built for modern, fast-moving businesses.
              </p>
              <div className="hero-buttons">
                <button className="btn-primary btn-lg" onClick={() => navigate('/signup')}>
                  Register Your Company
                </button>
                <button className="btn-outline btn-lg" onClick={() => navigate('/login')}>
                  Sign In
                </button>
              </div>
            </div>
            <div className="hero-visual">
              <div className="dashboard-preview">
                <div className="preview-header">
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <div className="dot"></div>
                </div>
                <div className="preview-content">
                  <div className="chart-placeholder">
                    <i className="fas fa-chart-bar"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features">
        <div className="container">
          <div className="section-header">
            <h2>Powerful Features for Your Team</h2>
            <p>Everything you need to manage payroll efficiently</p>
          </div>
          
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-users"></i>
              </div>
              <h3>Employee Management</h3>
              <p>Organize and manage all employee information in one centralized system</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-clock"></i>
              </div>
              <h3>Attendance Tracking</h3>
              <p>Track attendance and time off with automated, real-time logging</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-calendar-alt"></i>
              </div>
              <h3>Leave Management</h3>
              <p>Handle leave requests and approvals seamlessly with our workflow</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-money-bill"></i>
              </div>
              <h3>Salary Management</h3>
              <p>Process salaries accurately and generate payslips automatically</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-receipt"></i>
              </div>
              <h3>Payroll Processing</h3>
              <p>Automate payroll calculations with customizable policies</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-file-invoice"></i>
              </div>
              <h3>Payslip Generation</h3>
              <p>Generate and distribute digital payslips instantly to employees</p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="benefits">
        <div className="container">
          <div className="benefits-content">
            <div className="benefits-text">
              <h2>Why Choose CrewCore?</h2>
              <ul className="benefits-list">
                <li>
                  <span className="check"><i className="fas fa-check"></i></span>
                  <span>Multi-tenant architecture for complete data isolation</span>
                </li>
                <li>
                  <span className="check"><i className="fas fa-check"></i></span>
                  <span>Role-based access control for security</span>
                </li>
                <li>
                  <span className="check"><i className="fas fa-check"></i></span>
                  <span>Intuitive dashboard with real-time insights</span>
                </li>
                <li>
                  <span className="check"><i className="fas fa-check"></i></span>
                  <span>Automated workflows to save time</span>
                </li>
                <li>
                  <span className="check"><i className="fas fa-check"></i></span>
                  <span>Comprehensive reporting and analytics</span>
                </li>
                <li>
                  <span className="check"><i className="fas fa-check"></i></span>
                  <span>24/7 reliable service with cloud infrastructure</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile App Section */}
      <section className="app-download">
        <div className="container">
          <div className="app-download-content">
            <div className="app-download-text">
              <h2>Take CrewCore With You</h2>
              <p>
                Clock in, check payslips, and manage leave requests on the go with the
                CrewCore mobile app — free to download on the Google Play Store.
              </p>
              <a
                className="play-badge"
                href="https://play.google.com/store/apps/details?id=com.crewcore.app"
                target="_blank"
                rel="noopener noreferrer"
              >
                <i className="fab fa-google-play"></i>
                <span>
                  <small>GET IT ON</small>
                  Google Play
                </span>
              </a>
            </div>
            <div className="app-download-qr">
              <QRCodeSVG
                value="https://play.google.com/store/apps/details?id=com.crewcore.app"
                size={168}
                bgColor="#ffffff"
                fgColor="#1E293B"
                level="M"
              />
              <p>Scan to download</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta">
        <div className="container">
          <div className="cta-content">
            <h2>Ready to Transform Your Payroll?</h2>
            <p>Join hundreds of businesses managing their payroll with CrewCore</p>
            <button className="btn-primary btn-lg" onClick={() => navigate('/signup')}>
              Register Your Company Today
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <div className="footer-content">
            <div className="footer-section">
              <h4>CrewCore</h4>
              <p>Modern payroll management for the digital age</p>
            </div>
            <div className="footer-section">
              <h4>Product</h4>
              <ul>
                <li><a href="#features">Features</a></li>
                <li><a href="#pricing">Pricing</a></li>
              </ul>
            </div>
            <div className="footer-section">
              <h4>Company</h4>
              <ul>
                <li><a href="#about">About</a></li>
                <li><a href="#contact">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <p>&copy; 2026 CrewCore. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
