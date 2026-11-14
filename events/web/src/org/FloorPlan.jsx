// Organiser floor plan: booth status at a glance, and a layout editor. In the editor the
// organiser uploads each hall's floor drawing, sets the hall size in metres, imports a stall
// list from a spreadsheet, and moves, resizes, adds and removes stalls on the plan.
import { useMemo, useRef, useState } from 'react';
import { api as call, del, get, post, put } from '../api.js';
import { Empty, Field, Loaded, Notice, Status, useAction, useLoad, useToast } from '../ui.jsx';
import { HallPlan } from '../components.jsx';
import { dayTime, inr, STATES } from '../format.js';
import { PageTitle, useOrg } from './shared.jsx';
import { shrinkImage } from '../images.js';
import { ExhibitorDialog } from './OrgShell.jsx';

const CSV_COLUMNS = ['code', 'hall', 'x', 'y', 'width', 'depth', 'type', 'price', 'blocked', 'note'];
const CSV_HELP = [
  ['code', 'Stall number, for example A12'],
  ['hall', 'Hall name or code, for example Hall A'],
  ['x', 'Metres from the left wall of the hall to the stall'],
  ['y', 'Metres from the top wall of the hall to the stall'],
  ['width', 'Stall width in metres'],
  ['depth', 'Stall depth in metres'],
  ['type', 'shell, raw or premium'],
  ['price', 'Price in rupees before GST'],
  ['blocked', 'yes if the stall must not be sold'],
  ['note', 'Optional'],
];

// Reads CSV text (as Excel and Google Sheets save it) into objects keyed by our column names.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') ((cell += '"'), i++);
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];
  // Header names are matched loosely: "Stall No.", "Width (m)" and "Price ₹" all work.
  const keyOf = (h) => {
    const k = h.toLowerCase().replace(/[^a-z]/g, '');
    if (k.startsWith('code') || k.startsWith('stall') || k.startsWith('booth')) return 'code';
    if (k.startsWith('hall') || k.startsWith('zone')) return 'hall';
    if (k === 'x' || k.startsWith('xm') || k.startsWith('left')) return 'x';
    if (k === 'y' || k.startsWith('ym') || k.startsWith('top')) return 'y';
    if (k.startsWith('width') || k === 'w' || k === 'wm') return 'width';
    if (k.startsWith('depth') || k.startsWith('length') || k === 'h' || k === 'd' || k === 'dm') return 'depth';
    if (k.startsWith('type') || k.startsWith('kind')) return 'type';
    if (k.startsWith('price') || k.startsWith('rate')) return 'price';
    if (k.startsWith('block')) return 'blocked';
    if (k.startsWith('note')) return 'note';
    return null;
  };
  const keys = rows[0].map(keyOf);
  return rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]?.trim()]).filter(([k]) => k)));
}
const csvCell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

