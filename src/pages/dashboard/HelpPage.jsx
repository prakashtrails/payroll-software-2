import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { HELP_CATEGORIES, visibleHelpTopics, helpTopicLink } from '@/lib/helpContent';

const CATEGORY_ICONS = {
  'Getting started': 'fa-rocket', Attendance: 'fa-fingerprint', 'Leave & requests': 'fa-inbox',
  'Tasks & projects': 'fa-list-check', 'Pay & finance': 'fa-wallet', Performance: 'fa-trophy',
  Company: 'fa-building', 'For managers': 'fa-users', 'For HR / admin': 'fa-user-shield', 'Account & security': 'fa-lock',
};

/** Renders an answer: blank line = paragraph; "1." / "•" lines = list items. */
function Answer({ text }) {
  return text.split('\n\n').map((block, i) => {
    const lines = block.split('\n');
    const ordered = lines.every((l) => /^\d+\.\s/.test(l));
    const bullets = lines.every((l) => /^•\s/.test(l));
    if (ordered || bullets) {
      const Tag = ordered ? 'ol' : 'ul';
      return (
        <Tag key={i} style={{ margin: '0 0 10px', paddingLeft: 20 }}>
          {lines.map((l, j) => <li key={j} style={{ marginBottom: 4 }}>{l.replace(/^(\d+\.|•)\s/, '')}</li>)}
        </Tag>
      );
    }
    return <p key={i} style={{ margin: '0 0 10px', whiteSpace: 'pre-line' }}>{block}</p>;
  });
}

export default function HelpPage() {
  const { profile } = useAuth();
  const { isEnabled } = useFeatures();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const openId = searchParams.get('topic');

  const role = profile?.role || 'employee';
  const topics = useMemo(() => visibleHelpTopics(role, isEnabled), [role, isEnabled]);

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return topics.filter((t) => {
      if (category && t.category !== category) return false;
      if (!words.length) return true;
      const hay = `${t.q} ${t.a} ${t.category}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [topics, query, category]);

  const categories = HELP_CATEGORIES.filter((c) => topics.some((t) => t.category === c));
  const toggle = (id) => setSearchParams(openId === id ? {} : { topic: id });

  // Deep link (?topic=) scrolls the opened answer into view.
  useEffect(() => {
    if (openId) document.getElementById(`help-${openId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [openId]);

  return (
    <>
      <Header title="Help & FAQ" breadcrumb="How to use CrewCore — answers for your role" />
      <div className="page-content">
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <i className="fas fa-search" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" style={{ paddingLeft: 34 }} placeholder="Search help — e.g. apply leave, payslip, regularize"
                value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => window.dispatchEvent(new CustomEvent('crewcore:open-assistant'))}>
              <i className="fas fa-robot" style={{ marginRight: 6 }} />Ask the Assistant
            </button>
          </div>
        </div>

        <div className="filter-bar">
          <button className={`btn btn-sm ${!category ? 'btn-primary' : 'btn-outline'}`} onClick={() => setCategory('')}>All</button>
          {categories.map((c) => (
            <button key={c} className={`btn btn-sm ${category === c ? 'btn-primary' : 'btn-outline'}`} onClick={() => setCategory(c)}>
              <i className={`fas ${CATEGORY_ICONS[c] || 'fa-circle-question'}`} style={{ marginRight: 6 }} />{c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="card"><div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            No answers match "{query}". Try fewer words, or ask the Assistant.
          </div></div>
        ) : (category ? [category] : categories).map((cat) => {
          const items = filtered.filter((t) => t.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat} style={{ marginBottom: 22 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 10px', color: 'var(--text-secondary)' }}>
                <i className={`fas ${CATEGORY_ICONS[cat] || 'fa-circle-question'}`} style={{ marginRight: 8, color: 'var(--primary)' }} />{cat}
              </h3>
              <div className="card">
                {items.map((t, idx) => {
                  const open = openId === t.id;
                  const link = helpTopicLink(t, role);
                  return (
                    <div key={t.id} id={`help-${t.id}`} style={{ borderTop: idx ? '1px solid var(--border-light)' : 'none' }}>
                      <button onClick={() => toggle(t.id)} aria-expanded={open}
                        style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '14px 18px', cursor: 'pointer',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontFamily: 'inherit', color: 'var(--text)' }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{t.q}</span>
                        <i className={`fas fa-chevron-${open ? 'up' : 'down'}`} style={{ color: 'var(--text-muted)', fontSize: 12 }} />
                      </button>
                      {open && (
                        <div style={{ padding: '0 18px 16px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                          <Answer text={t.a} />
                          {link && (
                            <button className="btn btn-primary btn-sm" onClick={() => navigate(link)}>
                              Open this page <i className="fas fa-arrow-right" style={{ marginLeft: 6 }} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 10 }}>
          Still stuck? Ask the CrewCore Assistant, or contact your HR team.
        </p>
      </div>
    </>
  );
}
