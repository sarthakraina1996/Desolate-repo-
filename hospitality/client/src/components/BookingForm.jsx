// New booking: guest (existing or new), one or more room lines with live price, availability
// and restriction checks from the server, source/channel/company and guarantee.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { api, newIdempotencyKey, qs } from '../lib/api.js';
import { useApi, useDebounced } from '../lib/hooks.js';
import { useApp } from '../context.jsx';
import { addDays, diffDays } from '../lib/dates.js';
import { money } from '../lib/format.js';
import { Button, Field, Input, Modal, Notice, Select, Textarea, useAction } from './ui.jsx';

const SOURCES = ['Direct', 'Website', 'Phone', 'Walk-in', 'Corporate', 'Group', 'Travel Agent', 'OTA'];
const CHANNELS = ['Booking.com', 'Expedia', 'Agoda', 'MakeMyTrip'];

function GuestPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const res = useApi(dq.length >= 2 ? `/guests${qs({ q: dq, limit: 8 })}` : null);
  if (value?.id)
    return (
      <div className="chip" style={{ justifyContent: 'space-between' }}>
        <span>
          <b>
            {value.first_name} {value.last_name}
          </b>{' '}
          <span className="muted small">{value.email || value.phone || ''}</span>
        </span>
        <Button size="xs" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  if (value?.new)
    return (
      <div className="form-grid">
        <Field label="First name">
          <Input value={value.first_name || ''} onChange={(e) => onChange({ ...value, first_name: e.target.value })} required />
        </Field>
        <Field label="Last name">
          <Input value={value.last_name || ''} onChange={(e) => onChange({ ...value, last_name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={value.email || ''} onChange={(e) => onChange({ ...value, email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={value.phone || ''} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        </Field>
        <Field label="Country (ISO code)">
          <Input maxLength={2} value={value.country || ''} onChange={(e) => onChange({ ...value, country: e.target.value.toUpperCase() })} placeholder="IN" />
        </Field>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Search existing guests instead
          </Button>
        </div>
      </div>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <Input className="search" style={{ flex: 1 }} placeholder="Search guest by name, email, phone or loyalty number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <Button icon={UserPlus} onClick={() => onChange({ new: true, first_name: q.split(' ')[0] || '', last_name: q.split(' ').slice(1).join(' ') })}>
          New guest
        </Button>
      </div>
      {res.data?.rows?.length > 0 && (
        <div className="card" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {res.data.rows.map((g) => (
            <button key={g.id} type="button" className="menu-row" onClick={() => onChange(g)} style={{ display: 'flex', width: '100%', border: 0, background: 'none', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', gap: 10, borderBottom: '1px solid var(--border)' }}>
              <b>
                {g.first_name} {g.last_name}
              </b>
              <span className="muted small">{[g.email, g.phone, g.company_name].filter(Boolean).join(' · ')}</span>
              <span className="spacer" />
              <span className="small muted">{g.stays} stays</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoomLine({ line, onChange, onRemove, types, plans, rooms, propertyId, currency, canOverride }) {
  const nights = line.arrival && line.departure ? diffDays(line.arrival, line.departure) : 0;
  const ok = line.roomTypeId && line.ratePlanId && nights > 0;
  const quote = useApi(ok ? `/rates/quote${qs({ property: propertyId, roomTypeId: line.roomTypeId, ratePlanId: line.ratePlanId, arrival: line.arrival, departure: line.departure, adults: line.adults, children: line.children })}` : null);
  const typeRooms = rooms.filter((r) => String(r.room_type_id) === String(line.roomTypeId));
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <Field label="Arrival">
          <Input type="date" value={line.arrival} onChange={(e) => onChange({ ...line, arrival: e.target.value, departure: line.departure <= e.target.value ? addDays(e.target.value, 1) : line.departure })} />
        </Field>
        <Field label="Departure" hint={nights > 0 ? `${nights} night${nights > 1 ? 's' : ''}` : undefined}>
          <Input type="date" value={line.departure} min={line.arrival ? addDays(line.arrival, 1) : undefined} onChange={(e) => onChange({ ...line, departure: e.target.value })} />
        </Field>
        <Field label="Adults">
          <Input type="number" min={1} max={8} value={line.adults} onChange={(e) => onChange({ ...line, adults: Number(e.target.value) })} />
        </Field>
        <Field label="Children">
          <Input type="number" min={0} max={6} value={line.children} onChange={(e) => onChange({ ...line, children: Number(e.target.value) })} />
        </Field>
        <Field label="Room type">
          <Select value={line.roomTypeId} placeholder="Choose" options={types.map((t) => ({ value: t.id, label: `${t.name} (${t.room_count})` }))} onChange={(e) => onChange({ ...line, roomTypeId: e.target.value, roomId: '' })} />
        </Field>
        <Field label="Rate plan">
          <Select value={line.ratePlanId} placeholder="Choose" options={plans.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} onChange={(e) => onChange({ ...line, ratePlanId: e.target.value })} />
        </Field>
        <Field label="Room (optional)">
          <Select value={line.roomId || ''} placeholder="Assign later" options={typeRooms.map((r) => ({ value: r.id, label: `${r.number} · ${r.code}` }))} onChange={(e) => onChange({ ...line, roomId: e.target.value })} />
        </Field>
        {canOverride ? (
          <Field label="Manual rate / night" hint="Manager override">
            <Input inputMode="decimal" value={line.rate || ''} onChange={(e) => onChange({ ...line, rate: e.target.value })} placeholder="From rate plan" />
          </Field>
        ) : (
          <div />
        )}
      </div>
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {quote.loading && <span className="small muted">Checking rates and availability…</span>}
        {quote.error && <Notice tone="danger">{quote.error.message}</Notice>}
        {quote.data && !quote.loading && (
          <>
            <span className="small">
              Total <b className="num">{money(line.rate ? Math.round(Number(line.rate) * 100) * nights : quote.data.total_minor, currency)}</b>
              <span className="muted"> · {currency === 'INR' ? 'excl. GST' : 'incl. VAT'}</span>
            </span>
            <span className={`badge ${quote.data.minAvailable > 2 ? 'good' : quote.data.minAvailable > 0 ? 'warn' : 'danger'}`}>
              {quote.data.minAvailable > 0 ? `${quote.data.minAvailable} left at the tightest night` : 'Sold out on at least one night'}
            </span>
            {quote.data.restrictions.map((r) => (
              <span key={r.code + r.night} className="badge danger">
                {r.text}
              </span>
            ))}
          </>
        )}
        <span className="spacer" />
        {onRemove && (
          <Button size="sm" variant="ghost" icon={Trash2} onClick={onRemove}>
            Remove room
          </Button>
        )}
      </div>
    </div>
  );
}

export function BookingForm({ onClose, onCreated, initial = {} }) {
  const { opProperty, property, can } = useApp();
  const prop = property || opProperty;
  const types = useApi(prop ? `/room-types${qs({ property: prop.id })}` : null);
  const plans = useApi(prop ? `/rate-plans${qs({ property: prop.id })}` : null);
  const rooms = useApi(prop ? `/rooms${qs({ property: prop.id })}` : null);
  const companies = useApi('/companies');
  const [guest, setGuest] = useState(null);
  const today = prop?.business_date;
  const blank = useMemo(
    () => ({ arrival: initial.arrival || today, departure: initial.departure || addDays(initial.arrival || today, 1), adults: 2, children: 0, roomTypeId: initial.roomTypeId || '', ratePlanId: '', roomId: initial.roomId || '' }),
    [initial.arrival, initial.departure, initial.roomTypeId, initial.roomId, today],
  );
  const [lines, setLines] = useState([blank]);
  const [meta, setMeta] = useState({ source: 'Direct', channel: '', channelRef: '', companyId: '', segment: 'Leisure', guarantee: 'card', status: 'confirmed', notes: '', specialRequests: '' });
  const [key] = useState(newIdempotencyKey);
  const [run, busy] = useAction();
  const [error, setError] = useState(null);

  useEffect(() => {
    // Default rate plan once plans load.
    if (plans.data && lines.some((l) => !l.ratePlanId)) {
      const bar = plans.data.plans.find((p) => p.code === 'BAR') || plans.data.plans[0];
      if (bar) setLines((ls) => ls.map((l) => (l.ratePlanId ? l : { ...l, ratePlanId: String(bar.id) })));
    }
  }, [plans.data, lines]);

  const submit = () =>
    run(
      async () => {
        setError(null);
        const body = {
          propertyId: prop.id,
          ...(guest?.id ? { guestId: guest.id } : { guest: { ...guest, new: undefined } }),
          source: meta.source,
          channel: meta.source === 'OTA' ? meta.channel : undefined,
          channelRef: meta.source === 'OTA' ? meta.channelRef : undefined,
          companyId: meta.companyId || undefined,
          segment: meta.segment || undefined,
          guarantee: meta.guarantee,
          status: meta.status,
          notes: meta.notes || undefined,
          groupName: lines.length > 1 ? meta.groupName : undefined,
          rooms: lines.map((l) => ({
            roomTypeId: Number(l.roomTypeId),
            ratePlanId: Number(l.ratePlanId),
            arrival: l.arrival,
            departure: l.departure,
            adults: l.adults,
            children: l.children,
            roomId: l.roomId ? Number(l.roomId) : undefined,
            rate: l.rate || undefined,
            specialRequests: meta.specialRequests || undefined,
          })),
        };
        const out = await api.post('/reservations', body, { idempotent: key });
        onCreated?.(out);
        return out;
      },
      { success: (o) => `Booking ${o.booking.ref} ${meta.status === 'quote' ? 'quoted' : 'confirmed'}`, onError: (e) => setError(e) },
    );

  const ready = prop && (guest?.id || guest?.first_name) && lines.every((l) => l.roomTypeId && l.ratePlanId && l.departure > l.arrival);
  const companyKinds = meta.source === 'Corporate' ? ['corporate', 'government'] : meta.source === 'Travel Agent' ? ['travel_agent'] : meta.source === 'OTA' ? ['ota'] : null;
  return (
    <Modal
      title={`New booking — ${prop?.name || ''}`}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <Select value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value })} options={[{ value: 'confirmed', label: 'Confirm now' }, { value: 'quote', label: 'Save as quote (no inventory held)' }]} />
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={submit} busy={busy} disabled={!ready}>
            {meta.status === 'quote' ? 'Save quote' : 'Confirm booking'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div>
          <div className="small strong" style={{ marginBottom: 6 }}>
            Guest
          </div>
          <GuestPicker value={guest} onChange={setGuest} />
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <span className="small strong">Rooms</span>
            <span className="spacer" />
            <Button size="sm" icon={Plus} onClick={() => setLines([...lines, { ...lines[lines.length - 1], roomId: '' }])}>
              Add room
            </Button>
          </div>
          {lines.map((l, i) => (
            <RoomLine
              key={i}
              line={l}
              propertyId={prop?.id}
              currency={prop?.currency}
              types={types.data || []}
              plans={plans.data?.plans || []}
              rooms={rooms.data?.rooms || []}
              canOverride={can('reservations.override')}
              onChange={(nl) => setLines((ls) => ls.map((x, j) => (j === i ? nl : x)))}
              onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((_, j) => j !== i)) : null}
            />
          ))}
          {lines.length > 1 && (
            <Field label="Group / booking name">
              <Input value={meta.groupName || ''} onChange={(e) => setMeta({ ...meta, groupName: e.target.value })} placeholder="e.g. Kapoor wedding" />
            </Field>
          )}
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          <Field label="Source">
            <Select value={meta.source} options={SOURCES.map((s) => ({ value: s, label: s }))} onChange={(e) => setMeta({ ...meta, source: e.target.value, companyId: '' })} />
          </Field>
          {meta.source === 'OTA' && (
            <Field label="Channel">
              <Select value={meta.channel} placeholder="Choose" options={CHANNELS.map((c) => ({ value: c, label: c }))} onChange={(e) => setMeta({ ...meta, channel: e.target.value, companyId: companies.data?.find((c) => c.name === e.target.value)?.id || '' })} />
            </Field>
          )}
          {meta.source === 'OTA' && (
            <Field label="Channel reference">
              <Input value={meta.channelRef} onChange={(e) => setMeta({ ...meta, channelRef: e.target.value })} />
            </Field>
          )}
          {companyKinds && meta.source !== 'OTA' && (
            <Field label={meta.source === 'Travel Agent' ? 'Agent' : 'Company'}>
              <Select value={meta.companyId} placeholder="Choose" options={(companies.data || []).filter((c) => companyKinds.includes(c.kind)).map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => setMeta({ ...meta, companyId: e.target.value })} />
            </Field>
          )}
          <Field label="Segment">
            <Select value={meta.segment} options={['Leisure', 'Corporate', 'Group', 'MICE', 'Government', 'Long stay', 'Crew'].map((s) => ({ value: s, label: s }))} onChange={(e) => setMeta({ ...meta, segment: e.target.value })} />
          </Field>
          <Field label="Guarantee">
            <Select
              value={meta.guarantee}
              options={[
                { value: 'none', label: 'Not guaranteed' },
                { value: 'card', label: 'Card on file (tokenised)' },
                { value: 'deposit', label: 'Deposit' },
                { value: 'company', label: 'Company' },
                { value: 'ota_prepaid', label: 'Prepaid via OTA' },
              ]}
              onChange={(e) => setMeta({ ...meta, guarantee: e.target.value })}
            />
          </Field>
          <Field label="Special requests" className="span2">
            <Input value={meta.specialRequests} onChange={(e) => setMeta({ ...meta, specialRequests: e.target.value })} />
          </Field>
          <Field label="Internal notes" className="span2">
            <Textarea rows={2} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
          </Field>
        </div>
        {error && (
          <Notice tone="danger">
            {error.message}
            {error.code === 'sold_out' && can('reservations.override') && ' — a manager can allow overbooking within the property allowance from the calendar.'}
          </Notice>
        )}
      </div>
    </Modal>
  );
}
