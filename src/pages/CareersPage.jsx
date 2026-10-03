import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicOpenings, submitPublicApplication, RESUME_MAX_BYTES, RESUME_ACCEPT } from '@/services/hiringService';
import { fmt } from '@/lib/helpers';

// Public careers page (no login): /careers/:slug — a company's open job
// postings and an application form. Enabled per company from Hiring →
// Careers Page. Applications land in the Recruitment Pipeline as
// 'Careers Page' candidates.

const EMPTY = { name: '', email: '', phone: '', cover_note: '', website: '' };

export default function CareersPage() {
  const { slug } = useParams();
  const [page, setPage] = useState(undefined); // undefined = loading, null = not found
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [resume, setResume] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    getPublicOpenings(slug).then(({ data }) => {
      setPage(data || null);
      if (data) document.title = `Careers at ${data.company}`;
    });
  }, [slug]);

  const openings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (page?.openings || []).filter((o) => !q || `${o.title} ${o.department} ${o.location}`.toLowerCase().includes(q));
  }, [page, query]);

  const choose = (o) => { setSelected(o); setDone(false); setError(''); setForm(EMPTY); setResume(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!resume) return setError('Please attach your resume (PDF or Word).');
    if (resume.size > RESUME_MAX_BYTES) return setError('Resume must be 5 MB or smaller.');
    setSending(true);
    const { error: err } = await submitPublicApplication({ ...form, slug, job_posting_id: selected.id, resume });
    setSending(false);
    if (err) return setError(err);
    setDone(true);
  };

  const shell = { minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' };
  const wrap = { maxWidth: 860, margin: '0 auto' };

  if (page === undefined) {
    return <div style={shell}><div style={{ ...wrap, textAlign: 'center', color: 'var(--text-muted)', paddingTop: 80 }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div></div>;
  }
  if (page === null) {
    return (
      <div style={shell}><div className="card" style={{ ...wrap, maxWidth: 520, textAlign: 'center' }}><div className="card-body" style={{ padding: 40 }}>
        <i className="fas fa-briefcase" style={{ fontSize: 32, color: 'var(--text-muted)', marginBottom: 12 }} />
        <h2 style={{ margin: '0 0 8px' }}>Careers page not found</h2>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>This link may be wrong, or the company isn't hiring through CrewCore right now.</p>
      </div></div></div>
    );
  }

  return (
    <div style={shell}>
      <div style={wrap}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 700, letterSpacing: 0.5 }}>CAREERS</div>
          <h1 style={{ margin: '4px 0 8px', fontSize: 28 }}>Work at {page.company}</h1>
          {page.intro && <p style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0 }}>{page.intro}</p>}
        </div>

        {selected ? (
          <div className="card">
            <div className="card-body">
              <button className="btn btn-outline btn-sm" onClick={() => setSelected(null)} style={{ marginBottom: 16 }}>← All openings</button>
              <h2 style={{ margin: '0 0 6px' }}>{selected.title}</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {[selected.department, selected.location, selected.employment_type, selected.experience_required && `${selected.experience_required} experience`]
                  .filter(Boolean).map((t) => <span key={t} className="badge badge-secondary">{t}</span>)}
                {selected.closing_date && <span className="badge badge-warning">Apply by {fmt.date(selected.closing_date)}</span>}
              </div>
              {[['About the role', selected.description], ['Responsibilities', selected.responsibilities], ['Requirements', selected.requirements]]
                .filter(([, text]) => text).map(([h, text]) => (
                  <div key={h} style={{ marginBottom: 14 }}>
                    <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>{h}</h4>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{text}</p>
                  </div>
                ))}

              <hr style={{ border: 0, borderTop: '1px solid var(--border-light)', margin: '20px 0' }} />
              {done ? (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <i className="fas fa-circle-check" style={{ fontSize: 40, color: 'var(--success)', marginBottom: 10 }} />
                  <h3 style={{ margin: '0 0 6px' }}>Application sent</h3>
                  <p style={{ color: 'var(--text-muted)', margin: 0 }}>Thank you for applying to {page.company}. The hiring team will contact you if your profile is a match.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Apply for this role</h3>
                  {error && <div className="badge-danger" style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Full name *</label>
                      <input className="form-input" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></div>
                    <div className="form-group"><label className="form-label">Email *</label>
                      <input className="form-input" type="email" required maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Phone *</label>
                      <input className="form-input" type="tel" required maxLength={20} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" placeholder="10-digit mobile" /></div>
                    <div className="form-group"><label className="form-label">Resume * (PDF/Word, max 5 MB)</label>
                      <input className="form-input" type="file" accept={RESUME_ACCEPT} onChange={(e) => setResume(e.target.files?.[0] || null)} /></div>
                  </div>
                  <div className="form-group"><label className="form-label">Why are you a good fit? (optional)</label>
                    <textarea className="form-input" rows={4} maxLength={2000} value={form.cover_note} onChange={(e) => setForm({ ...form, cover_note: e.target.value })} /></div>
                  {/* Honeypot for bots — hidden from people and screen readers. */}
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })} style={{ position: 'absolute', left: '-9999px', opacity: 0 }} />
                  <button className="btn btn-primary" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Submit application'}</button>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                    Your details are shared only with {page.company}'s hiring team and used only for recruitment.
                  </p>
                </form>
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <input className="form-input" style={{ maxWidth: 320 }} placeholder="Search roles, departments, locations" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{page.openings.length} open position{page.openings.length === 1 ? '' : 's'}</span>
            </div>
            {openings.length === 0 ? (
              <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                {page.openings.length ? 'No roles match your search.' : 'There are no open positions right now. Please check back later.'}
              </div></div>
            ) : openings.map((o) => (
              <div key={o.id} className="card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => choose(o)}>
                <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{o.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                      {[o.department, o.location, o.employment_type].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm">View & apply</button>
                </div>
              </div>
            ))}
          </>
        )}
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 28 }}>Powered by CrewCore</p>
      </div>
    </div>
  );
}
