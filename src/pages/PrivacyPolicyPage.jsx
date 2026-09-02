import React from 'react';
import { Link } from 'react-router-dom';
import './PrivacyPolicyPage.css';

const LAST_UPDATED = 'August 31, 2026';
const SUPPORT_EMAIL = 'crewcoreadmin@gmail.com';

export default function PrivacyPolicyPage() {
  return (
    <div className="privacy-page">
      <div className="privacy-container">
        <Link to="/" className="privacy-back">&larr; Back to CrewCore</Link>

        <h1>Privacy Policy</h1>
        <p className="privacy-updated">Last updated: {LAST_UPDATED}</p>

        <p>
          CrewCore ("we", "our", "us") provides an HR and payroll platform, including
          the CrewCore mobile app, used by organizations to manage their employees.
          This policy explains what information CrewCore collects, how it's used, and
          the choices available to employees and administrators.
        </p>

        <h2>Who this applies to</h2>
        <p>
          CrewCore is provided to organizations ("Employers") for use by their staff.
          If you're an employee using CrewCore, your Employer controls the account and
          determines what employee data is entered into the system. CrewCore acts as
          the Employer's data processor for that information.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Contact &amp; identity information</strong> — name, email address,
            phone number, and physical/home address, used to identify your account and
            enable HR communication.
          </li>
          <li>
            <strong>Employment information</strong> — department, designation, shift
            details, attendance records, leave requests, performance reviews, KRAs,
            and other HR content your Employer records about you.
          </li>
          <li>
            <strong>Payment &amp; financial information</strong> — bank account and
            salary details, used solely to generate and deliver payslips and process
            payroll.
          </li>
          <li>
            <strong>Location information</strong> — when you clock in or out of
            attendance in the mobile app, we collect your device's precise or
            approximate location at that moment, to verify you were at an authorized
            location. Location is not collected or used at any other time.
          </li>
          <li>
            <strong>Account identifiers</strong> — a unique user ID used internally to
            link your activity to your employee record.
          </li>
          <li>
            <strong>Usage information</strong> — basic interaction data (e.g. which
            screens are used) to keep the app functioning correctly and to fix bugs.
          </li>
        </ul>

        <h2>How we use this information</h2>
        <p>We use the information above only to operate the CrewCore platform for your Employer, specifically to:</p>
        <ul>
          <li>Authenticate your account and secure access to your data</li>
          <li>Record and verify attendance, leave, and work hours</li>
          <li>Calculate and deliver payroll and payslips</li>
          <li>Support HR workflows such as requests, approvals, and performance reviews</li>
          <li>Send you notices, announcements, and notifications from your Employer</li>
          <li>Diagnose and fix technical issues</li>
        </ul>
        <p>
          We do <strong>not</strong> sell your data, use it for third-party advertising,
          or use it to track you across other companies' apps or websites.
        </p>

        <h2>Who we share information with</h2>
        <p>
          Information is visible to your Employer's authorized HR/admin users as part
          of normal HR operations. We use trusted infrastructure providers (such as our
          database and notification providers) strictly to operate the service on our
          behalf, under confidentiality obligations. We do not share your data with
          data brokers or advertising networks.
        </p>

        <h2>Data retention</h2>
        <p>
          We retain employee data for as long as your Employer's account remains
          active, and afterwards only as needed to comply with legal, tax, or
          record-keeping obligations. Your Employer can request deletion of your data
          subject to these obligations.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>Location access for attendance can be managed in your device's app permissions.</li>
          <li>Notification preferences can be managed in your device's notification settings.</li>
          <li>To review, correct, or request deletion of your data, contact your Employer's HR administrator, or reach us directly (below).</li>
        </ul>

        <h2>Security</h2>
        <p>
          We use industry-standard encryption in transit and access controls to
          protect your information. No system is perfectly secure, but we take
          reasonable steps to safeguard your data against unauthorized access.
        </p>

        <h2>Children's privacy</h2>
        <p>
          CrewCore is a workplace tool intended for use by employees and is not
          directed at children. We do not knowingly collect data from anyone under the
          age required to be employed in their jurisdiction.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We may update this policy from time to time. Material changes will be
          reflected by updating the "Last updated" date above.
        </p>

        <h2>Contact us</h2>
        <p>
          Questions about this policy or your data can be sent to{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </div>
    </div>
  );
}
