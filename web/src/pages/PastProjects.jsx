import { useMemo, useState } from 'react';
import { Search, FolderArchive, Copy, Star, Paperclip, X, Download } from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { useRouter } from '../router.jsx';
import { Loading, ErrorNote, Empty, VChip, StatusBadge, Avatar, Seg } from '../ui.jsx';
import { fmtDate, inrShort } from '../format.js';
import { ProjectForm } from './ProjectForm.jsx';
import { projectsCsv } from './Projects.jsx';
import { NoAccess } from './Dashboard.jsx';

export default function PastProjects() {
  const { vertical, verticals, today, canManage, refresh, toast } = useApp();
  const { navigate } = useRouter();
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [client, setClient] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState('projects');
  const [copy, setCopy] = useState(null);
  const { data: facets } = useLoad(() => api.get('/projects/facets', { vertical }), [vertical]);
  const { data, loading, error, reload } = useLoad(() => api.get('/projects', { vertical, scope: 'past', year, client, city, status }), [vertical, year, client, city, status]);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = data?.items || [];
    return term ? list.filter((p) => [p.name, p.code, p.client, p.city, p.venue, ...p.tags].join(' ').toLowerCase().includes(term)) : list;
  }, [data, q]);
  const byYear = useMemo(() => {
    const m = new Map();
    for (const p of items) {
      const y = (p.key_date || p.due_date || p.completed_at || '').slice(0, 4) || 'Undated';
      if (!m.has(y)) m.set(y, []);
      m.get(y).push(p);
    }
    return [...m.entries()];
  }, [items]);

  if (!verticals.length) return <NoAccess />;
  const filtersOn = q || year || client || city || status;
  const clients = facets?.clients || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Past Projects</h1>
          <div className="sub">Delivered and cancelled projects with their full plan, files and history. Run a repeat job again in one click.</div>
        </div>
        <div className="head-actions">
          <Seg value={view} onChange={setView} label="View" options={[{ value: 'projects', label: 'Projects' }, { value: 'clients', label: 'Clients' }]} />
          {view === 'projects' && <button type="button" className="btn" disabled={!items.length} onClick={() => api.saveText(`past-projects-${today}.csv`, projectsCsv(items)).catch((e) => toast(e.message, 'error'))}><Download size={17} /><span className="hide-sm">Export</span></button>}
        </div>
      </div>

      {view === 'clients' ? (
        <div className="card flush">
          {clients.length === 0 ? <Empty title="No clients yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Client</th><th className="num">Projects</th><th>Most recent</th><th /></tr></thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.name} className="click" onClick={() => { setClient(c.name); setView('projects'); }}>
                      <td className="b6">{c.name}</td>
                      <td className="num">{c.n}</td>
                      <td className="small">{c.last ? fmtDate(c.last, { today }) : '—'}</td>
                      <td className="right"><span className="link">See past work</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="filters mb-16">
            <div className="input-icon">
              <Search size={16} />
              <input id="archive-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, client, venue or tag" aria-label="Search past projects" />
            </div>
            <select id="archive-year" className="select" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
              <option value="">Any year</option>{facets?.years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <select id="archive-client" className="select" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
              <option value="">Any client</option>{clients.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.n})</option>)}
            </select>
            <select id="archive-city" className="select" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
              <option value="">Any city</option>{facets?.cities.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select id="archive-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Outcome">
              <option value="">Delivered and cancelled</option><option value="completed">Delivered</option><option value="cancelled">Cancelled</option>
            </select>
            {filtersOn && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setYear(''); setClient(''); setCity(''); setStatus(''); }}><X size={15} />Clear</button>}
          </div>
          <ErrorNote error={error} retry={reload} />
          {loading && !data ? <Loading /> : items.length === 0 ? (
            <div className="card"><Empty icon={FolderArchive} title={filtersOn ? 'No past projects match' : 'No past projects yet'}>When you mark a project completed, it moves here with all its files so you can find it next season.</Empty></div>
          ) : (
            <div className="col" style={{ gap: 18 }}>
              {byYear.map(([y, list]) => (
                <section key={y}>
                  <div className="year-head"><b>{y}</b><span className="pill-num">{list.length}</span></div>
                  <div className="arch-grid">
                    {list.map((p) => (
                      <article key={p.id} className="card arch" onClick={() => navigate(`/projects/${p.id}`)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${p.id}`)} style={{ borderTop: `3px solid ${p.vertical_color}` }}>
                        <div className="row between">
                          <VChip name={p.vertical} color={p.vertical_color} small />
                          <StatusBadge status={p.status} />
                        </div>
                        <div className="mt-8">
                          <div className="xs muted b6">{p.code}</div>
                          <div className="b7" style={{ fontSize: 15.5, lineHeight: 1.3 }}>{p.client ? `${p.client} · ` : ''}{p.name}</div>
                          <div className="small muted mt-4">{[p.venue, p.city].filter(Boolean).join(', ')}</div>
                        </div>
                        <div className="arch-stats">
                          <span title="Key date">{p.key_date ? fmtDate(p.key_date, { year: true }) : '—'}</span>
                          <span title="Files"><Paperclip size={13} />{p.file_count}</span>
                          <span title="Final assets"><Star size={13} fill={p.final_count ? 'var(--amber)' : 'none'} color={p.final_count ? 'var(--amber)' : 'currentColor'} />{p.final_count}</span>
                          {p.budget ? <span title="Budget">{inrShort(p.budget)}</span> : null}
                          {p.to_collect > 0 && <span className="red b6" title="Still to come from the client">{inrShort(p.to_collect)} due</span>}
                        </div>
                        <div className="row between mt-12">
                          <div className="row gap-6"><Avatar name={p.owner_name} color={p.owner_color} size={24} /><span className="small">{p.owner_name}</span></div>
                          {canManage(p.vertical_id) && (
                            <button type="button" className="btn xs soft" onClick={(e) => { e.stopPropagation(); setCopy(p); }} title="Start a new project from this one"><Copy size={13} />Run again</button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {copy && <ProjectForm copyFrom={copy} onClose={() => setCopy(null)} onSaved={(np) => { setCopy(null); refresh(); navigate(`/projects/${np.id}`); }} />}
    </>
  );
}
