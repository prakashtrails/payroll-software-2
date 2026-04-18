import React from 'react';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fmt, monthLabel } from '@/lib/helpers';

export default function EmployeeDashboard() {
  const { profile, tenant } = useAuth();
  const [stats, setStats] = useState({
    ctc: 0,
    presentDays: 0,
    outstandingAdvances: 0
  });

  useEffect(() => {
    if (!profile || !tenant) return;

    const fetchMyStats = async () => {
      try {
        // Fetch personal advances active
        const { data: myAdvances } = await supabase
          .from('advances')
          .select('balance')
          .eq('profile_id', profile.id)
          .eq('status', 'Active');
          
        const advancesTotal = myAdvances?.reduce((sum, adv) => sum + (adv.balance || 0), 0) || 0;

        // Note: For attendance, this is a simplified stub. In a full system, we query 'attendance'
        setStats({
          ctc: profile.ctc || 0,
          presentDays: 0, // Stubbed until attendance logic maps entries
          outstandingAdvances: advancesTotal
        });
      } catch (err) {
        console.error('Failed to load my stats:', err);
      }
    };

    fetchMyStats();
  }, [profile, tenant]);

  const now = new Date();
  const title = `Welcome back, ${profile?.first_name || 'User'}`;
  const breadcrumbName = `${monthLabel(now.getMonth(), now.getFullYear())} Stats`;

  return (
    <>
      <Header title={title} breadcrumb={breadcrumbName} />
      
      <div className="page-content">
        <div className="stats-row">
          <StatCard 
            icon="fa-wallet" 
            iconColor="green" 
            value={fmt(stats.ctc)} 
            label="Annual CTC" 
          />
          <StatCard 
            icon="fa-calendar-check" 
            iconColor="blue" 
            value={stats.presentDays} 
            label="Days Present this Month" 
          />
          <StatCard 
            icon="fa-hand-holding-usd" 
            iconColor="orange" 
            value={fmt(stats.outstandingAdvances)} 
            label="Active Loan Balance" 
          />
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header">
              <h3>Recent Announcements</h3>
            </div>
            <div className="card-body">
              <div className="empty-state">
                <i className="fas fa-bullhorn empty-icon" />
                <h3>No new announcements</h3>
                <p>Your team updates will appear here.</p>
              </div>
            </div>
          </div>
          
          <div className="card">
            <div className="card-header">
              <h3>Self Service</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: 12 }}>
                 <button className="btn btn-outline btn-block" style={{ justifyContent: 'left' }}>
                    <i className="fas fa-fingerprint" style={{ width: 24 }} /> Open Attendance Clock
                 </button>
                 <button className="btn btn-outline btn-block" style={{ justifyContent: 'left' }}>
                    <i className="fas fa-file-invoice-dollar" style={{ width: 24 }} /> View Latest Payslip
                 </button>
                 <button className="btn btn-outline btn-block" style={{ justifyContent: 'left' }}>
                    <i className="fas fa-hand-holding-usd" style={{ width: 24 }} /> Request Advance Salary
                 </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
