// Pieces shared by the public site, the consoles and the displays: the pass card, the 2D hall
// plan with its accessible list view, and the agenda list.
import { useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { Qr, Status, Tabs } from './ui.jsx';
import { dateRange, weekday } from './format.js';

// The pass as shown to its holder: quiet, high-contrast QR with the gate and area beside it.
export function PassCard({ pass }) {
  return (
    <div className="pass">
      <span className="type">{pass.passClass.name}</span>
      <div className="name">{pass.holderName}</div>
      {pass.holderCompany && <div className="muted">{pass.holderCompany}</div>}
      {pass.qr ? (
        <Qr text={pass.qr} alt={`QR code for ${pass.holderName}'s pass`} />
      ) : (
        <p className="notice error" style={{ margin: '16px 0' }}>
          This pass is no longer valid.
        </p>
      )}
      <div className="where">
        <div>
          <div className="small muted">Enter at</div>
          <div className="v">{pass.gates.join(', ') || 'Any gate'}</div>
        </div>
        <div>
          <div className="small muted">Valid for</div>
          <div className="v">{pass.zones.join(', ')}</div>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        {dateRange(pass.validFrom, pass.validTo)} · {pass.event.openTime}–{pass.event.closeTime}
        {pass.ref ? ` · Ref ${pass.ref}` : ''}
      </p>
      <p className="muted" style={{ marginTop: 4 }}>
        {pass.instructions}
      </p>
    </div>
  );
}

// SVG units per metre of hall. Hall plans, stalls, gates and amenities are all in metres.
const S = 40;
const SNAP = 0.5;
const snap = (v) => Math.round(v / SNAP) * SNAP;

// Loads a floor drawing through fetch so it works for drafts (with the sign-in) and in the
// in-browser demo, and hands back an object URL for the SVG.
function usePlanImage(src) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!src) return setUrl(null);
    let live = true;
    let made = null;
    fetch(src)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && live) setUrl((made = URL.createObjectURL(b)));
      })
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [src]);
  return url;
}