export default function FloorPlan() {
  const { api, can, cfg, reloadConfig } = useOrg();
  const load = useLoad(() => get(`${api}/floor`), [api]);
  const [sel, setSel] = useState(null);
  const [zoneId, setZoneId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [openEx, setOpenEx] = useState(null);
  const act = useAction();
  const toast = useToast();
  const canEdit = can('floor.manage');

  const halls = useMemo(
    () =>
      (load.data || []).map((z) => ({
        ...z,
        amenities: [],
        booths: z.booths.map((b) => ({ ...b, ...(drafts[b.id] || {}) })),
      })),
    [load.data, drafts],
  );
  const drawable = halls.filter((h) => h.cols > 0);
  const hall = drawable.find((h) => h.id === zoneId) || drawable[0];
  const booth = halls.flatMap((h) => h.booths).find((b) => b.id === sel);
  const tone = (b) => (b.status === 'available' ? 'free' : b.status === 'confirmed' ? '' : b.status);
  const label = (b) => `Stall ${b.code}, ${STATES.booth[b.status][1]}${b.exhibitor ? `, ${b.exhibitor}` : ''}`;
  const totals = halls.flatMap((h) => h.booths).reduce((a, b) => ((a[b.status] = (a[b.status] || 0) + 1), a), {});
  const reload = () => load.reload().then(() => setDrafts({}));

  // Saves a stall's new position or size; on a clash the server says why and it snaps back.
  const bodyOf = (b, patch = {}) => ({
    code: b.code,
    zoneId: halls.find((h) => h.booths.some((x) => x.id === b.id))?.id,
    kind: b.kind,
    pricePaise: b.pricePaise,
    blocked: b.status === 'blocked',
    note: b.note,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    ...patch,
  });
  const moveStall = (b, r) => {
    setDrafts((d) => ({ ...d, [b.id]: r }));
    put(`${api}/booths/${b.id}`, bodyOf(b, r))
      .then(reload)
      .catch((e) => {
        toast(e.message, 'error');
        setDrafts((d) => {
          const { [b.id]: _gone, ...rest } = d;
          return rest;
        });
      });
  };

  // A new 3 × 3 m stall in the first free spot of the hall, numbered after the hall's others.
  const addStall = () =>
    act(async () => {
      if (!hall) throw new Error('Set the hall size first');
      const used = new Set(halls.flatMap((h) => h.booths.map((b) => b.code)));
      const sample = hall.booths[0]?.code || `${hall.name.replace(/[^A-Za-z]/g, '').slice(-1) || 'S'}01`;
      const prefix = sample.replace(/\d+$/, '');
      let n = hall.booths.length + 1;
      while (used.has(`${prefix}${String(n).padStart(2, '0')}`)) n++;
      const w = Math.min(3, hall.cols);
      const h = Math.min(3, hall.rows);
      const free = (x, y) => !hall.booths.some((o) => o.x < x + w && x < o.x + o.w && o.y < y + h && y < o.y + o.h);
      let spot = null;
      for (let y = 0; y + h <= hall.rows && !spot; y += 0.5)
        for (let x = 0; x + w <= hall.cols && !spot; x += 0.5) if (free(x, y)) spot = { x, y };
      if (!spot) throw new Error('There is no free 3 × 3 m space left in this hall. Make it larger or move stalls.');
      const priced = hall.booths.find((b) => b.kind === 'shell');
      const out = await post(`${api}/booths`, {
        code: `${prefix}${String(n).padStart(2, '0')}`,
        zoneId: hall.id,
        kind: 'shell',
        pricePaise: priced ? Math.round((priced.pricePaise / (priced.w * priced.h)) * w * h) : 0,
        ...spot,
        w,
        h,
      });
      await reload();
      setSel(out.id);
    }, 'Stall added. Drag it into place.');

  return (
    <div className="stack">
      <PageTitle title="Floor plan">
        <a className="btn" href={`/api/v1${api}/reports/booths.csv`}>
          Export CSV
        </a>
        {canEdit && (
          <button className={`btn ${editing ? 'primary' : ''}`} onClick={() => setEditing(!editing)}>
            {editing ? 'Done editing' : 'Edit layout'}
          </button>
        )}
      </PageTitle>
      <div className="row wrap" role="group" aria-label="Stall totals">
        {['confirmed', 'held', 'available', 'blocked'].map((s) => (
          <span key={s}>
            <Status kind="booth" value={s} /> <span className="num">{totals[s] || 0}</span>
          </span>
        ))}
      </div>
      {editing && (
        <Notice>
          Drag a stall to move it and drag its corner square to change its size. With a stall selected, the arrow keys move it by 0.5 m and
          Shift with the arrow keys changes its size. Every change is saved straight away.
        </Notice>
      )}
      <Loaded load={load}>
        {() => (
          <div className="split">
            <HallPlan
              halls={halls}
              selected={sel}
              onSelect={(b) => setSel(b.id)}
              tone={tone}
              label={label}
              zoneId={hall?.id}
              onZone={(id) => (setZoneId(id), setSel(null))}
              onChange={editing ? moveStall : undefined}
            />
            <aside className="stack">
              {editing ? (
                <>
                  {booth ? (
                    <StallForm
                      key={`${booth.id}:${booth.x}:${booth.y}:${booth.w}:${booth.h}`}
                      booth={booth}
                      bodyOf={bodyOf}
                      onSaved={reload}
                      onDeleted={() => (setSel(null), reload())}
                    />
                  ) : null}
                  <div className="panel">
                    <div className="body stack tight">
                      <button className="btn primary" onClick={addStall}>
                        Add a stall to {hall?.name || 'this hall'}
                      </button>
                      {!booth && <p className="muted small">Select a stall on the plan to change its number, size, type or price.</p>}
                    </div>
                  </div>
                  {hall && (
                    <HallSettings hall={hall} zone={cfg.zones.find((z) => z.id === hall.id)} onSaved={() => (reload(), reloadConfig())} />
                  )}
                  <ImportStalls halls={halls} onDone={reload} />
                </>
              ) : (
                <BoothDetails booth={booth} onOpenExhibitor={setOpenEx} onChanged={reload} />
              )}
            </aside>
          </div>
        )}
      </Loaded>
      {openEx && <ExhibitorDialog id={openEx} onClose={() => setOpenEx(null)} onChanged={reload} />}
    </div>
  );
}

function BoothDetails({ booth, onOpenExhibitor, onChanged }) {
  const { api, can } = useOrg();
  const act = useAction();
  if (!booth)
    return (
      <div className="panel">
        <Empty>Choose a stall on the plan or in the list.</Empty>
      </div>
    );
  return (
    <div className="panel" aria-live="polite">
      <div className="body stack tight">
        <div className="row between">
          <h2>Stall {booth.code}</h2>
          <Status kind="booth" value={booth.status} />
        </div>
        <dl className="kv">
          <dt>Size</dt>
          <dd>
            {booth.w} × {booth.h} m ({booth.sizeSqm} sq m), {booth.kind}
          </dd>
          <dt>Price</dt>
          <dd>{inr(booth.pricePaise)} + GST</dd>
          <dt>Exhibitor</dt>
          <dd>{booth.exhibitor || '—'}</dd>
          {booth.holdExpiresAt && (
            <>
              <dt>Hold ends</dt>
              <dd>{dayTime(booth.holdExpiresAt)}</dd>
            </>
          )}
          {booth.note && (
            <>
              <dt>Note</dt>
              <dd>{booth.note}</dd>
            </>
          )}
        </dl>
        {booth.exhibitorId && (
          <button className="btn" onClick={() => onOpenExhibitor(booth.exhibitorId)}>
            Open exhibitor
          </button>
        )}
        {booth.status === 'held' && can('exh.allocate') && (
          <button
            className="btn primary"
            onClick={() => act(() => post(`${api}/assignments/${booth.assignmentId}/confirm`).then(onChanged), 'Stall confirmed')}
          >
            Confirm stall
          </button>
        )}
        {booth.assignmentId && can('exh.allocate') && (
          <button
            className="btn danger"
            onClick={() =>
              window.confirm(`Release stall ${booth.code}?`) &&
              act(() => post(`${api}/assignments/${booth.assignmentId}/release`).then(onChanged), 'Stall released')
            }
          >
            Release stall
          </button>
        )}
        {booth.status === 'available' && <p className="muted small">To allocate this stall, open an approved exhibitor and choose it.</p>}
      </div>
    </div>
  );
}

// Number, size, type, price and notes of the selected stall.
function StallForm({ booth, bodyOf, onSaved, onDeleted }) {
  const { api } = useOrg();
  const act = useAction();
  const [f, setF] = useState({
    code: booth.code,
    w: booth.w,
    h: booth.h,
    x: booth.x,
    y: booth.y,
    kind: booth.kind,
    price: booth.pricePaise / 100,
    blocked: booth.status === 'blocked',
    note: booth.note || '',
  });
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const area = Math.round(Number(f.w) * Number(f.h) * 10) / 10;
  const save = (e) => {
    e.preventDefault();
    act(
      () =>
        put(
          `${api}/booths/${booth.id}`,
          bodyOf(booth, {
            code: f.code,
            w: Number(f.w),
            h: Number(f.h),
            x: Number(f.x),
            y: Number(f.y),
            kind: f.kind,
            pricePaise: Math.round(Number(f.price || 0) * 100),
            blocked: f.blocked,
            note: f.note,
          }),
        ).then(onSaved),
      'Stall saved',
    );
  };
  const num = (k, label) => (
    <Field label={label}>
      <input className="input" type="number" step="0.5" min="0" inputMode="decimal" value={f[k]} onChange={set(k)} />
    </Field>
  );
  return (
    <form className="panel" onSubmit={save}>
      <div className="body stack tight">
        <div className="row between">
          <h2>Stall {booth.code}</h2>
          <Status kind="booth" value={booth.status} />
        </div>
        {booth.exhibitor && <p className="muted small">Allocated to {booth.exhibitor}. Changes show in their workspace.</p>}
        <Field label="Stall number">
          <input className="input" value={f.code} onChange={set('code')} required />
        </Field>
        <div className="grid2">
          {num('w', 'Width (m)')}
          {num('h', 'Depth (m)')}
        </div>
        <p className="muted small num">Area {Number.isFinite(area) ? area : '—'} sq m</p>
        <div className="grid2">
          {num('x', 'From left wall (m)')}
          {num('y', 'From top wall (m)')}
        </div>
        <Field label="Type">
          <select className="input" value={f.kind} onChange={set('kind')}>
            <option value="shell">Shell scheme</option>
            <option value="raw">Raw space</option>
            <option value="premium">Premium</option>
          </select>
        </Field>
        <Field label="Price before GST (₹)">
          <input className="input" type="number" min="0" step="1" inputMode="numeric" value={f.price} onChange={set('price')} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.blocked} onChange={set('blocked')} />
          <span>Blocked: not for sale (for example a fire exit)</span>
        </label>
        <Field label="Note (optional)">
          <input className="input" value={f.note} onChange={set('note')} />
        </Field>
        <div className="row wrap">
          <button className="btn primary">Save stall</button>
          {!booth.exhibitor && (
            <button
              type="button"
              className="btn danger"
              onClick={() =>
                window.confirm(`Delete stall ${booth.code}?`) &&
                act(() => del(`${api}/booths/${booth.id}`).then(onDeleted), 'Stall deleted')
              }
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

// Hall size in metres and the uploaded floor drawing.
function HallSettings({ hall, zone, onSaved }) {
  const { api } = useOrg();
  const act = useAction();
  const toast = useToast();
  const file = useRef(null);
  const [size, setSize] = useState({ cols: hall.cols, rows: hall.rows });
  const [busy, setBusy] = useState(false);
  const saveSize = (e) => {
    e.preventDefault();
    act(
      () => put(`${api}/zones/${hall.id}`, { ...zone, cols: Number(size.cols), rows: Number(size.rows) }).then(onSaved),
      'Hall size saved',
    );
  };
  const upload = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const { blob, ratio } = await shrinkImage(f);
      const form = new FormData();
      form.append('file', blob, f.name.replace(/\.[^.]+$/, '') + '.jpg');
      form.append('ratio', String(ratio));
      const out = await call(`${api}/zones/${hall.id}/plan-image`, { method: 'POST', form });
      setSize({ cols: out.cols, rows: out.rows });
      toast(
        out.depthKept
          ? `Drawing added. The hall depth stays ${out.rows} m because a stall would otherwise fall outside it.`
          : `Drawing added. The hall depth is now ${out.rows} m to match its proportions; change it below if needed.`,
      );
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <div className="panel">
      <div className="body stack tight">
        <h3>{hall.name}</h3>
        <form className="stack tight" onSubmit={saveSize}>
          <div className="grid2">
            <Field label="Hall width (m)">
              <input
                className="input"
                type="number"
                min="1"
                step="0.5"
                inputMode="decimal"
                value={size.cols}
                onChange={(e) => setSize({ ...size, cols: e.target.value })}
              />
            </Field>
            <Field label="Hall depth (m)">
              <input
                className="input"
                type="number"
                min="1"
                step="0.5"
                inputMode="decimal"
                value={size.rows}
                onChange={(e) => setSize({ ...size, rows: e.target.value })}
              />
            </Field>
          </div>
          <div>
            <button className="btn">Save hall size</button>
          </div>
        </form>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <strong>Floor drawing</strong>
          <p className="muted small">
            Upload the hall layout from your designer or the venue as a PNG or JPG. It is shown under the stalls for visitors, exhibitors
            and staff. Set the hall width first; the depth then follows the drawing.
          </p>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,.pdf"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={upload}
          />
          <div className="row wrap">
            <button type="button" className="btn" disabled={busy} onClick={() => file.current.click()}>
              {busy ? 'Uploading…' : hall.image ? 'Replace drawing' : 'Upload drawing'}
            </button>
            {hall.image && (
              <button
                type="button"
                className="btn plain"
                onClick={() => act(() => del(`${api}/zones/${hall.id}/plan-image`).then(onSaved), 'Drawing removed')}
              >
                Remove drawing
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Stall list import from a spreadsheet saved as CSV, with a template made from the current layout.
function ImportStalls({ halls, onDone }) {
  const { api } = useOrg();
  const toast = useToast();
  const file = useRef(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const current = [
    CSV_COLUMNS.join(','),
    ...halls.flatMap((h) =>
      h.booths.map((b) =>
        [b.code, h.name, b.x, b.y, b.w, b.h, b.kind, b.pricePaise / 100, b.status === 'blocked' ? 'yes' : '', b.note || '']
          .map(csvCell)
          .join(','),
      ),
    ),
  ].join('\r\n');
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + current + '\r\n'], { type: 'text/csv' }));
    a.download = 'stall-list.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const copy = () =>
    navigator.clipboard
      .writeText(current)
      .then(() => toast('Stall list copied. Paste it into a spreadsheet.'))
      .catch(() => toast('Copying is blocked here. Use Download instead.', 'error'));
  const pick = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      toast('In Excel choose File › Save As › CSV, then upload the CSV file.', 'error');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const rows = parseCsv(await f.text());
      if (!rows.length) throw new Error('No stalls found. The first row must be the column names.');
      const out = await call(`${api}/booths/import`, { method: 'POST', body: { rows } });
      setResult({ ok: `${out.added} stall(s) added and ${out.updated} updated.` });
      onDone();
    } catch (err) {
      setResult({ error: err.message, rows: err.data?.errors });
    }
    setBusy(false);
  };
  return (
    <div className="panel">
      <div className="body stack tight">
        <h3>Import a stall list</h3>
        <p className="muted small">
          Keep your stall list in Excel or Google Sheets with these columns, save it as CSV, and upload it. Stalls are matched by number:
          new ones are added, existing ones updated. Nothing changes if any row has a problem.
        </p>
        <details>
          <summary className="small">What each column means</summary>
          <dl className="kv small" style={{ marginTop: 8 }}>
            {CSV_HELP.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
        <input ref={file} type="file" accept=".csv,text/csv,.txt" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={pick} />
        <div className="row wrap">
          <button type="button" className="btn primary" disabled={busy} onClick={() => file.current.click()}>
            {busy ? 'Importing…' : 'Upload stall list (CSV)'}
          </button>
          <button type="button" className="btn" onClick={download}>
            Download current list
          </button>
          <button type="button" className="btn plain" onClick={copy}>
            Copy
          </button>
        </div>
        {result?.ok && <Notice tone="ok">{result.ok}</Notice>}
        {result?.error && (
          <Notice tone="error">
            {result.error}
            {result.rows?.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {result.rows.slice(0, 12).map((r) => (
                  <li key={r.line}>
                    Row {r.line}: {r.error}
                  </li>
                ))}
                {result.rows.length > 12 && <li>and {result.rows.length - 12} more</li>}
              </ul>
            )}
          </Notice>
        )}
      </div>
    </div>
  );
}
