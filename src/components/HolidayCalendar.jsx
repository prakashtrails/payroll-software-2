import React, { useState, useEffect, useRef } from 'react';
import { 
  fetchHolidays, 
  addHoliday, 
  deleteHoliday,
  fetchMyOptionalHolidays,
  addMyOptionalHoliday,
  removeMyOptionalHoliday
} from '@/services/holidayService';
import Modal from '@/components/Modal';

export default function HolidayCalendar({ tenantId, role, profileId }) {
  const fileInputRef = useRef(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [holidays, setHolidays] = useState([]);
  const [myOptionalHolidays, setMyOptionalHolidays] = useState([]); // List of { id, holiday_id }
  const [loading, setLoading] = useState(true);
  const [dbMissing, setDbMissing] = useState(false);

  // Add holiday modal
  const [showModal, setShowModal] = useState(false);
  const [newHoliday, setNewHoliday] = useState({ name: '', date: '', type: 'Public Holiday' });
  const [saving, setSaving] = useState(false);

  // Import CSV modal
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    loadHolidays();
  }, [currentDate, tenantId, profileId]);

  const loadHolidays = async () => {
    if (!tenantId) return;
    setLoading(true);
    setDbMissing(false);
    
    const year = currentDate.getFullYear();
    const { data, error } = await fetchHolidays(tenantId, year);
    if (error) {
      if (error.code === '42P01') { // undefined_table
        setDbMissing(true);
      }
      setHolidays([]);
    } else {
      setHolidays(data || []);
      
      // If we have profileId, fetch their optional holidays
      if (profileId) {
        const optRes = await fetchMyOptionalHolidays(profileId);
        if (!optRes.error) {
          setMyOptionalHolidays(optRes.data);
        }
      }
    }
    setLoading(false);
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleAddHoliday = async (e) => {
    e.preventDefault();
    if (!newHoliday.name || !newHoliday.date) return;
    setSaving(true);
    const { data, error } = await addHoliday(tenantId, newHoliday.name, newHoliday.date, newHoliday.type);
    if (!error && data) {
      setHolidays([...holidays, data]);
      setShowModal(false);
      setNewHoliday({ name: '', date: '', type: 'Public Holiday' });
    } else {
      alert('Failed to add holiday. Please make sure the database migration is applied.');
    }
    setSaving(false);
  };

  const handleDeleteHoliday = async (id) => {
    if (!window.confirm('Remove this holiday?')) return;
    const { error } = await deleteHoliday(id);
    if (!error) {
      setHolidays(holidays.filter(h => h.id !== id));
      setMyOptionalHolidays(myOptionalHolidays.filter(oh => oh.holiday_id !== id));
    }
  };

  const handleToggleOptional = async (holidayId) => {
    if (!profileId) return;
    
    const existing = myOptionalHolidays.find(oh => oh.holiday_id === holidayId);
    if (existing) {
      // Remove
      if (!window.confirm('Deselect this optional holiday?')) return;
      const { error } = await removeMyOptionalHoliday(existing.id);
      if (!error) {
        setMyOptionalHolidays(myOptionalHolidays.filter(oh => oh.id !== existing.id));
      }
    } else {
      // Add
      if (myOptionalHolidays.length >= 5) {
        alert('You have already selected 5 optional holidays for this year.');
        return;
      }
      if (!window.confirm('Select this as one of your 5 optional holidays?')) return;
      const { data, error } = await addMyOptionalHoliday(tenantId, profileId, holidayId);
      if (!error && data) {
        setMyOptionalHolidays([...myOptionalHolidays, data]);
      }
    }
  };

  const exportCalendarCSV = () => {
    if (!holidays.length) {
      alert('No holidays to export.');
      return;
    }
    
    const headers = ['Holiday Name', 'Date', 'Type'];
    const rows = holidays.map(h => [
      `"${h.name}"`, 
      h.date, 
      `"${h.type}"`
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `holidays_${currentDate.getFullYear()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportCSV = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n');
      
      // Basic CSV parser (assumes simple CSV without commas inside values)
      // Expected format: Name, Date, Type
      // Skipping header line (index 0)
      
      let importedCount = 0;
      setLoading(true);

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Handle basic quoted values or split by comma
        const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
        if (parts && parts.length >= 2) {
          const name = parts[0].replace(/^"|"$/g, '').trim();
          const date = parts[1].replace(/^"|"$/g, '').trim();
          const type = parts[2] ? parts[2].replace(/^"|"$/g, '').trim() : 'Public Holiday';
          
          if (name && date) {
            // Check if already exists to avoid duplicates
            const existing = holidays.find(h => h.date === date && h.name === name);
            if (!existing) {
               await addHoliday(tenantId, name, date, type);
               importedCount++;
            }
          }
        }
      }
      
      if (importedCount > 0) {
        alert(`Successfully imported ${importedCount} holidays.`);
        setShowImportModal(false);
        loadHolidays(); // reload
      } else {
        alert('No new holidays imported. They might already exist or the CSV format is incorrect.');
      }
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const downloadSampleCSV = () => {
    const csvContent = "Holiday Name,Date,Type\nNew Year's Day,2026-01-01,Public Holiday\nCompany Anniversary,2026-05-15,Company Holiday\nDiwali,2026-11-08,Optional Holiday";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_holidays.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Header
    const calendarHeaders = weekDays.map(wd => (
      <div key={wd} className="calendar-header-day">
        {wd}
      </div>
    ));

    // Blanks
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`blank-${i}`} />);
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isHoliday = holidays.find(h => h.date === dateStr);
      const isToday = new Date().toDateString() === new Date(year, month, d).toDateString();
      
      let isSelectedOptional = false;
      if (isHoliday) {
        isSelectedOptional = myOptionalHolidays.some(oh => oh.holiday_id === isHoliday.id);
      }

      let classNames = ['calendar-day'];
      if (isToday) classNames.push('today');
      if (isHoliday) classNames.push('holiday');
      
      // Visual indicator if selected optional holiday
      let borderStyle = {};
      if (isSelectedOptional) {
        borderStyle = { border: '2px solid var(--success)', background: 'var(--success-light)', color: 'var(--success)' };
      }

      days.push(
        <div key={d} title={isHoliday?.name || ''} className={classNames.join(' ')} style={borderStyle}>
          {d}
          {isHoliday && <div className="holiday-dot" style={isSelectedOptional ? { background: 'var(--success)'} : {}} />}
        </div>
      );
    }

    return (
      <div className="calendar-grid">
        {calendarHeaders}
        {days}
      </div>
    );
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  
  // Filter holidays for the current month view to show in a list
  const currentMonthHolidays = holidays.filter(h => {
    const hd = new Date(h.date);
    return hd.getFullYear() === currentDate.getFullYear() && hd.getMonth() === currentDate.getMonth();
  }).sort((a, b) => new Date(a.date) - new Date(b.date));

  return (
    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>Holiday Calendar</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {['admin', 'manager', 'superadmin'].includes(role) && (
            <button className="btn btn-icon btn-outline btn-sm" onClick={() => setShowImportModal(true)} title="Import CSV">
              <i className="fas fa-file-import"></i>
            </button>
          )}
          <button className="btn btn-icon btn-outline btn-sm" onClick={exportCalendarCSV} title="Export CSV">
            <i className="fas fa-file-export"></i>
          </button>
          <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 4px' }} />
          <button className="btn btn-icon btn-outline" onClick={handlePrevMonth}><i className="fas fa-chevron-left"></i></button>
          <span style={{ fontSize: '14px', fontWeight: 'bold', width: '110px', textAlign: 'center' }}>{monthName}</span>
          <button className="btn btn-icon btn-outline" onClick={handleNextMonth}><i className="fas fa-chevron-right"></i></button>
        </div>
      </div>
      
      <div className="card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {dbMissing ? (
          <div style={{ padding: '20px', textAlign: 'center', backgroundColor: 'var(--warning-light)', color: 'var(--warning)', borderRadius: 'var(--radius-md)', fontSize: '13px' }}>
            <i className="fas fa-exclamation-triangle" style={{ fontSize: '20px', marginBottom: '8px' }}></i>
            <p><strong>Holidays table missing.</strong></p>
            <p>Please run the database migration to enable this feature.</p>
          </div>
        ) : (
          <>
            <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)' }}>
              {renderCalendar()}
              
              {profileId && (
                <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span><span style={{ display: 'inline-block', width: '8px', height: '8px', background: 'var(--success)', borderRadius: '50%', marginRight: '4px' }}></span> Optional holidays</span>
                  <span style={{ fontWeight: 'bold' }}>{myOptionalHolidays.length} / 5 Selected</span>
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '14px', margin: 0, fontWeight: 600 }}>Holidays in {currentDate.toLocaleString('default', { month: 'long' })}</h4>
                {['admin', 'manager', 'superadmin'].includes(role) && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
                    <i className="fas fa-plus"></i> Add
                  </button>
                )}
              </div>
              
              {loading ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                  <i className="fas fa-spinner fa-spin" style={{ marginBottom: '8px', fontSize: '20px' }}></i>
                  <div>Loading...</div>
                </div>
              ) : currentMonthHolidays.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '13px', backgroundColor: 'var(--surface-hover)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)' }}>
                  No holidays this month.
                </div>
              ) : (
                <div className="holiday-list">
                  {currentMonthHolidays.map(h => {
                    const isOptional = h.type === 'Optional Holiday' || h.type === 'Restricted Holiday';
                    const isSelected = myOptionalHolidays.some(oh => oh.holiday_id === h.id);
                    
                    return (
                      <div key={h.id} className="holiday-list-item" style={isSelected ? { borderColor: 'var(--success)' } : {}}>
                        <div className="holiday-info">
                          <div className="holiday-name">{h.name}</div>
                          <div className="holiday-meta">
                            {h.type}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div className="holiday-date" style={isSelected ? { background: 'var(--success-light)', color: 'var(--success)' } : {}}>
                            {new Date(h.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </div>
                          
                          {/* Toggle optional holiday for employees */}
                          {isOptional && profileId && (
                            <button 
                              className={`btn btn-sm ${isSelected ? 'btn-success' : 'btn-outline'}`} 
                              onClick={() => handleToggleOptional(h.id)}
                            >
                              {isSelected ? <><i className="fas fa-check"></i> Selected</> : 'Select'}
                            </button>
                          )}

                          {['admin', 'manager', 'superadmin'].includes(role) && (
                            <button className="btn btn-icon" style={{ color: 'var(--text-muted)', width: '28px', height: '28px' }} onClick={() => handleDeleteHoliday(h.id)} title="Delete holiday">
                              <i className="fas fa-trash-alt"></i>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Modal show={showModal} title="Add Holiday" onClose={() => setShowModal(false)}>
        <form onSubmit={handleAddHoliday}>
          <div className="form-group">
            <label className="form-label">Holiday Name</label>
            <input 
              type="text" 
              className="form-input" 
              value={newHoliday.name} 
              onChange={(e) => setNewHoliday({...newHoliday, name: e.target.value})} 
              placeholder="e.g. Diwali, Christmas, Independence Day"
              required 
            />
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input 
              type="date" 
              className="form-input" 
              value={newHoliday.date} 
              onChange={(e) => setNewHoliday({...newHoliday, date: e.target.value})} 
              required 
            />
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select 
              className="form-select" 
              value={newHoliday.type} 
              onChange={(e) => setNewHoliday({...newHoliday, type: e.target.value})}
            >
              <option value="Public Holiday">Public Holiday</option>
              <option value="Optional Holiday">Optional Holiday</option>
              <option value="Company Holiday">Company Holiday</option>
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Adding...' : 'Add Holiday'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal show={showImportModal} title="Import Holidays via CSV" onClose={() => setShowImportModal(false)}>
        <div style={{ padding: '10px 0' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Instructions:</h4>
          <ul style={{ fontSize: '13px', color: 'var(--text-secondary)', paddingLeft: '20px', marginBottom: '20px', lineHeight: '1.6' }}>
            <li>Upload a CSV file containing your company holidays.</li>
            <li>The first row must be the header: <code>Holiday Name,Date,Type</code></li>
            <li><strong>Date format:</strong> YYYY-MM-DD (e.g., 2026-12-25)</li>
            <li><strong>Type:</strong> <code>Public Holiday</code>, <code>Optional Holiday</code>, or <code>Company Holiday</code></li>
          </ul>
          
          <div style={{ background: 'var(--surface-hover)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>Download a sample file to get started</span>
              <button className="btn btn-outline btn-sm" onClick={downloadSampleCSV}>
                <i className="fas fa-download"></i> Sample CSV
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-outline" onClick={() => setShowImportModal(false)}>Cancel</button>
            
            <input 
              type="file" 
              accept=".csv" 
              style={{ display: 'none' }} 
              ref={fileInputRef} 
              onChange={handleImportCSV} 
            />
            <button 
              className="btn btn-primary" 
              onClick={() => fileInputRef.current?.click()} 
              disabled={loading}
            >
              {loading ? 'Importing...' : 'Select CSV & Import'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
