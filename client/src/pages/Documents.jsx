// Employee documents. HR sees every employee's files, a checklist of the
// required joining documents with what is missing, and can upload for
// anyone. Everyone else sees and uploads their own.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Download, Trash2, Upload, CircleCheck, Plus, FolderOpen, Users, FileWarning, FileCheck2 } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction, useDebounced } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { fmtDate, pct } from '../lib/format.js';
import { Card, Kpi, Badge, Button, Tabs, Empty, Loading, ErrorBox, Person, Select, Input, Modal, Field, FileDrop, Progress, Seg, Pagination, EmployeeSelect, useConfirm } from '../components/ui.jsx';
import { VerticalFilterNote } from './Dashboard.jsx';

const SHORT = { 'Aadhaar Card': 'Aadhaar', 'PAN Card': 'PAN', 'Address Proof': 'Address', 'Offer Letter': 'Offer', 'Appointment Letter': 'Appointment', 'Bank Proof': 'Bank' };
const kb = (n) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '—');
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt';

export function UploadModal({ employeeId, category, onClose, onDone }) {
  const { meta, user, isHR, toast } = useApp();
  const [f, setF] = useState({ employee: employeeId || (isHR ? '' : user.employeeId), category: category || meta.documentCategories?.[0] || 'Other', name: '' });
  const [file, setFile] = useState(null);
  const [run, busy] = useAction(toast);
  const submit = async () => {
    const form = new FormData();
    form.append('file', file);
    form.append('category', f.category);
    if (f.name.trim()) form.append('name', f.name.trim());
    if (await run(() => api.upload(`/employees/${f.employee}/documents`, form), `Uploaded ${f.name.trim() || file.name}`)) { onDone?.(); onClose(); }
  };
  return (
    <Modal title="Upload a document" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} loading={busy} disabled={!file || !f.employee} onClick={submit}>Upload</Button></>}>
      <div className="form-grid">
        {isHR && !employeeId && <Field label="Employee" className="full"><EmployeeSelect value={f.employee} onChange={(e) => setF({ ...f, employee: Number(e.target.value) || '' })} /></Field>}
        <Field label="Document type"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={meta.documentCategories || ['Other']} /></Field>
        <Field label="Name (optional)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} placeholder={f.category} /></Field>
        <div className="full">
          <FileDrop multiple={false} accept={ACCEPT} onFiles={(files) => setFile(files[0])}>
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}><Upload size={18} className="blue" /><b>{file ? file.name : 'Drop a file or click to choose'}</b><span className="small muted">PDF, images, Office · 10 MB max</span></div>
          </FileDrop>
        </div>
      </div>
    </Modal>
  );
}

export default function Documents() {
  const { isHR } = useApp();
  const [sp, setSp] = useSearchParams();
  const [upload, setUpload] = useState(null);
  const [tick, setTick] = useState(0);
  const tab = isHR ? sp.get('tab') || 'checklist' : 'mine';
  const done = () => setTick((t) => t + 1);
  return (
    <div>
      <div className="page-head">
        <div><h1>Documents</h1><div className="sub">{isHR ? <>Joining and HR documents for every employee, and what is still missing. <VerticalFilterNote /></> : 'Your joining and HR documents.'}</div></div>
        <Button variant="primary" icon={Upload} onClick={() => setUpload({})}>Upload document</Button>
      </div>
      {isHR && <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ value: 'checklist', label: 'Checklist' }, { value: 'all', label: 'All documents' }]} />}
      {tab === 'checklist' && <Checklist key={tick} onUpload={setUpload} />}
      {tab === 'all' && <AllDocuments key={tick} />}
      {tab === 'mine' && <MyDocuments key={tick} onUpload={setUpload} />}
      {upload && <UploadModal employeeId={upload.employee} category={upload.category} onClose={() => setUpload(null)} onDone={done} />}
    </div>
  );
}

