// Pieces shared by the public site, the consoles and the displays: the pass card, the 2D hall
// plan with its accessible list view, and the agenda list.
import { useState } from 'react';
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

const CELL = 100;
// 2D plan of one hall. Booths are keyboard-focusable buttons; `tone(booth)` picks the style
// (free, held, blocked, sel). The list view carries the same information as text.
export function HallPlan({ halls, selected, onSelect, tone, here, label, startView = 'map' }) {
  const drawable = halls.filter((h) => h.cols > 0);
  const [zoneId, setZoneId] = useState(
    () => here?.zoneId ?? drawable.find((h) => h.booths.some((b) => b.id === selected))?.id ?? drawable[0]?.id,
  );
  const [view, setView] = useState(startView);
  const hall = drawable.find((h) => h.id === zoneId) || drawable[0];
  if (!hall) return <p className="empty">No hall plan has been published yet.</p>;
  const boothLabel = label || ((b) => (b.exhibitor ? `Booth ${b.code}, ${b.exhibitor}` : `Booth ${b.code}`));
  const toneOf = (b) => (b.id === selected ? 'sel' : tone ? tone(b) : b.exhibitor ? '' : 'free');
  const W = hall.cols * CELL;
  const H = hall.rows * CELL;
  return (
    <div className="plan">
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        {drawable.length > 1 ? (
          <Tabs tabs={drawable.map((h) => ({ value: h.id, label: h.name }))} value={hall.id} onChange={setZoneId} />
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
        <svg viewBox={`-40 -40 ${W + 80} ${H + 110}`} role="group" aria-label={`Plan of ${hall.name}`}>
          <rect className="wall" x="0" y="0" width={W} height={H} rx="8" />
          {hall.booths.map((b) => (
            <g
              key={b.id}
              className={`booth ${toneOf(b)}`}
              role="button"
              tabIndex={0}
              aria-label={boothLabel(b)}
              aria-pressed={b.id === selected}
              onClick={() => onSelect?.(b)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect?.(b))}
            >
              <rect x={b.x * CELL + 6} y={b.y * CELL + 6} width={b.w * CELL - 12} height={b.h * CELL - 12} rx="4" />
              <text x={b.x * CELL + (b.w * CELL) / 2} y={b.y * CELL + (b.h * CELL) / 2 + 10} textAnchor="middle">
                {b.code}
              </text>
            </g>
          ))}
          {hall.amenities.map((a) => (
            <text key={a.id} className="amenity" x={a.x * CELL} y={a.y * CELL} textAnchor={a.x > hall.cols / 2 ? 'end' : 'start'}>
              {a.label}
            </text>
          ))}
          {hall.gates
            .filter((g) => g.x != null)
            .map((g) => (
              <g key={g.id}>
                <rect x={g.x * CELL - 70} y={H - 6} width="140" height="12" fill="#fff" />
                <path d={`M ${g.x * CELL} ${H + 40} v -34 m -12 12 l 12 -12 l 12 12`} fill="none" stroke="#20262B" strokeWidth="4" />
                <text className="gate" x={g.x * CELL} y={H + 66} textAnchor="middle">
                  {g.name} entry
                </text>
              </g>
            ))}
          {here && here.zoneId === hall.id && (
            <g className="here">
              <circle cx={here.x * CELL} cy={here.y * CELL} r="16" />
              <text x={here.x * CELL + 26} y={here.y * CELL + 10}>
                You are here
              </text>
            </g>
          )}
        </svg>
      ) : (
        <div className="list" role="list" aria-label={`Booths in ${hall.name}`}>
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
