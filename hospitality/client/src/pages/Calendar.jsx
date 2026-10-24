// Booking calendar: one row per room grouped by room type, availability per type and an
// occupancy heat row, reservation segments (arrival / continuation markers), out-of-order
// blocks, unassigned reservations and drag-and-drop moves. Every drop is validated by the
// server (room lock, inventory, room type); a rejected move snaps back with the reason.
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarDays, Plus, RefreshCw, Wrench, Users } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, usePref } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { addDays, diffDays, dow } from '../lib/dates.js';
import { date, dayName, money, statusLabel } from '../lib/format.js';
import { Async, Badge, Button, Card, Confirm, Field, Input, Modal, Notice, PageHead, Select, Seg, StatusBadge, useAction } from '../components/ui.jsx';
import { heat, heatText } from '../components/charts.jsx';
import { BookingForm } from '../components/BookingForm.jsx';

const CELL = { 7: 120, 14: 64, 31: 40 };

export default function Calendar() {
  const { property, opProperty, properties, setScope, can } = useApp();
  const [params] = useSearchParams();
  const urlProp = params.get('property');
  const prop = (urlProp && properties.find((p) => String(p.id) === urlProp)) || property || opProperty;
  const [days, setDays] = usePref('cal-days', 14);
  const [from, setFrom] = useState(() => addDays(prop?.business_date || new Date().toISOString().slice(0, 10), -2));
  const q = useApi(prop ? `/calendar${qs({ property: prop.id, from, days })}` : null);
  const [selected, setSelected] = useState(null);
  const [create, setCreate] = useState(null);
  const [pending, setPending] = useState(null); // a move awaiting confirmation (room type change)
  const [blockFor, setBlockFor] = useState(null);
  const [run] = useAction();
  const { toast } = useApp();

  const move = useCallback(
    async (seg, roomId, arrival, extra = {}) => {
      const body = { roomId, version: seg.version, ...extra };
      if (arrival && arrival !== seg.arrival && seg.status === 'confirmed') body.arrival = arrival;
      if (!body.arrival && roomId === seg.roomId) return;
      try {
        await api.post(`/reservations/${seg.reservationId}/move`, body);
        toast(`${seg.confNo} moved`, 'good');
        q.reload();
      } catch (e) {
        if (e.code === 'room_type_mismatch') setPending({ seg, roomId, arrival, message: e.message });
        else if (e.code === 'sold_out' && can('reservations.override')) setPending({ seg, roomId, arrival, message: e.message, overbook: true });
        else {
          toast(e.message, 'error');
          q.reload();
        }
      }
    },
    [q, toast, can],
  );

  if (!prop) return null;
  return (
    <>
      <PageHead title="Booking Calendar" sub={`${prop.name} · drag a booking to move it; click an empty cell to book`}>
        {properties.length > 1 && (
          <Select aria-label="Property" value={prop.id} onChange={(e) => setScope(e.target.value)} options={properties.map((p) => ({ value: p.id, label: p.name }))} />
        )}
        <Button icon={ChevronLeft} aria-label="Earlier" onClick={() => setFrom(addDays(from, -Math.max(7, Math.floor(days / 2))))} />
        <Button icon={CalendarDays} onClick={() => setFrom(addDays(prop.business_date, -2))}>
          Today
        </Button>
        <Button icon={ChevronRight} aria-label="Later" onClick={() => setFrom(addDays(from, Math.max(7, Math.floor(days / 2))))} />
        <Input type="date" aria-label="Start date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <Seg value={days} onChange={setDays} options={[{ value: 7, label: 'Week' }, { value: 14, label: '2 weeks' }, { value: 31, label: 'Month' }]} label="View" />
        <Button icon={RefreshCw} aria-label="Refresh" onClick={q.reload} />
        {can('reservations.create') && (
          <Button variant="accent" icon={Plus} onClick={() => setCreate({})}>
            New booking
          </Button>
        )}
      </PageHead>
      <Async q={q}>
        {(t) => (
          <Timeline
            t={t}
            cell={CELL[days] || 64}
            onSelect={setSelected}
            selected={selected}
            onMove={move}
            onCreate={(room, night) => can('reservations.create') && setCreate({ roomId: room.id, roomTypeId: room.room_type_id, arrival: night, departure: addDays(night, 1) })}
          />
        )}
      </Async>
      {selected && q.data && (
        <SegmentPanel
          seg={selected}
          t={q.data}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            q.reload();
          }}
          onMove={move}
          onBlock={can('rooms.block') ? setBlockFor : null}
        />
      )}
      {create && (
        <BookingForm
          initial={create}
          onClose={() => setCreate(null)}
          onCreated={() => {
            setCreate(null);
            q.reload();
          }}
        />
      )}
      {pending && (
        <Confirm
          title={pending.overbook ? 'Overbook this room type?' : 'Move to a different room type?'}
          message={pending.message}
          confirmLabel={pending.overbook ? 'Overbook (manager)' : 'Move as an upgrade / change'}
          onClose={() => {
            setPending(null);
            q.reload();
          }}
          onConfirm={() =>
            run(async () => {
              const p = pending;
              setPending(null);
              await move(p.seg, p.roomId, p.arrival, p.overbook ? { allowOverbooking: true, allowTypeChange: true } : { allowTypeChange: true });
            })
          }
        >
          <p className="small muted">The booked room type and rate stay the same; inventory is counted against the room actually assigned.</p>
        </Confirm>
      )}
      {blockFor && (
        <BlockForm
          room={blockFor}
          defaultStart={prop.business_date}
          onClose={() => setBlockFor(null)}
          onDone={() => {
            setBlockFor(null);
            q.reload();
          }}
        />
      )}
    </>
  );
}

