import { useEffect, useState } from 'react';
import { Search, Images, Star, X } from 'lucide-react';
import { useApp, useLoad, usePref } from '../store.jsx';
import { api } from '../api.js';
import { Loading, ErrorNote, Empty, Seg } from '../ui.jsx';
import { FileCard, FileRow, FilePreview } from '../files.jsx';
import { bytes } from '../format.js';
import { NoAccess } from './Dashboard.jsx';

export default function AssetLibrary() {
  const { vertical, verticals, categories, me, canManage, levelIn, toast } = useApp();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [scope, setScope] = useState('');
  const [year, setYear] = useState('');
  const [client, setClient] = useState('');
  const [finalOnly, setFinalOnly] = usePref('bpm.assets.final', false);
  const [layout, setLayout] = usePref('bpm.assets.layout', 'grid');
  const [preview, setPreview] = useState(null);
  const { data: facets } = useLoad(() => api.get('/projects/facets', { vertical }), [vertical]);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, error, reload, setData } = useLoad(
    () => api.get('/files', { vertical, q: term, category, kind, scope, year, client, final: finalOnly ? '1' : '' }),
    [vertical, term, category, kind, scope, year, client, finalOnly],
  );
  if (!verticals.length) return <NoAccess />;
  const items = data?.items || [];
  const canContribute = (f) => me.role === 'admin' || ['manager', 'member'].includes(levelIn(f.vertical_id));
  const toggleFinal = async (f) => {
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === f.id ? { ...x, is_final: x.is_final ? 0 : 1 } : x)) }));
    try {
      await api.patch(`/files/${f.id}`, { is_final: !f.is_final });
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };
  const active = term || category || kind || scope || year || client || finalOnly;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Asset Library</h1>
          <div className="sub">Every brief, design, contract, photo and final deliverable from current and past projects{data ? ` · ${data.total} files${data.bytes ? `, ${bytes(data.bytes)}` : ''}` : ''}.</div>
        </div>
        <Seg value={layout} onChange={setLayout} label="Layout" options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} />
      </div>
      <div className="filters mb-12">
        <div className="input-icon grow" style={{ maxWidth: 420 }}>
          <Search size={16} />
          <input id="assets-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search file, project, client or tag" aria-label="Search assets" />
        </div>
        <select id="assets-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">All types</option><option value="image">Images</option><option value="video">Videos</option><option value="doc">Documents</option><option value="link">Links</option>
        </select>
        <select id="assets-scope" className="select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Projects">
          <option value="">Current and past projects</option><option value="open">Current projects</option><option value="past">Past projects</option>
        </select>
        <select id="assets-year" className="select" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
          <option value="">Any year</option>{facets?.years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <select id="assets-client" className="select" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
          <option value="">Any client</option>{facets?.clients.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <label className="check"><input id="assets-final" type="checkbox" checked={finalOnly} onChange={(e) => setFinalOnly(e.target.checked)} /><Star size={14} fill="var(--amber)" color="var(--amber)" />Final assets only</label>
        {active && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setCategory(''); setKind(''); setScope(''); setYear(''); setClient(''); setFinalOnly(false); }}><X size={15} />Clear</button>}
      </div>
      <div className="tabs pills">
        <button type="button" className={!category ? 'on' : ''} onClick={() => setCategory('')}>All categories</button>
        {categories.map((c) => <button key={c} type="button" className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>)}
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : items.length === 0 ? (
        <div className="card"><Empty icon={Images} title={active ? 'No files match' : 'No files yet'}>{active ? 'Try a different search or clear the filters.' : 'Files uploaded to any project in your verticals appear here.'}</Empty></div>
      ) : layout === 'grid' ? (
        <div className="fgrid">{items.map((f) => <FileCard key={f.id} file={f} onOpen={setPreview} onToggleFinal={toggleFinal} canEdit={canContribute(f)} showProject />)}</div>
      ) : (
        <div className="card">{items.map((f) => <FileRow key={f.id} file={{ ...f, category: `${f.code} · ${f.category}` }} onOpen={() => setPreview(f)} />)}</div>
      )}
      {data && data.total > items.length && <div className="center small muted mt-12">Showing the first {items.length} of {data.total}. Narrow the search to see more.</div>}
      {preview && (
        <FilePreview file={preview} showProject onClose={() => setPreview(null)} canEdit={canContribute(preview)}
          canDelete={canManage(preview.vertical_id) || (preview.uploaded_by === me.id && canContribute(preview))}
          onChanged={(f) => { setPreview(f); reload({ quiet: true }); }}
          onDeleted={() => { setPreview(null); reload({ quiet: true }); }} />
      )}
    </>
  );
}
