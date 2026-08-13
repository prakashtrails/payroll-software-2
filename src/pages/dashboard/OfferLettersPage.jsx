import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listAllReferrals, listLetterTemplates, saveLetterTemplate, deleteLetterTemplate,
  listOfferLetters, createOfferLetter, updateOfferLetterStatus, renderLetter,
} from '@/services/hiringService';
import { fmt, fmt as fmtDate } from '@/lib/helpers';

const DEFAULT_TEMPLATE_BODY = `<h2>Offer of Employment</h2>
<p>Dear {{candidate_name}},</p>
<p>We are pleased to offer you the position of <strong>{{designation}}</strong> at {{company_name}}, with a CTC of {{ctc}} per annum, joining on {{joining_date}}.</p>
<p>Please confirm your acceptance at your earliest convenience.</p>
<p>Regards,<br/>{{company_name}} HR</p>`;

const STATUS_BADGE = { Draft: 'badge-secondary', Sent: 'badge-info', Accepted: 'badge-success', Declined: 'badge-danger' };

export default function OfferLettersPage() {
  const { tenant } = useAuth();
  const [tab, setTab] = useState('letters');
  const [letters, setLetters]     = useState([]);
  const [templates, setTemplates] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showLetterModal, setShowLetterModal] = useState(false);
  const [letterForm, setLetterForm] = useState({ referral_id: '', template_id: '', designation: '', ctc_offered: '', joining_date: '' });
  const [showTplModal, setShowTplModal] = useState(false);
  const [tplForm, setTplForm] = useState({ type: 'Offer', name: '', body_html: DEFAULT_TEMPLATE_BODY });
  const [printLetter, setPrintLetter] = useState(null);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [letRes, tplRes, refRes] = await Promise.all([
        listOfferLetters(tenant.id), listLetterTemplates(tenant.id), listAllReferrals(tenant.id),
      ]);
      setLetters(letRes.data);
      setTemplates(tplRes.data);
      setReferrals(refRes.data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateLetter = async () => {
    if (!letterForm.referral_id) return showToast('Select a candidate', 'error');
    const referral = referrals.find((r) => r.id === letterForm.referral_id);
    const template = templates.find((t) => t.id === letterForm.template_id);
    const rendered = template ? renderLetter(template.body_html, {
      candidate_name: referral?.candidate_name, designation: letterForm.designation,
      company_name: tenant.company_name, ctc: fmt(letterForm.ctc_offered), joining_date: letterForm.joining_date,
    }) : '';
    const { error } = await createOfferLetter(tenant.id, tenant.id, { ...letterForm, rendered_html: rendered });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Offer letter created', 'success');
    setShowLetterModal(false);
    setLetterForm({ referral_id: '', template_id: '', designation: '', ctc_offered: '', joining_date: '' });
    fetchData();
  };

  const handleSaveTemplate = async () => {
    if (!tplForm.name.trim()) return showToast('Template name is required', 'error');
    const { error } = await saveLetterTemplate(tenant.id, tplForm);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Template saved', 'success');
    setShowTplModal(false);
    setTplForm({ type: 'Offer', name: '', body_html: DEFAULT_TEMPLATE_BODY });
    fetchData();
  };

  const setStatus = async (id, status) => {
    const { error } = await updateOfferLetterStatus(id, status);
    if (error) return showToast('Failed: ' + error.message, 'error');
    fetchData();
  };

  const doPrint = () => {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Offer Letter</title></head><body>${printLetter.rendered_html}</body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <>
      <Header title="Offer Letters" breadcrumb="Templated offers, browser-printable — same pattern as payslips" />
      <div className="page-content">
        <div className="filter-bar">
          <button className={`btn btn-sm ${tab === 'letters' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('letters')}>Letters</button>
          <button className={`btn btn-sm ${tab === 'templates' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('templates')}>Templates</button>
          <div style={{ marginLeft: 'auto' }}>
            {tab === 'letters'
              ? <button className="btn btn-primary" onClick={() => setShowLetterModal(true)}><i className="fas fa-plus" /> New Offer</button>
              : <button className="btn btn-primary" onClick={() => setShowTplModal(true)}><i className="fas fa-plus" /> New Template</button>}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : tab === 'letters' ? (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Candidate</th><th>Designation</th><th>CTC</th><th>Joining</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {letters.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No offer letters yet</td></tr>
                  ) : letters.map((l) => (
                    <tr key={l.id}>
                      <td>{l.referral?.candidate_name}</td>
                      <td>{l.designation}</td>
                      <td>{fmt(l.ctc_offered)}</td>
                      <td>{fmtDate.date(l.joining_date)}</td>
                      <td><span className={`badge ${STATUS_BADGE[l.status]}`}>{l.status}</span></td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => setPrintLetter(l)}><i className="fas fa-print" /></button>{' '}
                        {l.status === 'Draft' && <button className="btn btn-outline btn-sm" onClick={() => setStatus(l.id, 'Sent')}>Mark Sent</button>}
                        {l.status === 'Sent' && <>
                          <button className="btn btn-outline btn-sm" onClick={() => setStatus(l.id, 'Accepted')}>Accepted</button>{' '}
                          <button className="btn btn-outline btn-sm" onClick={() => setStatus(l.id, 'Declined')}>Declined</button>
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Type</th><th>Actions</th></tr></thead>
                <tbody>
                  {templates.length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No templates yet</td></tr>
                  ) : templates.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td><span className="badge badge-info">{t.type}</span></td>
                      <td><button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => { await deleteLetterTemplate(t.id); fetchData(); }}><i className="fas fa-trash" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showLetterModal} onClose={() => setShowLetterModal(false)} title="New Offer Letter" width="480px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowLetterModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreateLetter}>Create</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Candidate *</label>
          <select className="form-select" value={letterForm.referral_id} onChange={(e) => setLetterForm({ ...letterForm, referral_id: e.target.value })}>
            <option value="">Select Candidate</option>
            {referrals.map((r) => <option key={r.id} value={r.id}>{r.candidate_name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Template</label>
          <select className="form-select" value={letterForm.template_id} onChange={(e) => setLetterForm({ ...letterForm, template_id: e.target.value })}>
            <option value="">Select Template</option>
            {templates.filter((t) => t.type === 'Offer').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Designation</label>
            <input className="form-input" value={letterForm.designation} onChange={(e) => setLetterForm({ ...letterForm, designation: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">CTC (₹/yr)</label>
            <input className="form-input" type="number" value={letterForm.ctc_offered} onChange={(e) => setLetterForm({ ...letterForm, ctc_offered: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Joining Date</label>
          <input className="form-input" type="date" value={letterForm.joining_date} onChange={(e) => setLetterForm({ ...letterForm, joining_date: e.target.value })} />
        </div>
      </Modal>

      <Modal show={showTplModal} onClose={() => setShowTplModal(false)} title="New Letter Template" width="560px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowTplModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveTemplate}>Save</button>
        </>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input className="form-input" value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select className="form-select" value={tplForm.type} onChange={(e) => setTplForm({ ...tplForm, type: e.target.value })}>
              <option value="Offer">Offer</option>
              <option value="Appointment">Appointment</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Body (HTML, {'{{'}placeholders{'}}'})</label>
          <textarea className="form-input" rows={10} style={{ fontFamily: 'monospace', fontSize: 12 }} value={tplForm.body_html} onChange={(e) => setTplForm({ ...tplForm, body_html: e.target.value })} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Available: candidate_name, designation, company_name, ctc, joining_date
          </div>
        </div>
      </Modal>

      <Modal show={!!printLetter} onClose={() => setPrintLetter(null)} title="Preview" width="600px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setPrintLetter(null)}>Close</button>
          <button className="btn btn-primary" onClick={doPrint}><i className="fas fa-print" /> Print</button>
        </>}
      >
        {printLetter && <div dangerouslySetInnerHTML={{ __html: printLetter.rendered_html }} />}
      </Modal>
    </>
  );
}