function Timeline({ t, cell: minCell, onSelect, selected, onMove, onCreate }) {
  const [drag, setDrag] = useState(null); // { seg, offset }
  const [over, setOver] = useState(null); // { roomId, night }
  const label = 150;
  // Cells stretch to fill the available width (never narrower than the view's minimum).
  const [boxWidth, setBoxWidth] = useState(0);
  const boxRef = useCallback((el) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(e.contentRect.width));
    ro.observe(el);
  }, []);
  const cell = Math.max(minCell, Math.floor((boxWidth - label - 2) / t.nights.length) || minCell);
  const nights = t.nights;
  const idx = useMemo(() => new Map(nights.map((n, i) => [n, i])), [nights]);
  const byType = useMemo(() => {
    const m = new Map(t.roomTypes.map((rt) => [rt.id, []]));
    for (const r of t.rooms) m.get(r.room_type_id)?.push(r);
    return m;
  }, [t]);
  const segByRoom = useMemo(() => {
    const m = new Map();
    for (const s of t.segments) (m.get(s.roomId) || m.set(s.roomId, []).get(s.roomId)).push(s);
    return m;
  }, [t]);
  const blockByRoom = useMemo(() => {
    const m = new Map();
    for (const b of t.blocks) (m.get(b.roomId) || m.set(b.roomId, []).get(b.roomId)).push(b);
    return m;
  }, [t]);
  const over14 = new Set(t.overbooked.map((o) => `${o.roomTypeId}|${o.night}`));
  const pos = (start, end) => {
    const a = Math.max(0, idx.has(start) ? idx.get(start) : start < nights[0] ? 0 : nights.length);
    const b = Math.min(nights.length, idx.has(end) ? idx.get(end) : end > nights[nights.length - 1] ? nights.length : 0);
    return { left: label + a * cell + 2, width: Math.max(0, (b - a) * cell - 4), clipLeft: start < nights[0], clipRight: end > addDays(nights[nights.length - 1], 1) };
  };
  const canDropHere = (room, night) => {
    if (!drag) return null;
    const s = drag.seg;
    const len = diffDays(s.start, s.end);
    const start = s.status === 'in_house' ? s.start : addDays(night, -drag.offset);
    const end = addDays(start, len);
    const clash = (segByRoom.get(room.id) || []).some((x) => x.reservationId !== s.reservationId && x.start < end && start < x.end);
    const blocked = (blockByRoom.get(room.id) || []).some((b) => b.start < end && start < b.end);
    return !(clash || blocked);
  };
  const width = label + nights.length * cell;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="cal-legend">
        <span>
          <span className="swatch" style={{ background: '#2a78d6' }} /> Confirmed
        </span>
        <span>
          <span className="swatch" style={{ background: '#1e9e55' }} /> In house
        </span>
        <span>
          <span className="swatch" style={{ background: '#8a94a6' }} /> Departed
        </span>
        <span>
          <span className="swatch" style={{ background: '#fff', border: '1.5px dashed #2a78d6' }} /> Quote
        </span>
        <span>
          <span className="swatch" style={{ background: 'repeating-linear-gradient(135deg,#fbe4e5 0 3px,#fff 3px 6px)', border: '1px solid #f1c4c6' }} /> Out of order / service
        </span>
        <span>Rounded left edge = arrival · square edge = continues</span>
        {t.overbooked.length > 0 && <Badge tone="danger">Overbooked on {t.overbooked.length} type-night(s)</Badge>}
      </div>
      {t.unassigned.length > 0 && <Unassigned t={t} onSelect={onSelect} setDrag={setDrag} setOver={setOver} />}
      <div className="cal" ref={boxRef} style={{ '--cell': `${cell}px`, '--label': `${label}px` }}>
        <div className="cal-grid" style={{ width }}>
          <div className="cal-row cal-head">
            <div className="cal-label">Rooms</div>
            {nights.map((n) => (
              <div key={n} className={`cal-day ${[5, 6].includes(dow(n)) ? 'weekend' : ''} ${n === t.property.businessDate ? 'today' : ''}`}>
                <span>{dayName(n)}</span>
                <b>{n.slice(8)}</b>
                {cell >= 56 && <span>{date(n, { year: false }).split(' ')[1]}</span>}
              </div>
            ))}
          </div>
          <div className="cal-row" style={{ height: 28 }}>
            <div className="cal-label small muted">Occupancy</div>
            {t.occupancy.map((o) => {
              const v = o.total ? o.sold / o.total : null;
              return (
                <div key={o.night} className="occ-cell" style={{ background: heat(v), color: heatText(v) }} title={`${date(o.night)}: ${o.sold} of ${o.total} rooms sold, ${o.blocked} out of order`}>
                  {o.pct == null ? '—' : `${Math.round(o.pct)}%`}
                </div>
              );
            })}
          </div>
          {t.roomTypes.map((rt) => (
            <div key={rt.id}>
              <div className="cal-row cal-type-row">
                <div className="cal-label">
                  <span className="swatch" style={{ background: rt.color || 'var(--series-1)' }} />
                  {rt.name}
                </div>
                {rt.availability.map((a, i) => {
                  const bad = a.available < 0;
                  return (
                    <div
                      key={i}
                      className={`cal-avail ${bad || a.available === 0 ? 'none' : a.available <= 2 ? 'low' : ''}`}
                      title={`${date(nights[i])}: ${a.available} available of ${a.sellable} sellable (${a.consumed} sold${a.blocked ? `, ${a.blocked} blocked` : ''})${over14.has(`${rt.id}|${nights[i]}`) ? ' — OVERBOOKED' : ''}`}
                    >
                      {a.available}
                    </div>
                  );
                })}
              </div>
              {(byType.get(rt.id) || []).map((room) => (
                <div className="cal-row" key={room.id}>
                  <div className="cal-label">
                    <Link to={`/rooms/${room.id}`} className="strong" style={{ color: 'var(--text)' }}>
                      {room.number}
                    </Link>
                    <span className="faint small">F{room.floor_level}</span>
                    {room.hk_status === 'dirty' && <span className="badge warn" style={{ height: 18 }} title="Dirty">D</span>}
                    {room.accessible ? <span className="faint small" title="Accessible room">♿</span> : null}
                  </div>
                  {nights.map((n) => {
                    const ok = over?.roomId === room.id && over?.night === n ? canDropHere(room, n) : null;
                    return (
                      <div
                        key={n}
                        className={`cal-cell ${[5, 6].includes(dow(n)) ? 'weekend' : ''} ${n === t.property.businessDate ? 'today' : ''} ${ok === true ? 'drop-ok' : ok === false ? 'drop-bad' : ''}`}
                        onDragOver={(e) => {
                          if (!drag) return;
                          e.preventDefault();
                          if (over?.roomId !== room.id || over?.night !== n) setOver({ roomId: room.id, night: n });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!drag) return;
                          const s = drag.seg;
                          const arrival = s.status === 'in_house' || s.assignOnly ? null : addDays(n, -drag.offset);
                          setDrag(null);
                          setOver(null);
                          onMove({ ...s, arrival: s.arrival }, room.id, arrival);
                        }}
                        onDoubleClick={() => onCreate(room, n)}
                        onClick={(e) => e.detail === 1 && e.target === e.currentTarget && !drag && onCreate(room, n)}
                      />
                    );
                  })}
                  {(blockByRoom.get(room.id) || []).map((b) => {
                    const p = pos(b.start, b.end);
                    return p.width > 0 ? (
                      <div key={`b${b.id}-${b.start}`} className={`cal-block ${b.kind}`} style={{ left: p.left, width: p.width }} title={`${b.kind === 'ooo' ? 'Out of order' : 'Out of service'}: ${b.reason}`}>
                        <Wrench size={11} style={{ marginRight: 4 }} /> {b.reason}
                      </div>
                    ) : null;
                  })}
                  {(segByRoom.get(room.id) || []).map((s) => {
                    const p = pos(s.start, s.end);
                    if (p.width <= 0) return null;
                    const cls = [
                      'cal-seg',
                      s.status,
                      s.bookingRooms > 1 ? 'group' : '',
                      s.startsHere && !p.clipLeft ? 'arr' : 'cont-left',
                      s.endsHere && !p.clipRight ? '' : 'cont-right',
                      selected?.reservationId === s.reservationId ? 'selected' : '',
                    ].join(' ');
                    return (
                      <button
                        type="button"
                        key={`${s.reservationId}-${s.start}`}
                        className={cls}
                        style={{ left: p.left, width: p.width }}
                        draggable={['confirmed', 'in_house'].includes(s.status)}
                        onDragStart={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const offset = Math.max(0, Math.floor((e.clientX - rect.left) / cell)) + Math.max(0, diffDays(s.start, nights[0]));
                          e.dataTransfer.setData('text/plain', String(s.reservationId));
                          e.dataTransfer.effectAllowed = 'move';
                          setDrag({ seg: s, offset: Math.min(offset, diffDays(s.start, s.end) - 1) });
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setOver(null);
                        }}
                        onClick={() => onSelect(s)}
                        title={`${s.guest} · ${s.confNo} · ${statusLabel(s.status)} · ${date(s.arrival)} – ${date(s.departure)} · ${s.adults}A${s.children ? ` ${s.children}C` : ''}${s.groupName ? ` · ${s.groupName}` : ''}`}
                      >
                        {s.bookingRooms > 1 && <Users size={11} />}
                        {s.vip ? '★ ' : ''}
                        {s.guest}
                        {cell * diffDays(s.start, s.end) > 150 && <span style={{ opacity: 0.8, fontWeight: 500 }}> · {s.adults + s.children}p</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Reservations without a room for some nights in the window, grouped by arrival date. Future
// bookings are normally assigned on the day of arrival, so this is collapsed by default.
function Unassigned({ t, onSelect, setDrag, setOver }) {
  const [open, setOpen] = usePref('cal-unassigned-open', false);
  const today = t.unassigned.filter((u) => u.arrival <= t.property.businessDate).length;
  const groups = useMemo(() => {
    const m = new Map();
    for (const u of [...t.unassigned].sort((a, b) => a.arrival.localeCompare(b.arrival))) (m.get(u.arrival) || m.set(u.arrival, []).get(u.arrival)).push(u);
    return [...m.entries()];
  }, [t.unassigned]);
  return (
    <div className="card" style={{ padding: '10px 14px' }}>
      <div className="row">
        <b>Unassigned reservations</b>
        <Badge tone={today ? 'warn' : ''}>{t.unassigned.length} in view</Badge>
        {today > 0 && <Badge tone="danger">{today} arriving today without a room</Badge>}
        <span className="small muted">Drag one onto a room row to assign it; future arrivals are usually assigned on the day.</span>
        <span className="spacer" />
        <Button size="sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</Button>
      </div>
      {open && (
        <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 10 }} className="stack">
          {groups.map(([day, list]) => (
            <div key={day} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
              <div className="small strong" style={{ width: 92, flexShrink: 0, paddingTop: 6 }}>
                {dayName(day)} {date(day, { year: false })}
              </div>
              <div className="unassigned-list">
                {list.map((u) => (
                  <div
                    key={u.reservationId}
                    className="unassigned-chip"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(u.reservationId));
                      setDrag({ seg: { ...u, start: u.nights[0], end: addDays(u.nights[u.nights.length - 1], 1), roomId: null, assignOnly: true }, offset: 0 });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onClick={() => onSelect({ ...u, start: u.nights[0], end: addDays(u.nights[u.nights.length - 1], 1), roomId: null })}
                    title={`${u.confNo} · ${date(u.arrival)} – ${date(u.departure)}`}
                  >
                    <b>{u.guest}</b> · {t.roomTypes.find((rt) => rt.id === u.roomTypeId)?.code} · {diffDays(u.arrival, u.departure)}n
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SegmentPanel({ seg, t, onClose, onChanged, onMove, onBlock }) {
  const { can } = useApp();
  const [run, busy] = useAction();
  const sameType = t.rooms.filter((r) => r.room_type_id === seg.roomTypeId);
  const [roomId, setRoomId] = useState(seg.roomId || '');
  const [arrival, setArrival] = useState(seg.arrival);
  const [splitFrom, setSplitFrom] = useState(seg.status === 'in_house' ? t.property.businessDate : addDays(seg.arrival, 1));
  const [splitRoom, setSplitRoom] = useState('');
  const room = t.rooms.find((r) => r.id === seg.roomId);
  const ccy = t.property.currency;
  return (
    <Modal title={`${seg.guest} · ${seg.confNo}`} onClose={onClose} size="lg">
      <div className="grid g2">
        <div className="dl">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={seg.status} />
          </dd>
          <dt>Stay</dt>
          <dd>
            {date(seg.arrival)} – {date(seg.departure)} ({diffDays(seg.arrival, seg.departure)} nights)
          </dd>
          <dt>Room</dt>
          <dd>{room ? `${room.number} (${t.roomTypes.find((x) => x.id === room.room_type_id)?.name})` : 'Unassigned'}</dd>
          <dt>Guests</dt>
          <dd>
            {seg.adults} adults{seg.children ? `, ${seg.children} children` : ''}
          </dd>
          <dt>Source</dt>
          <dd>{seg.channel || seg.source}</dd>
          <dt>Rate plan</dt>
          <dd>{seg.ratePlan || 'Manual rate'}</dd>
          {seg.totalMinor != null && (
            <>
              <dt>Room total</dt>
              <dd className="num">{money(seg.totalMinor, ccy)}</dd>
              <dt>Folio balance</dt>
              <dd className="num">{money(seg.balanceMinor, ccy)}</dd>
            </>
          )}
          {seg.groupName && (
            <>
              <dt>Group</dt>
              <dd>
                {seg.groupName} ({seg.bookingRooms} rooms)
              </dd>
            </>
          )}
          {seg.split && (
            <>
              <dt>Split stay</dt>
              <dd>This room holds {date(seg.start)} – {date(seg.end)}</dd>
            </>
          )}
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {can('reservations.modify') && ['confirmed', 'in_house'].includes(seg.status) && (
            <Card title={seg.status === 'in_house' ? 'Change room' : 'Move or reassign'}>
              <div className="stack" style={{ gap: 10 }}>
                <Field label="Room">
                  <Select value={roomId} placeholder="Choose room" options={t.rooms.map((r) => ({ value: r.id, label: `${r.number} · ${t.roomTypes.find((x) => x.id === r.room_type_id)?.code}${r.room_type_id !== seg.roomTypeId ? ' (other type)' : ''}` }))} onChange={(e) => setRoomId(Number(e.target.value))} />
                </Field>
                {seg.status === 'confirmed' && (
                  <Field label="Arrival (keeps the length of stay)">
                    <Input type="date" value={arrival} min={t.property.businessDate} onChange={(e) => setArrival(e.target.value)} />
                  </Field>
                )}
                <Button variant="primary" busy={busy} disabled={!roomId} onClick={() => run(async () => onMove({ ...seg, roomId: seg.roomId }, Number(roomId), arrival).then(onClose))}>
                  Apply
                </Button>
                {seg.status === 'in_house' && <div className="small muted">For a guest in the house, use Front Desk → Room move so the old room is sent for cleaning.</div>}
              </div>
            </Card>
          )}
          {can('reservations.modify') && seg.status === 'confirmed' && diffDays(seg.arrival, seg.departure) > 1 && (
            <Card title="Split stay" sub="Move part of the stay to another room">
              <div className="stack" style={{ gap: 10 }}>
                <Field label="From night">
                  <Input type="date" value={splitFrom} min={addDays(seg.arrival, 1)} max={addDays(seg.departure, -1)} onChange={(e) => setSplitFrom(e.target.value)} />
                </Field>
                <Field label="Room">
                  <Select value={splitRoom} placeholder="Choose room" options={sameType.filter((r) => r.id !== seg.roomId).map((r) => ({ value: r.id, label: r.number }))} onChange={(e) => setSplitRoom(e.target.value)} />
                </Field>
                <Button
                  busy={busy}
                  disabled={!splitRoom}
                  onClick={() =>
                    run(async () => {
                      await api.post(`/reservations/${seg.reservationId}/assign`, { roomId: Number(splitRoom), from: splitFrom });
                      onChanged();
                    }, { success: 'Stay split across two rooms' })
                  }
                >
                  Split
                </Button>
              </div>
            </Card>
          )}
          {!['confirmed', 'in_house'].includes(seg.status) && <Notice>Departed stays are history and cannot be moved.</Notice>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <Link className="btn" to={`/reservations/${seg.reservationId}`}>
          Open reservation
        </Link>
        {seg.status === 'confirmed' && seg.arrival === t.property.businessDate && (
          <Link className="btn primary" to={`/front-desk?checkin=${seg.reservationId}`}>
            Check in
          </Link>
        )}
        {seg.roomId && seg.status === 'confirmed' && can('reservations.modify') && (
          <Button
            busy={busy}
            onClick={() =>
              run(async () => {
                await api.post(`/reservations/${seg.reservationId}/unassign`, {});
                onChanged();
              }, { success: 'Room released; booking is now unassigned' })
            }
          >
            Unassign room
          </Button>
        )}
        <span className="spacer" />
        {onBlock && room && (
          <Button variant="ghost" icon={Wrench} onClick={() => onBlock(room)}>
            Block room {room.number}
          </Button>
        )}
      </div>
    </Modal>
  );
}

export function BlockForm({ room, defaultStart, onClose, onDone }) {
  const [f, setF] = useState({ kind: 'ooo', startDate: defaultStart, endDate: addDays(defaultStart, 1), reason: '' });
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  return (
    <Modal
      title={`Block room ${room.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!f.reason}
            onClick={() =>
              run(
                async () => {
                  await api.post(`/rooms/${room.id}/blocks`, f);
                  onDone();
                },
                { success: 'Room blocked', onError: setErr },
              )
            }
          >
            Block room
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Type">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: 'ooo', label: 'Out of order (repairs)' }, { value: 'oos', label: 'Out of service (short term)' }]} />
        </Field>
        <div />
        <Field label="First night">
          <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <Field label="Back in service on">
          <Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        </Field>
        <Field label="Reason" className="span2">
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. AC compressor replacement" />
        </Field>
      </div>
      {err && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="danger">
            {err.message}
            {err.details?.reservations?.length ? ` (${err.details.reservations.map((r) => r.conf_no).join(', ')})` : ''}
          </Notice>
        </div>
      )}
    </Modal>
  );
}