function Checklist({ onUpload }) {
  const { meta, vertical } = useApp();
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [only, setOnly] = useState('all');
  const q = useDebounced(search, 250);
  const qs = new URLSearchParams({ ...(vertical ? { vertical } : {}), ...(department ? { department } : {}), ...(q ? { search: q } : {}), ...(only === 'missing' ? { missing: '1' } : {}) });
  const { data, error, reload } = useApi(`/documents/checklist?${qs}`);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const s = data.summary;
  return (
    <div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Kpi icon={Users} tone="blue" label="Employees" value={s.employees} />
        <Kpi icon={FileCheck2} tone="green" label="Complete files" value={s.complete} extra={<span className="small muted">{pct(s.complete, s.employees)}% of employees</span>} />
        <Kpi icon={FileWarning} tone="red" label="Documents missing" value={s.missingDocs} onClick={() => setOnly('missing')} />
        <Kpi icon={FolderOpen} tone="purple" label="Documents on file" value={s.totalDocs} />
      </div>
      <Card flush title="Required documents" sub={`Missing most often: ${[...s.byCategory].sort((a, b) => b.missing - a.missing).filter((c) => c.missing).slice(0, 3).map((c) => `${SHORT[c.category] || c.category} (${c.missing})`).join(', ') || 'nothing'}`}>
        <div className="filters" style={{ padding: '0 18px 14px' }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee" aria-label="Search employee" />
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="All departments" aria-label="Department" options={(meta.departments || []).map((d) => ({ value: d.id, label: d.name }))} />
          <Seg options={[{ value: 'all', label: 'All' }, { value: 'missing', label: 'Incomplete only' }]} value={only} onChange={setOnly} />
        </div>
        {!data.rows.length ? <Empty icon={CircleCheck} text={only === 'missing' ? 'Every employee has all required documents.' : 'No employees match.'} /> : (
          <div className="table-wrap">
            <table className="table doc-matrix">
              <thead><tr><th>Employee</th>{data.required.map((c) => <th key={c} className="center" title={c}>{SHORT[c] || c}</th>)}<th>On file</th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id}>
                  <td><Person name={r.name} sub={`${r.code} · ${r.department || '—'}`} id={r.id} hasPhoto={r.has_photo} size={34} /></td>
                  {data.required.map((c) => (
                    <td key={c} className="center">
                      {r.docs[c]
                        ? <button type="button" className="doc-ok" title={`Download ${r.docs[c].name}`} aria-label={`Download ${c} for ${r.name}`} onClick={() => download(`/documents/${r.docs[c].id}/download`)}><CircleCheck size={18} /></button>
                        : <button type="button" className="doc-add" title={`Upload ${c} for ${r.name}`} aria-label={`Upload ${c} for ${r.name}`} onClick={() => onUpload({ employee: r.id, category: c })}><Plus size={14} />Add</button>}
                    </td>
                  ))}
                  <td style={{ minWidth: 110 }}>
                    <div className="small b6">{data.required.length - r.missing.length}/{data.required.length}</div>
                    <Progress value={pct(data.required.length - r.missing.length, data.required.length)} color={r.missing.length ? 'var(--amber)' : 'var(--green)'} height={5} />
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function AllDocuments() {
  const { meta, vertical, toast } = useApp();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [run] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const q = useDebounced(search, 250);
  const qs = new URLSearchParams({ page, limit: 25, ...(vertical ? { vertical } : {}), ...(category ? { category } : {}), ...(q ? { search: q } : {}) });
  const { data, error, reload } = useApi(`/documents?${qs}`);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <Card flush title={`${data.total} documents`}>
      <div className="filters" style={{ padding: '0 18px 14px' }}>
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search document or employee" aria-label="Search documents" />
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} placeholder="All types" aria-label="Document type" options={meta.documentCategories || []} />
      </div>
      {!data.items.length ? <Empty icon={FileText} text="No documents match." /> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Document</th><th>Employee</th><th>Type</th><th className="hide-sm">Size</th><th className="hide-sm">Uploaded</th><th /></tr></thead>
              <tbody>{data.items.map((d) => (
                <tr key={d.id}>
                  <td><span className="row gap-6"><FileText size={16} className="blue" />{d.name}</span></td>
                  <td><Person name={d.employee} sub={d.code} id={d.employee_id} hasPhoto={d.has_photo} size={30} /></td>
                  <td><Badge tone="gray">{d.category}</Badge></td>
                  <td className="hide-sm small muted">{kb(d.size)}</td>
                  <td className="hide-sm small muted">{fmtDate(d.uploaded_at)}{d.uploadedBy ? ` · ${d.uploadedBy}` : ''}</td>
                  <td className="right nowrap">
                    <Button size="xs" icon={Download} onClick={() => download(`/documents/${d.id}/download`)}>Download</Button>
                    <Button size="xs" variant="ghost" icon={Trash2} aria-label={`Delete ${d.name}`} onClick={async () => { if (await confirm({ title: 'Delete document?', text: `${d.name} (${d.employee})`, danger: true, confirmLabel: 'Delete' })) { await run(() => api.del(`/documents/${d.id}`), 'Deleted'); reload(); } }} />
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ padding: '0 18px 14px' }}><Pagination page={page} pageSize={25} total={data.total} onPage={setPage} /></div>
        </>
      )}
      {confirmEl}
    </Card>
  );
}

function MyDocuments({ onUpload }) {
  const { user } = useApp();
  const list = useApi('/documents?limit=200');
  const check = useApi('/documents/checklist');
  if (!user.employeeId) return <Card><Empty text="Your login is not linked to an employee record." /></Card>;
  if ((list.error && !list.data) || (check.error && !check.data)) return <ErrorBox error={list.error || check.error} onRetry={() => { list.reload(); check.reload(); }} />;
  if (!list.data || !check.data) return <Loading />;
  const me = check.data.rows[0];
  const required = check.data.required;
  return (
    <div className="grid">
      <Card className="span-5" title="Required documents" sub={me && me.missing.length ? `${me.missing.length} still needed by HR` : 'All submitted'}>
        <div className="col" style={{ gap: 8 }}>
          {required.map((c) => (
            <div key={c} className="row between doc-req">
              <span className="row gap-6">{me?.docs[c] ? <CircleCheck size={18} className="green" /> : <FileWarning size={18} className="amber" />}{c}</span>
              {me?.docs[c]
                ? <Button size="xs" icon={Download} onClick={() => download(`/documents/${me.docs[c].id}/download`)}>View</Button>
                : <Button size="xs" variant="primary" icon={Upload} onClick={() => onUpload({ employee: user.employeeId, category: c })}>Upload</Button>}
            </div>
          ))}
        </div>
      </Card>
      <Card className="span-7" title="All my documents" flush>
        {!list.data.items.length ? <Empty icon={FileText} text="No documents yet. Upload your joining documents so HR can verify them." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Document</th><th>Type</th><th className="hide-sm">Uploaded</th><th /></tr></thead>
              <tbody>{list.data.items.map((d) => (
                <tr key={d.id}>
                  <td><span className="row gap-6"><FileText size={16} className="blue" />{d.name}</span></td>
                  <td><Badge tone="gray">{d.category}</Badge></td>
                  <td className="hide-sm small muted">{fmtDate(d.uploaded_at)}</td>
                  <td className="right"><Button size="xs" icon={Download} onClick={() => download(`/documents/${d.id}/download`)}>Download</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