// 2D plan of one hall, drawn to scale over the hall's floor drawing when one was uploaded.
// Stalls are keyboard-focusable buttons; `tone(booth)` picks the style (free, held, blocked,
// sel). The list view carries the same information as text.
// With `onChange`, the plan is editable: drag a stall to move it, drag its corner to resize,
// or use the arrow keys (Shift + arrows resize). Changes snap to 0.5 m.
export function HallPlan({ halls, selected, onSelect, tone, here, label, startView = 'map', zoneId: controlled, onZone, onChange }) {
  const drawable = halls.filter((h) => h.cols > 0);
  const [own, setOwn] = useState(
    () => here?.zoneId ?? drawable.find((h) => h.booths.some((b) => b.id === selected))?.id ?? drawable[0]?.id,
  );
  const zoneId = controlled ?? own;
  const setZone = (id) => (onZone ? onZone(id) : setOwn(id));
  const [view, setView] = useState(startView);
  const [drag, setDrag] = useState(null); // { id, mode, start, orig, rect }
  const svgRef = useRef(null);
  const hall = drawable.find((h) => h.id === zoneId) || drawable[0];
  const image = usePlanImage(hall?.image);
  if (!hall) return <p className="empty">No hall plan has been set up yet.</p>;
  const editing = Boolean(onChange);
  const boothLabel = label || ((b) => (b.exhibitor ? `Stall ${b.code}, ${b.exhibitor}` : `Stall ${b.code}`));
  const toneOf = (b) => (b.id === selected ? 'sel' : tone ? tone(b) : b.exhibitor ? '' : 'free');
  const W = hall.cols * S;
  const H = hall.rows * S;
  // Text sizes follow the hall's size, so a 10 m hall and a 200 m hall both read well.
  const U = (Math.max(hall.cols, hall.rows) * S) / 40;
  const pad = U * 1.6;

  const point = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x / S, y: p.y / S };
  };
  const clampRect = (r) => {
    const w = Math.max(SNAP, Math.min(r.w, hall.cols));
    const h = Math.max(SNAP, Math.min(r.h, hall.rows));
    return { w, h, x: Math.min(Math.max(0, r.x), hall.cols - w), y: Math.min(Math.max(0, r.y), hall.rows - h) };
  };
  const startDrag = (e, b, mode) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(b);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id: b.id, mode, start: point(e), orig: { x: b.x, y: b.y, w: b.w, h: b.h }, rect: { x: b.x, y: b.y, w: b.w, h: b.h } });
  };
  const moveDrag = (e) => {
    if (!drag) return;
    const p = point(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const o = drag.orig;
    const r = drag.mode === 'move' ? { ...o, x: snap(o.x + dx), y: snap(o.y + dy) } : { ...o, w: snap(o.w + dx), h: snap(o.h + dy) };
    setDrag({ ...drag, rect: clampRect(r) });
  };
  const endDrag = () => {
    if (!drag) return;
    const b = hall.booths.find((x) => x.id === drag.id);
    const r = drag.rect;
    setDrag(null);
    if (b && (r.x !== b.x || r.y !== b.y || r.w !== b.w || r.h !== b.h)) onChange(b, r);
  };
  const keyEdit = (e, b) => {
    const step = { ArrowLeft: [-SNAP, 0], ArrowRight: [SNAP, 0], ArrowUp: [0, -SNAP], ArrowDown: [0, SNAP] }[e.key];
    if (!editing || !step) return false;
    e.preventDefault();
    const r = e.shiftKey ? { ...b, w: b.w + step[0], h: b.h + step[1] } : { ...b, x: b.x + step[0], y: b.y + step[1] };
    onChange(b, clampRect(r));
    return true;
  };
  const rectOf = (b) => (drag?.id === b.id ? drag.rect : b);

  return (
    <div className="plan">
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        {drawable.length > 1 ? (
          <Tabs tabs={drawable.map((h) => ({ value: h.id, label: h.name }))} value={hall.id} onChange={setZone} />
        ) : (
          <h3>{hall.name}</h3>
        )}
        <div className="chips" role="group" aria-label="View">
          <button className="chip" aria-pressed={view === 'map'} onClick={() => setView('map')}>
            Map
          </button>
          <button className="chip" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            List
          </button>
        </div>
      </div>
      {view === 'map' ? (
        <svg
          ref={svgRef}
          className={`${image ? 'has-drawing' : ''} ${editing ? 'editing' : ''}`}
          viewBox={`${-pad} ${-pad} ${W + pad * 2} ${H + pad * 3.2}`}
          role="group"
          aria-label={`Plan of ${hall.name}, ${hall.cols} by ${hall.rows} metres`}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={() => setDrag(null)}
        >
          {image && <image href={image} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />}
          <rect className="wall" x="0" y="0" width={W} height={H} rx={U * 0.2} />
          {hall.booths.map((b) => {
            const r = rectOf(b);
            const fs = Math.max(U * 0.35, Math.min(Math.min(r.w, r.h) * S * 0.34, U * 0.9));
            return (
              <g
                key={b.id}
                className={`booth ${toneOf(b)} ${drag?.id === b.id ? 'dragging' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${boothLabel(b)}, ${r.w} by ${r.h} metres`}
                aria-pressed={b.id === selected}
                onPointerDown={(e) => startDrag(e, b, 'move')}
                onClick={() => !editing && onSelect?.(b)}
                onKeyDown={(e) => {
                  if (keyEdit(e, b)) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect?.(b);
                  }
                }}
              >
                <rect x={r.x * S + 2} y={r.y * S + 2} width={r.w * S - 4} height={r.h * S - 4} rx={U * 0.1} />
                <text x={(r.x + r.w / 2) * S} y={(r.y + r.h / 2) * S + fs * 0.35} textAnchor="middle" style={{ fontSize: fs }}>
                  {b.code}
                </text>
                {editing && b.id === selected && (
                  <>
                    <text
                      x={(r.x + r.w / 2) * S}
                      y={(r.y + r.h) * S + U * 0.7}
                      textAnchor="middle"
                      className="dims"
                      style={{ fontSize: U * 0.5 }}
                    >
                      {r.w} × {r.h} m
                    </text>
                    <rect
                      className="handle"
                      x={(r.x + r.w) * S - U * 0.45}
                      y={(r.y + r.h) * S - U * 0.45}
                      width={U * 0.6}
                      height={U * 0.6}
                      onPointerDown={(e) => startDrag(e, b, 'resize')}
                    >
                      <title>Drag to resize</title>
                    </rect>
                  </>
                )}
              </g>
            );
          })}
          {hall.amenities.map((a) => (
            <text
              key={a.id}
              className="amenity"
              x={a.x * S}
              y={a.y * S}
              textAnchor={a.x > hall.cols / 2 ? 'end' : 'start'}
              style={{ fontSize: U * 0.55 }}
            >
              {a.label}
            </text>
          ))}
          {hall.gates
            .filter((g) => g.x != null)
            .map((g) => (
              <g key={g.id}>
                <rect x={g.x * S - U * 1.8} y={H - U * 0.15} width={U * 3.6} height={U * 0.3} fill="var(--surface)" />
                <path
                  d={`M ${g.x * S} ${H + U * 1.1} v ${-U * 0.9} m ${-U * 0.3} ${U * 0.3} l ${U * 0.3} ${-U * 0.3} l ${U * 0.3} ${U * 0.3}`}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={U * 0.1}
                />
                <text className="gate" x={g.x * S} y={H + U * 1.9} textAnchor="middle" style={{ fontSize: U * 0.65 }}>
                  {g.name} entry
                </text>
              </g>
            ))}
          {here && here.zoneId === hall.id && (
            <g className="here">
              <circle cx={here.x * S} cy={here.y * S} r={U * 0.4} />
              <text x={here.x * S + U * 0.65} y={here.y * S + U * 0.25} style={{ fontSize: U * 0.7 }}>
                You are here
              </text>
            </g>
          )}
        </svg>
      ) : (
        <div className="list" role="list" aria-label={`Stalls in ${hall.name}`}>
          {hall.booths.map((b) => (
            <button
              key={b.id}
              role="listitem"
              className="list-row"
              onClick={() => onSelect?.(b)}
              aria-current={b.id === selected ? 'true' : undefined}
            >
              <strong style={{ width: 48 }}>{b.code}</strong>
              <span className="grow">{b.exhibitor || <span className="muted">{tone ? boothLabel(b) : 'Not allocated'}</span>}</span>
              <span className="muted small num">
                {b.w} × {b.h} m
              </span>
              {b.categories?.length > 0 && <span className="muted small">{b.categories.join(', ')}</span>}
            </button>
          ))}
          {hall.amenities.map((a) => (
            <div key={`a${a.id}`} role="listitem">
              <span style={{ width: 48 }} className="muted">
                —
              </span>
              <span className="grow">{a.label}</span>
              {a.accessible && <Status tone="ok">Step-free</Status>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Sessions grouped by day, with rooms, tracks and (when signed in) bookmarks.
export function AgendaList({ agenda, days, bookmarks, onToggle, track, compact }) {
  const sessions = agenda.sessions.filter(
    (s) => s.status === 'scheduled' && (!track || s.trackId === track) && (!days || days.includes(s.day)),
  );
  const byDay = Object.groupBy ? Object.groupBy(sessions, (s) => s.day) : sessions.reduce((a, s) => ((a[s.day] ||= []).push(s), a), {});
  if (!sessions.length) return <p className="empty">No sessions to show.</p>;
  return (
    <div className="stack">
      {Object.entries(byDay).map(([d, list]) => (
        <section key={d} aria-label={weekday(d)}>
          {!compact && <h3 style={{ marginBottom: 8 }}>{weekday(d)}</h3>}
          <div className="panel list">
            {list.map((s) => {
              const marked = bookmarks?.includes(s.id);
              return (
                <div key={s.id} style={{ alignItems: 'flex-start' }}>
                  <div style={{ width: 96, flex: 'none' }} className="num">
                    <strong>{s.startTime}</strong>
                    <span className="muted">–{s.endTime}</span>
                  </div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{s.title}</div>
                    <div className="muted small">{[s.room, s.track].filter(Boolean).join(' · ')}</div>
                    {s.speakers.length > 0 && (
                      <div className="small">{s.speakers.map((p) => (p.title ? `${p.name}, ${p.title}` : p.name)).join('; ')}</div>
                    )}
                    {!compact && s.description && (
                      <p className="muted small" style={{ marginTop: 4 }}>
                        {s.description}
                      </p>
                    )}
                  </div>
                  {s.full && <Status tone="pending">Full</Status>}
                  {onToggle && (
                    <button
                      className="btn plain"
                      onClick={() => onToggle(s, !marked)}
                      aria-pressed={marked}
                      aria-label={`${marked ? 'Remove bookmark for' : 'Bookmark'} ${s.title}`}
                    >
                      {marked ? <BookmarkCheck /> : <Bookmark />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
