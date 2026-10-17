import { useEffect, useRef, useState } from 'react';
import { Upload, Link2, Star, Download, Trash2, ExternalLink, Pencil, Loader2 } from 'lucide-react';
import { api } from './api.js';
import { useApp } from './store.jsx';
import { Link } from './router.jsx';
import { Modal, Field, FileThumb, FileIcon, VChip, NewTag } from './ui.jsx';
import { bytes, fmtTime, fmtDate } from './format.js';

// Guess a sensible category from the file name.
export function guessCategory(name, mime = '') {
  const n = name.toLowerCase();
  if (/brief/.test(n)) return 'Brief';
  if (/(po\b|purchase order|contract|agreement|loi|nda)/.test(n)) return 'Contract & PO';
  if (/(invoice|quote|quotation|boq|costing|estimate|budget)/.test(n)) return 'Quotes & Invoices';
  if (/(report|recap|analytics|footfall)/.test(n)) return 'Reports';
  if (/final/.test(n)) return 'Final deliverables';
  if (mime.startsWith('video/') || /(photo|pics|video|footage)/.test(n)) return 'Photos & Videos';
  if (/(drawing|fabrication|dwg|cad|run.?of.?show|cue|production)/.test(n)) return 'Production';
  if (mime.startsWith('image/') || /(render|design|artwork|layout|kv|key visual|mockup|\.ai$|\.psd$)/.test(n)) return 'Design';
  return 'Other';
}

export function UploadZone({ projectId, taskId, onUploaded, compact = false }) {
  const { toast } = useApp();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState([]); // [{name, progress}]
  const input = useRef(null);

  const send = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(files.map((f) => ({ name: f.name, progress: 0 })));
    let ok = 0;
    for (const [i, file] of files.entries()) {
      try {
        const saved = await api.upload(projectId, file, { category: guessCategory(file.name, file.type), task_id: taskId }, (p) =>
          setBusy((b) => b.map((x, j) => (j === i ? { ...x, progress: p } : x))),
        );
        ok++;
        onUploaded?.(saved);
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'error');
      }
      setBusy((b) => b.map((x, j) => (j === i ? { ...x, progress: 1 } : x)));
    }
    setBusy([]);
    if (ok) toast(ok === 1 ? 'File uploaded' : `${ok} files uploaded`, 'success');
  };

  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''} ${compact ? 'compact' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files); }}
    >
      <input ref={input} id={`upload-${projectId}-${taskId || 'p'}`} type="file" multiple hidden onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
      {busy.length ? (
        <div className="col" style={{ gap: 6, width: '100%' }}>
          {busy.map((b, i) => (
            <div key={i} className="row gap-6 small"><Loader2 size={15} className="spin" /><span className="ellipsis grow">{b.name}</span><span className="muted">{Math.round(b.progress * 100)}%</span></div>
          ))}
        </div>
      ) : (
        <>
          <Upload size={compact ? 18 : 26} />
          <div>
            <b>Drop files here</b> or <button type="button" className="link" onClick={() => input.current?.click()}>browse</button>
            {!compact && <div className="xs muted mt-4">Briefs, renders, drawings, POs, invoices, photos and videos. Files are sorted into categories for you.</div>}
          </div>
        </>
      )}
    </div>
  );
}

export function LinkForm({ projectId, taskId, onClose, onSaved }) {
  const { categories, toast } = useApp();
  const [f, setF] = useState({ url: '', name: '', category: 'Other', note: '' });
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const saved = await api.post(`/projects/${projectId}/files`, { ...f, task_id: taskId });
      toast('Link added', 'success');
      onSaved(saved);
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  };
  return (
    <Modal title="Add a link" sub="Google Drive, Dropbox, Figma, WeTransfer or any web link" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" form="link-form" className="btn primary" disabled={saving}>Add link</button></>}>
      <form id="link-form" className="modal-body col" style={{ gap: 14 }} onSubmit={submit}>
        {err && <div className="alert error">{err}</div>}
        <Field label="Link" htmlFor="lf-url"><input id="lf-url" className="input" type="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></Field>
        <Field label="Name" htmlFor="lf-name"><input id="lf-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Raw event photos" /></Field>
        <Field label="Category" htmlFor="lf-cat">
          <select id="lf-cat" className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Note" htmlFor="lf-note"><input id="lf-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} /></Field>
      </form>
    </Modal>
  );
}

export function FileCard({ file, onOpen, onToggleFinal, showProject, canEdit }) {
  return (
    <div className="fcard" role="button" tabIndex={0} onClick={() => onOpen(file)} onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}>
      <FileThumb file={file} />
      {file.is_new && <span className="fcard-new"><NewTag /></span>}
      {canEdit && (
        <button type="button" className={`star ${file.is_final ? 'on' : ''}`} aria-label={file.is_final ? 'Unmark final asset' : 'Mark as final asset'} title={file.is_final ? 'Final asset' : 'Mark as final asset'}
          onClick={(e) => { e.stopPropagation(); onToggleFinal(file); }}>
          <Star size={16} fill={file.is_final ? 'currentColor' : 'none'} />
        </button>
      )}
      {!canEdit && file.is_final ? <span className="star on static"><Star size={16} fill="currentColor" /></span> : null}
      <div className="fbody">
        <div className="b6 small ellipsis" title={file.name}>{file.name}</div>
        <div className="xs muted ellipsis">{file.category}{file.size ? ` · ${bytes(file.size)}` : ''}{file.message_id ? ' · Group chat' : ''}</div>
        {showProject && <div className="xs ellipsis mt-4"><span className="dot" style={{ background: file.vertical_color, marginRight: 5 }} />{file.client || file.code} · <span className="muted">{file.project_name}</span></div>}
      </div>
    </div>
  );
}

