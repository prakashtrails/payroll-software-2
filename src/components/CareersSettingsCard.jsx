import { useEffect, useState } from 'react';
import { showToast } from '@/components/Toast';
import { saveCareersSettings } from '@/services/hiringService';

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** HR: turn on the public careers page (/careers/<slug>) and share its link. */
export default function CareersSettingsCard({ tenant, onSaved }) {
  const [form, setForm] = useState({ careers_enabled: false, careers_slug: '', careers_intro: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setForm({
      careers_enabled: !!tenant.careers_enabled,
      careers_slug: tenant.careers_slug || slugify(tenant.company_name),
      careers_intro: tenant.careers_intro || '',
    });
  }, [tenant]);

  const link = `${window.location.origin}/careers/${form.careers_slug}`;

  const handleSave = async () => {
    const slug = slugify(form.careers_slug);
    if (slug.length < 3) return showToast('The link name needs at least 3 letters or numbers', 'error');
    setSaving(true);
    const { error } = await saveCareersSettings(tenant.id, { ...form, careers_slug: slug });
    setSaving(false);
    if (error) {
      return showToast(/uq_tenants_careers_slug|duplicate/i.test(error.message) ? 'That link name is taken — try another' : error.message, 'error');
    }
    setForm((f) => ({ ...f, careers_slug: slug }));
    showToast(form.careers_enabled ? 'Careers page is live' : 'Careers page settings saved', 'success');
    onSaved?.();
  };

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-header"><h3><i className="fas fa-globe" style={{ marginRight: 8, color: 'var(--primary)' }} />Public Careers Page</h3></div>
      <div className="card-body">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          <input type="checkbox" checked={form.careers_enabled} onChange={(e) => setForm({ ...form, careers_enabled: e.target.checked })} />
          Show our open job postings on a public page where anyone can apply
        </label>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Link name</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{window.location.host}/careers/</span>
              <input className="form-input" value={form.careers_slug} maxLength={40} onChange={(e) => setForm({ ...form, careers_slug: e.target.value.toLowerCase() })} />
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Intro (optional)</label>
          <textarea className="form-input" rows={2} maxLength={1500} placeholder="A line or two about working at your company"
            value={form.careers_intro} onChange={(e) => setForm({ ...form, careers_intro: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {tenant?.careers_enabled && tenant?.careers_slug && (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard?.writeText(link); showToast('Link copied', 'success'); }}>
                <i className="fas fa-copy" style={{ marginRight: 6 }} />Copy link
              </button>
              <a className="btn btn-outline btn-sm" href={link} target="_blank" rel="noopener noreferrer"><i className="fas fa-arrow-up-right-from-square" style={{ marginRight: 6 }} />Open</a>
            </>
          )}
        </div>
        <div className="form-hint" style={{ marginTop: 10 }}>
          Applications arrive in Recruitment Pipeline → All Candidates with source "Careers Page", and HR is notified. Only postings with status Open (and not past their closing date) are shown.
        </div>
      </div>
    </div>
  );
}
