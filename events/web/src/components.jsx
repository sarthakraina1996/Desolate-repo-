// Pieces shared by the public site, the consoles and the displays: the pass card, the 2D hall
// plan with its accessible list view, and the agenda list.
import { useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, ZoomIn, ZoomOut } from 'lucide-react';
import { Qr, Status, useImage } from './ui.jsx';
import { dateRange, nowHM, todayISO, weekday } from './format.js';

// The pass as shown to its holder, laid out like a printed ticket: event band, holder and
// access, then a tear-off stub with a large, quiet QR code.
export function PassCard({ pass }) {
  const e = pass.event;
  return (
    <article className="ticket" aria-label={`${pass.passClass.name} pass for ${pass.holderName}`}>
      <header className="ticket-top">
        <div className="row between top">
          <div className="grow">
            <div className="ticket-event">{e.name}</div>
            <div className="ticket-when">
              {dateRange(pass.validFrom, pass.validTo)} · {e.openTime}–{e.closeTime}
            </div>
            {e.venueName && <div className="ticket-when">{e.venueName}</div>}
          </div>
          <span className="ticket-class">{pass.passClass.name}</span>
        </div>
      </header>
      <div className="ticket-holder">
        <div className="ticket-name">{pass.holderName}</div>
        {pass.holderCompany && <div className="muted">{pass.holderCompany}</div>}
        <dl className="ticket-meta">
          <div>
            <dt>Enter at</dt>
            <dd>{pass.gates.join(', ') || 'Any gate'}</dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>{pass.zones.join(', ') || 'Show floor'}</dd>
          </div>
        </dl>
      </div>
      <div className="ticket-stub">
        {pass.qr ? (
          <Qr text={pass.qr} size={200} alt={`QR code for ${pass.holderName}'s pass`} />
        ) : (
          <p className="notice error">This pass is no longer valid.</p>
        )}
        {pass.ref && <div className="ticket-ref">{pass.ref}</div>}
        {pass.instructions && <p className="ticket-note">{pass.instructions}</p>}
      </div>
    </article>
  );
}

// SVG units per metre of hall. Hall plans, stalls, gates and amenities are all in metres.
const S = 40;
const SNAP = 0.5;
const snap = (v) => Math.round(v / SNAP) * SNAP;

// 2D plan of one hall, drawn to scale over the hall's floor drawing when one was uploaded.
// Stalls are keyboard-focusable buttons; `tone(booth)` picks the style (free, held, blocked,
// sel). The list view carries the same information as text.
// With `onChange`, the plan is editable: drag a stall to move it, drag its corner to resize,
// or use the arrow keys (Shift + arrows resize). Changes snap to 0.5 m.
export function HallPlan({
  halls,
  selected,
  onSelect,
  tone,
  here,
  label,
  startView = 'map',
  zoneId: controlled,
  onZone,
  onChange,
  zoomable,
}) {
  const drawable = halls.filter((h) => h.cols > 0);
  const [own, setOwn] = useState(
    () => here?.zoneId ?? drawable.find((h) => h.booths.some((b) => b.id === selected))?.id ?? drawable[0]?.id,
  );
  const zoneId = controlled ?? own;
  const setZone = (id) => (onZone ? onZone(id) : setOwn(id));
  const [view, setView] = useState(startView);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(null); // { id, mode, start, orig, rect }
  const svgRef = useRef(null);
  const hall = drawable.find((h) => h.id === zoneId) || drawable[0];
  const image = useImage(hall?.image);
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
          <div className="seg" role="group" aria-label="Hall">
            {drawable.map((h) => (
              <button key={h.id} aria-pressed={h.id === hall.id} onClick={() => setZone(h.id)}>
                {h.name}
              </button>
            ))}
          </div>
        ) : (
          <h3>{hall.name}</h3>
        )}
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
            Map
          </button>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
            List
          </button>
        </div>
      </div>
      {view === 'map' ? (
        <div className="plan-view">
          {zoomable && (
            <div className="zoom" role="group" aria-label="Zoom">
              <button onClick={() => setZoom(Math.min(3.25, zoom + 0.75))} disabled={zoom >= 3.25} aria-label="Zoom in">
                <ZoomIn className="icon" />
              </button>
              <button onClick={() => setZoom(Math.max(1, zoom - 0.75))} disabled={zoom <= 1} aria-label="Zoom out">
                <ZoomOut className="icon" />
              </button>
            </div>
          )}
          <div className="plan-scroll">
            <svg
              style={{ width: `${zoom * 100}%` }}
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
          </div>
        </div>
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

// Colours for agenda tracks, in the order the organiser created them.
const TRACK_COLOURS = ['#233e85', '#c82026', '#0f766e', '#b45309', '#6d28d9', '#0369a1'];
export const trackColour = (agenda, id) => {
  const i = agenda.tracks.findIndex((t) => t.id === id);
  return i < 0 ? 'var(--control)' : TRACK_COLOURS[i % TRACK_COLOURS.length];
};

// Sessions grouped by day, with rooms, tracks, an "on now" mark and (when signed in) bookmarks.
export function AgendaList({ agenda, days, bookmarks, onToggle, track, compact }) {
  const sessions = agenda.sessions.filter(
    (s) => s.status === 'scheduled' && (!track || s.trackId === track) && (!days || days.includes(s.day)),
  );
  const byDay = sessions.reduce((a, s) => ((a[s.day] ||= []).push(s), a), {});
  if (!sessions.length) return <p className="empty">No sessions to show.</p>;
  const today = todayISO();
  const now = nowHM();
  return (
    <div className="stack">
      {Object.entries(byDay).map(([d, list]) => (
        <section key={d} aria-label={weekday(d)}>
          {!compact && (!days || days.length > 1) && <h3 style={{ marginBottom: 8 }}>{weekday(d)}</h3>}
          <div className="group">
            {list.map((s) => {
              const marked = bookmarks?.includes(s.id);
              const live = d === today && s.startTime <= now && now < s.endTime;
              return (
                <div key={s.id} className="session" style={{ '--track': trackColour(agenda, s.trackId) }}>
                  <div className="session-time num">
                    <strong>{s.startTime}</strong>
                    <span>{s.endTime}</span>
                  </div>
                  <div className="grow">
                    {(live || s.full) && (
                      <div className="row" style={{ gap: 6, marginBottom: 2 }}>
                        {live && <span className="live-tag">On now</span>}
                        {s.full && <Status tone="pending">Full</Status>}
                      </div>
                    )}
                    <div className="session-title">{s.title}</div>
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
                  {onToggle && (
                    <button
                      className={`icon-btn ${marked ? 'on' : ''}`}
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