export function FileRow({ file, onOpen }) {
  return (
    <div className="list-item click" role="button" tabIndex={0} onClick={() => onOpen(file)} onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}>
      <FileIcon file={file} size={17} />
      <div className="grow">
        <div className="small b6 ellipsis">{file.is_new && <NewTag />}{file.is_final ? <Star size={12} fill="var(--amber)" color="var(--amber)" style={{ marginRight: 4, verticalAlign: '-1px' }} /> : null}{file.name}</div>
        <div className="xs muted ellipsis">{file.category}{file.size ? ` · ${bytes(file.size)}` : ''} · {file.uploader_name || 'Someone'}{file.message_id ? ' in the group chat' : ''} · {fmtTime(file.created_at)}</div>
      </div>
    </div>
  );
}

export function FilePreview({ file, onClose, onChanged, onDeleted, canEdit, canDelete, showProject }) {
  const { categories, toast, confirm } = useApp();
  const [url, setUrl] = useState(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: file.name, category: file.category, note: file.note || '' });
  const isImage = file.mime?.startsWith('image/');
  const isVideo = file.mime?.startsWith('video/');
  const sample = file.storage_key?.startsWith('sample:');

  useEffect(() => {
    let live = true;
    if ((isImage || isVideo || file.mime === 'application/pdf') && !sample) api.previewUrl(file).then((u) => live && setUrl(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [file, isImage, isVideo, sample]);

  const patch = async (body, msg) => {
    try {
      const saved = await api.patch(`/files/${file.id}`, body);
      onChanged?.(saved);
      if (msg) toast(msg, 'success');
      return saved;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${file.name}?`, message: 'The file is removed from the project for everyone. This cannot be undone.', confirmLabel: 'Delete file', danger: true }))) return;
    try {
      await api.del(`/files/${file.id}`);
      toast('File deleted', 'success');
      onDeleted?.(file);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const download = () => api.download(file).catch((e) => toast(e.message, 'error'));

  return (
    <Modal title={file.name} sub={`${file.category} · added by ${file.uploader_name || 'someone'} on ${fmtDate(file.created_at?.slice(0, 10), { year: true })}`} onClose={onClose} size="wide"
      footer={<>
        {canDelete && <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}><Trash2 size={16} />Delete</button>}
        {canEdit && <button type="button" className="btn" onClick={() => patch({ is_final: !file.is_final }, file.is_final ? 'No longer a final asset' : 'Marked as a final asset')}><Star size={16} fill={file.is_final ? 'var(--amber)' : 'none'} color={file.is_final ? 'var(--amber)' : 'currentColor'} />{file.is_final ? 'Final asset' : 'Mark as final'}</button>}
        <button type="button" className="btn primary" onClick={download}>{file.kind === 'link' ? <><ExternalLink size={16} />Open link</> : <><Download size={16} />Download</>}</button>
      </>}>
      <div className="modal-body">
        <div className="preview-box">
          {isImage && url ? <img src={url} alt={file.name} /> : isVideo && url ? <video src={url} controls /> : (
            <div style={{ width: 'min(420px, 100%)' }}><FileThumb file={file} /></div>
          )}
        </div>
        {sample && <div className="alert info mt-12">This is a sample record from the demo data, so there is no file behind it. Upload a file to see previews and downloads work.</div>}
        <dl className="kv mt-16">
          {showProject && <><dt>Project</dt><dd><Link to={`/projects/${file.project_id}`} onClick={onClose}>{file.code} · {file.project_name}</Link> <VChip name={file.vertical} color={file.vertical_color} small /></dd></>}
          {file.client && showProject && <><dt>Client</dt><dd>{file.client}</dd></>}
          {file.kind === 'link' ? <><dt>Link</dt><dd className="ellipsis"><a href={file.url} target="_blank" rel="noopener noreferrer">{file.url}</a></dd></> : <><dt>Size</dt><dd>{bytes(file.size) || '—'}</dd><dt>Type</dt><dd>{file.mime || '—'}</dd></>}
          {file.task_title && <><dt>Task</dt><dd>{file.task_title}</dd></>}
          {!edit && file.note && <><dt>Note</dt><dd>{file.note}</dd></>}
        </dl>
        {canEdit && !edit && <button type="button" className="btn sm mt-16" onClick={() => setEdit(true)}><Pencil size={14} />Rename or recategorise</button>}
        {edit && (
          <form className="form-grid mt-16" onSubmit={async (e) => { e.preventDefault(); if (await patch(f, 'File updated')) setEdit(false); }}>
            <Field label="Name" htmlFor="fp-name"><input id="fp-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
            <Field label="Category" htmlFor="fp-cat"><select id="fp-cat" className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Note" className="full" htmlFor="fp-note"><input id="fp-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} /></Field>
            <div className="full row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn sm" onClick={() => setEdit(false)}>Cancel</button>
              <button type="submit" className="btn sm primary">Save</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

export function AddLinkButton({ onClick }) {
  return <button type="button" className="btn" onClick={onClick}><Link2 size={16} />Add link</button>;
}
