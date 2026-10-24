// Front desk: arrivals / in-house / departures with done/total counts, check-in and checkout
// flows, walk-ins, room moves, guest requests, the cashier shift and the night audit.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRightLeft, BedDouble, ClipboardList, LogIn, LogOut, Moon, Plus, UserPlus, Wallet, Wand2 } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi } from '../lib/hooks.js';
import { api, newIdempotencyKey, qs } from '../lib/api.js';
import { addDays } from '../lib/dates.js';
import { date, dateTime, money, moneyExact, titleCase } from '../lib/format.js';
import { Async, Badge, Button, Card, Confirm, Empty, Field, Input, Menu, Modal, Notice, PageHead, RoomCode, Select, StatusBadge, Tabs, Textarea, useAction } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';

const HK_TONE = { inspected: 'teal', clean: 'good', dirty: 'warn', cleaning: 'violet' };
const ID_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'national_id', label: 'National ID card' },
  { value: 'other', label: 'Other' },
];

export default function FrontDesk() {
  const { property, opProperty, properties, setScope, can } = useApp();
  const [params, setParams] = useSearchParams();
  const urlProp = params.get('property');
  useEffect(() => {
    if (urlProp && properties.some((p) => String(p.id) === urlProp)) setScope(urlProp);
  }, [urlProp, properties, setScope]);
  const prop = property || opProperty;
  const [tab, setTab] = useState(params.get('tab') || 'arrivals');
  const q = useApi(prop ? `/frontdesk/boards${qs({ property: prop.id })}` : null);
  const [modal, setModal] = useState(params.get('checkin') ? { kind: 'checkin', id: Number(params.get('checkin')) } : null);
  const [filter, setFilter] = useState('');
  const close = () => {
    setModal(null);
    if (params.get('checkin')) setParams({});
  };
  const done = () => {
    close();
    q.reload();
  };
  const navigate = useNavigate();
  if (!prop) return null;
  const c = q.data?.counts;
  return (
    <>
      <PageHead title="Front Desk" sub={`${prop.name} · business date ${date(q.data?.businessDate || prop.business_date)}`}>
        {properties.length > 1 && <Select aria-label="Property" value={prop.id} onChange={(e) => setScope(e.target.value)} options={properties.map((p) => ({ value: p.id, label: p.name }))} />}
        <Input className="search" placeholder="Filter guest, room or booking" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }} />
        {can('frontdesk.operate') && (
          <Button variant="accent" icon={UserPlus} onClick={() => setModal({ kind: 'walkin' })}>
            Walk-in
          </Button>
        )}
      </PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'arrivals', label: 'Arrivals', icon: LogIn, count: c ? `${c.arrivals.done}/${c.arrivals.total}` : null },
          { value: 'inhouse', label: 'In house', icon: BedDouble, count: c?.inHouse },
          { value: 'departures', label: 'Departures', icon: LogOut, count: c ? `${c.departures.done}/${c.departures.total}` : null },
          { value: 'requests', label: 'Guest services', icon: ClipboardList },
          ...(can('cashier.operate') ? [{ value: 'cashier', label: 'Cashier', icon: Wallet }] : []),
          ...(can('nightaudit.run') ? [{ value: 'audit', label: 'Night audit', icon: Moon }] : []),
        ]}
      />
      {['arrivals', 'inhouse', 'departures'].includes(tab) && (
        <Async q={q}>
          {(b) => <Board kind={tab} b={b} filter={filter} onAction={(kind, row) => setModal({ kind, id: row.id, row })} onOpen={(row) => navigate(`/reservations/${row.id}`)} reload={q.reload} propertyId={prop.id} />}
        </Async>
      )}
      {tab === 'requests' && <Requests propertyId={prop.id} />}
      {tab === 'cashier' && <Cashier prop={prop} />}
      {tab === 'audit' && <NightAudit prop={prop} onDone={q.reload} />}
      {modal?.kind === 'checkin' && <CheckInModal reservationId={modal.id} onClose={close} onDone={done} />}
      {modal?.kind === 'checkout' && (
        <CheckOutModal
          reservationId={modal.id}
          onClose={close}
          onDone={(out) => {
            done();
            if (out?.invoices?.[0]) navigate(`/invoices/${out.invoices[0].id}`);
          }}
        />
      )}
      {modal?.kind === 'move' && <RoomMoveModal reservationId={modal.id} onClose={close} onDone={done} />}
      {modal?.kind === 'walkin' && <WalkInModal prop={prop} onClose={close} onDone={(r) => { close(); navigate(`/reservations/${r.id}`); }} />}
    </>
  );
}

function Board({ kind, b, filter, onAction, onOpen, reload, propertyId }) {
  const { can } = useApp();
  const [run, busy] = useAction();
  const rows = (kind === 'arrivals' ? b.arrivals : kind === 'inhouse' ? b.inHouse : b.departures).filter((r) => {
    if (!filter) return true;
    const s = `${r.first_name} ${r.last_name} ${r.conf_no} ${r.room_number || ''}`.toLowerCase();
    return s.includes(filter.toLowerCase());
  });
  const unassigned = kind === 'arrivals' && b.arrivals.some((a) => a.status === 'confirmed' && !a.room_number);
  return (
    <Card flush>
      {kind === 'arrivals' && (
        <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span className="small muted">
            {b.property.inspection_required ? 'Rooms must be inspected before check-in.' : 'Clean rooms are ready for check-in.'}{' '}
            {b.property.require_id_at_checkin ? 'An identity document is recorded at check-in.' : ''}
          </span>
          <span className="spacer" />
          {unassigned && can('frontdesk.operate') && (
            <Button size="sm" icon={Wand2} busy={busy} onClick={() => run(async () => { const r = await api.post('/reservations/auto-assign', { propertyId }); reload(); return r; }, { success: (r) => `Assigned ${r.assigned.length} room(s)${r.unassigned.length ? `; ${r.unassigned.length} could not be assigned` : ''}` })}>
              Auto-assign rooms
            </Button>
          )}
        </div>
      )}
      <DataTable
        rows={rows}
        empty={<Empty title={kind === 'arrivals' ? 'No arrivals today' : kind === 'inhouse' ? 'No guests in house' : 'No departures today'} />}
        onRowClick={onOpen}
        exportName={`${kind}-${b.businessDate}.csv`}
        columns={[
          ...(kind === 'arrivals' ? [{ key: 'eta', label: 'ETA', render: (r) => r.eta || '—' }] : []),
          {
            key: 'guest',
            label: 'Guest',
            value: (r) => `${r.last_name} ${r.first_name}`,
            render: (r) => (
              <>
                <b>
                  {r.vip ? <Badge tone="warn">{r.vip}</Badge> : null} {r.first_name} {r.last_name}
                </b>
                <div className="sub">
                  {r.conf_no}
                  {r.company_name ? ` · ${r.company_name}` : ''}
                  {r.preferences?.length ? ` · ${r.preferences.join(', ')}` : ''}
                </div>
              </>
            ),
            csv: (r) => `${r.first_name} ${r.last_name}`,
          },
          {
            key: 'room_number',
            label: 'Room',
            render: (r) => (r.room_number ? <b>{r.room_number}</b> : <Badge tone="warn">Unassigned</Badge>),
          },
          { key: 'room_type_name', label: 'Type' },
          { key: 'dates', label: kind === 'arrivals' ? 'Departure' : 'Stay', render: (r) => (kind === 'arrivals' ? date(r.departure) : `${date(r.arrival, { year: false })} – ${date(r.departure, { year: false })}`), csv: (r) => `${r.arrival} - ${r.departure}` },
          { key: 'adults', label: 'Pax', render: (r) => `${r.adults}${r.children ? `+${r.children}` : ''}` },
          ...(kind === 'arrivals'
            ? [{ key: 'room_hk_status', label: 'Room state', render: (r) => (r.room_hk_status ? <Badge tone={HK_TONE[r.room_hk_status]}>{titleCase(r.room_hk_status)}</Badge> : '—') }]
            : []),
          { key: 'source', label: 'Source', render: (r) => r.channel || r.source },
          ...(can('folio.view') ? [{ key: 'balance_minor', label: 'Balance', num: true, render: (r) => <span style={{ color: r.balance_minor > 0 ? 'var(--danger)' : undefined }}>{money(r.balance_minor, r.currency)}</span> }] : []),
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'actions',
            label: '',
            sortable: false,
            csv: false,
            render: (r) => (
              <div className="row" onClick={(e) => e.stopPropagation()} style={{ justifyContent: 'flex-end' }}>
                {kind === 'arrivals' && r.status === 'confirmed' && can('frontdesk.operate') && (
                  <Button size="sm" variant="primary" onClick={() => onAction('checkin', r)}>
                    Check in
                  </Button>
                )}
                {kind !== 'arrivals' && r.status === 'in_house' && can('frontdesk.operate') && (kind === 'departures' || r.departure === b.businessDate) && (
                  <Button size="sm" variant="primary" onClick={() => onAction('checkout', r)}>
                    Check out
                  </Button>
                )}
                <Menu
                  items={[
                    { label: 'Open reservation', onClick: () => onOpen(r) },
                    r.status === 'in_house' && can('frontdesk.operate') ? { label: 'Room move', icon: ArrowRightLeft, onClick: () => onAction('move', r) } : null,
                    r.status === 'in_house' && kind === 'inhouse' && can('frontdesk.operate') && r.departure !== b.businessDate ? { label: 'Early checkout', icon: LogOut, onClick: () => onAction('checkout', r) } : null,
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

export function CheckInModal({ reservationId, onClose, onDone }) {
  const q = useApi(`/reservations/${reservationId}`);
  const r = q.data;
  const rooms = useApi(r ? `/rooms${qs({ property: r.property_id, type: r.room_type_id })}` : null);
  const [roomId, setRoomId] = useState('');
  const [id, setId] = useState({ idType: 'passport', idNumber: '', idCountry: '' });
  const [err, setErr] = useState(null);
  const [run, busy] = useAction();
  const needId = r && !r.guest.id_verified_at;
  const candidates = useMemo(() => (rooms.data?.rooms || []).filter((x) => !x.occupied && !x.block), [rooms.data]);
  return (
    <Modal
      title={r ? `Check in ${r.guest.first_name} ${r.guest.last_name}` : 'Check in'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={LogIn}
            busy={busy}
            disabled={!r || (needId && !id.idNumber) || (!r.room_number && !roomId)}
            onClick={() =>
              run(
                async () => {
                  const out = await api.post(`/frontdesk/${reservationId}/check-in`, { roomId: roomId ? Number(roomId) : undefined, ...(needId ? id : {}) });
                  onDone(out);
                },
                { success: 'Checked in', onError: setErr },
              )
            }
          >
            Check in
          </Button>
        </>
      }
    >
      <Async q={q}>
        {(r) => (
          <div className="stack">
            <div className="dl">
              <dt>Booking</dt>
              <dd>
                {r.conf_no} · {r.room_type_name} · {date(r.arrival)} – {date(r.departure)} ({r.nights_count} nights)
              </dd>
              <dt>Guests</dt>
              <dd>
                {r.adults} adults{r.children ? `, ${r.children} children` : ''}
              </dd>
              {r.special_requests && (
                <>
                  <dt>Requests</dt>
                  <dd>{r.special_requests}</dd>
                </>
              )}
            </div>
            <Field label={r.room_number ? `Room (assigned: ${r.room_number})` : 'Assign a room'} hint="Rooms of the booked type that are free tonight; readiness is checked on check-in">
              <Select
                value={roomId}
                placeholder={r.room_number ? `Keep ${r.room_number}` : 'Choose a room'}
                options={candidates.map((x) => ({ value: x.id, label: `${x.number} · ${x.code === 'INSP' ? 'inspected' : x.hk_status}${x.arrival && x.arrival.reservationId !== r.id ? ' · reserved for another arrival' : ''}` }))}
                onChange={(e) => setRoomId(e.target.value)}
              />
            </Field>
            {needId ? (
              <div className="form-grid">
                <Field label="Identity document">
                  <Select value={id.idType} options={ID_TYPES} onChange={(e) => setId({ ...id, idType: e.target.value })} />
                </Field>
                <Field label="Document number" hint="Only the last four characters are stored">
                  <Input value={id.idNumber} onChange={(e) => setId({ ...id, idNumber: e.target.value })} autoComplete="off" />
                </Field>
                <Field label="Issuing country">
                  <Input maxLength={2} value={id.idCountry} onChange={(e) => setId({ ...id, idCountry: e.target.value.toUpperCase() })} placeholder="IN" />
                </Field>
              </div>
            ) : (
              <Notice tone="good">
                Identity verified: {titleCase(r.guest.id_type)} {r.guest.id_number_masked}
              </Notice>
            )}
            {err && <Notice tone="danger">{err.message}</Notice>}
          </div>
        )}
      </Async>
    </Modal>
  );
}

export function CheckOutModal({ reservationId, onClose, onDone }) {
  const { can } = useApp();
  const q = useApi(`/reservations/${reservationId}`);
  const companies = useApi('/companies');
  const [method, setMethod] = useState('CARD');
  const [ref, setRef] = useState('');
  const [billTo, setBillTo] = useState('guest');
  const [companyId, setCompanyId] = useState('');
  const [err, setErr] = useState(null);
  const [run, busy] = useAction();
  const [key] = useState(newIdempotencyKey);
  const r = q.data;
  const open = r?.folios?.filter((f) => f.status === 'open') || [];
  const balance = open.reduce((a, f) => a + f.balance_minor, 0);
  const early = r && r.departure > r.business_date;
  const arCompanies = (companies.data || []).filter((c) => c.ar_enabled);
  const go = () =>
    run(
      async () => {
        if (billTo === 'guest')
          for (const f of open)
            if (f.balance_minor > 0) await api.post(`/folios/${f.id}/payments`, { method, amount: f.balance_minor / 100, reference: ref || undefined }, { idempotent: `${key}-${f.id}` });
        const out = await api.post(`/frontdesk/${reservationId}/check-out`, { billTo, companyId: billTo === 'company' ? Number(companyId || r.company_id) : undefined });
        onDone(out);
        return out;
      },
      { success: (o) => `Checked out${o.invoices?.length ? ` · invoice ${o.invoices.map((i) => i.invoice_no).join(', ')}` : ''}`, onError: setErr },
    );
  return (
    <Modal
      title={r ? `Check out ${r.guest.first_name} ${r.guest.last_name}` : 'Check out'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={LogOut} busy={busy} disabled={!r || (billTo === 'company' && !(companyId || r.company_id))} onClick={go}>
            {billTo === 'guest' && balance > 0 ? `Take ${money(balance, r?.currency)} and check out` : 'Check out'}
          </Button>
        </>
      }
    >
      <Async q={q}>
        {(r) => (
          <div className="stack">
            {early && <Notice tone="warn">Early departure: nights from {date(r.business_date)} will be released and not charged.</Notice>}
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Account</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <Link to={`/folios/${f.id}`} target="_blank">
                          {f.folio_no}
                        </Link>{' '}
                        <span className="sub">window {f.folio_window}</span>
                      </td>
                      <td>{f.name}</td>
                      <td className="num">{moneyExact(f.balance_minor, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Field label="Settlement">
              <Select
                value={billTo}
                onChange={(e) => setBillTo(e.target.value)}
                options={[
                  { value: 'guest', label: 'Guest pays now' },
                  ...(can('folio.post') ? [{ value: 'company', label: 'Bill to company (city ledger)' }] : []),
                ]}
              />
            </Field>
            {billTo === 'guest' && balance > 0 && (
              <div className="form-grid">
                <Field label="Payment method" hint="Cards are taken on the terminal; only a reference and last four digits are kept">
                  <Select value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: 'CARD', label: 'Card' }, { value: 'UPI', label: 'UPI' }, { value: 'CASH', label: 'Cash' }, { value: 'BANK', label: 'Bank transfer' }]} />
                </Field>
                <Field label="Reference">
                  <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Terminal / UTR reference" />
                </Field>
              </div>
            )}
            {billTo === 'company' && (
              <Field label="Company account" hint="The invoice is issued to the company and the balance moves to its accounts receivable">
                <Select value={companyId || r.company_id || ''} placeholder="Choose a company with a credit account" options={arCompanies.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => setCompanyId(e.target.value)} />
              </Field>
            )}
            <div className="small muted">A tax invoice is issued for each folio with charges; folios are then closed.</div>
            {err && <Notice tone="danger">{err.message}</Notice>}
          </div>
        )}
      </Async>
    </Modal>
  );
}

function RoomMoveModal({ reservationId, onClose, onDone }) {
  const q = useApi(`/reservations/${reservationId}`);
  const r = q.data;
  const rooms = useApi(r ? `/rooms${qs({ property: r.property_id })}` : null);
  const [roomId, setRoomId] = useState('');
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  const ready = (rooms.data?.rooms || []).filter((x) => !x.occupied && !x.block && ['INSP', 'VC'].includes(x.code));
  return (
    <Modal
      title="Room move"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!roomId || !reason} onClick={() => run(async () => { await api.post(`/frontdesk/${reservationId}/room-move`, { roomId: Number(roomId), reason }); onDone(); }, { success: 'Guest moved; the previous room is sent for cleaning', onError: setErr })}>
            Move guest
          </Button>
        </>
      }
    >
      {r && (
        <div className="stack">
          <div className="small">
            {r.guest.first_name} {r.guest.last_name} is in room <b>{r.room_number}</b> ({r.room_type_name}) until {date(r.departure)}.
          </div>
          <Field label="New room" hint="Vacant rooms that are ready now">
            <Select value={roomId} placeholder="Choose" options={ready.map((x) => ({ value: x.id, label: `${x.number} · ${x.type_name} · ${x.code}` }))} onChange={(e) => setRoomId(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. AC fault, guest preference, upgrade" />
          </Field>
          {err && <Notice tone="danger">{err.message}</Notice>}
        </div>
      )}
    </Modal>
  );
}

function WalkInModal({ prop, onClose, onDone }) {
  const types = useApi(`/room-types${qs({ property: prop.id })}`);
  const plans = useApi(`/rate-plans${qs({ property: prop.id })}`);
  const rooms = useApi(`/rooms${qs({ property: prop.id })}`);
  const [f, setF] = useState({ first_name: '', last_name: '', phone: '', email: '', country: '', idType: 'passport', idNumber: '', roomTypeId: '', roomId: '', ratePlanId: '', departure: addDays(prop.business_date, 1), adults: 1, children: 0 });
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  const ready = (rooms.data?.rooms || []).filter((x) => !x.occupied && !x.block && ['INSP', 'VC'].includes(x.code) && (!f.roomTypeId || String(x.room_type_id) === String(f.roomTypeId)));
  const bar = plans.data?.plans?.find((p) => p.code === 'BAR');
  return (
    <Modal
      title="Walk-in"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="accent"
            busy={busy}
            disabled={!f.first_name || !f.roomId || !f.idNumber}
            onClick={() =>
              run(
                async () => {
                  const out = await api.post(
                    '/frontdesk/walk-in',
                    {
                      propertyId: prop.id,
                      guest: { first_name: f.first_name, last_name: f.last_name, phone: f.phone || undefined, email: f.email || undefined, country: f.country || undefined },
                      idType: f.idType,
                      idNumber: f.idNumber,
                      idCountry: f.country || undefined,
                      roomTypeId: Number(f.roomTypeId || ready.find((x) => String(x.id) === String(f.roomId))?.room_type_id),
                      roomId: Number(f.roomId),
                      ratePlanId: Number(f.ratePlanId || bar?.id),
                      departure: f.departure,
                      adults: Number(f.adults),
                      children: Number(f.children),
                    },
                    { idempotent: true },
                  );
                  onDone(out);
                },
                { success: 'Walk-in checked in', onError: setErr },
              )
            }
          >
            Book and check in
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="First name">
          <Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} autoFocus />
        </Field>
        <Field label="Last name">
          <Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Identity document">
          <Select value={f.idType} options={ID_TYPES} onChange={(e) => setF({ ...f, idType: e.target.value })} />
        </Field>
        <Field label="Document number" hint="Only the last four characters are stored">
          <Input value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Country (ISO)">
          <Input maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Departure">
          <Input type="date" min={addDays(prop.business_date, 1)} value={f.departure} onChange={(e) => setF({ ...f, departure: e.target.value })} />
        </Field>
        <Field label="Room type">
          <Select value={f.roomTypeId} placeholder="Any" options={(types.data || []).map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => setF({ ...f, roomTypeId: e.target.value, roomId: '' })} />
        </Field>
        <Field label="Room (ready now)">
          <Select value={f.roomId} placeholder="Choose" options={ready.map((x) => ({ value: x.id, label: `${x.number} · ${x.type_name}` }))} onChange={(e) => setF({ ...f, roomId: e.target.value })} />
        </Field>
        <Field label="Rate plan">
          <Select value={f.ratePlanId || bar?.id || ''} options={(plans.data?.plans || []).filter((p) => p.is_public).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} onChange={(e) => setF({ ...f, ratePlanId: e.target.value })} />
        </Field>
        <Field label="Adults / children">
          <div className="row">
            <Input type="number" min={1} value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} />
            <Input type="number" min={0} value={f.children} onChange={(e) => setF({ ...f, children: e.target.value })} />
          </div>
        </Field>
      </div>
      {err && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="danger">{err.message}</Notice>
        </div>
      )}
    </Modal>
  );
}

function Requests({ propertyId }) {
  const [status, setStatus] = useState('open,in_progress');
  const q = useApi(`/guest-requests${qs({ property: propertyId, status })}`);
  const inHouse = useApi(`/frontdesk/boards${qs({ property: propertyId })}`);
  const [create, setCreate] = useState(false);
  const [f, setF] = useState({ kind: 'request', description: '', reservationId: '' });
  const [run, busy] = useAction();
  const { can } = useApp();
  return (
    <Card
      title="Guest services"
      sub="Requests, complaints, wake-up calls, transport and luggage"
      action={
        <div className="row">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'open,in_progress', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'open,in_progress,done,cancelled', label: 'All' }]} />
          {can('frontdesk.operate') && (
            <Button size="sm" icon={Plus} onClick={() => setCreate(true)}>
              New request
            </Button>
          )}
        </div>
      }
      flush
    >
      <Async q={q}>
        {(rows) => (
          <DataTable
            rows={rows}
            empty={<Empty title="No open requests" />}
            columns={[
              { key: 'kind', label: 'Type', render: (x) => <Badge tone={x.kind === 'complaint' ? 'danger' : x.kind === 'maintenance' ? 'warn' : 'info'}>{titleCase(x.kind)}</Badge> },
              { key: 'description', label: 'Request' },
              { key: 'room_number', label: 'Room', render: (x) => x.room_number || '—' },
              { key: 'guest', label: 'Guest', render: (x) => x.guest || '—' },
              { key: 'created_at', label: 'Logged', render: (x) => dateTime(x.created_at) },
              { key: 'status', label: 'Status', render: (x) => <Badge tone={x.status === 'done' ? 'good' : ''}>{titleCase(x.status)}</Badge> },
              {
                key: 'act',
                label: '',
                sortable: false,
                render: (x) =>
                  x.status !== 'done' && can('frontdesk.operate') ? (
                    <Button size="xs" busy={busy} onClick={() => run(async () => { await api.put(`/guest-requests/${x.id}`, { status: 'done' }); q.reload(); }, { success: 'Marked done' })}>
                      Mark done
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Async>
      {create && (
        <Modal
          title="New guest request"
          onClose={() => setCreate(false)}
          footer={
            <>
              <Button onClick={() => setCreate(false)}>Cancel</Button>
              <Button variant="primary" busy={busy} disabled={!f.description} onClick={() => run(async () => { await api.post('/guest-requests', { propertyId, ...f, reservationId: f.reservationId ? Number(f.reservationId) : undefined }); setCreate(false); q.reload(); }, { success: 'Request logged' })}>
                Log request
              </Button>
            </>
          }
        >
          <div className="stack">
            <Field label="Type">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={['request', 'complaint', 'wake_up', 'transport', 'luggage', 'room_service', 'maintenance'].map((k) => ({ value: k, label: titleCase(k) }))} />
            </Field>
            <Field label="In-house guest">
              <Select value={f.reservationId} placeholder="Not linked to a guest" options={(inHouse.data?.inHouse || []).map((r) => ({ value: r.id, label: `${r.room_number || '—'} · ${r.first_name} ${r.last_name}` }))} onChange={(e) => setF({ ...f, reservationId: e.target.value })} />
            </Field>
            <Field label="Details">
              <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            {f.kind === 'maintenance' && <div className="small muted">The room is flagged “maintenance required” for engineering and housekeeping.</div>}
          </div>
        </Modal>
      )}
    </Card>
  );
}

function Cashier({ prop }) {
  const q = useApi(`/cashier/shift${qs({ property: prop.id })}`);
  const [floatAmt, setFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [run, busy] = useAction();
  return (
    <Async q={q}>
      {(d) => (
        <div className="grid g-1-2">
          <Card title={d.current ? 'Your open shift' : 'Open a cashier shift'}>
            {d.current ? (
              <div className="stack">
                <div className="dl">
                  <dt>Opened</dt>
                  <dd>{dateTime(d.current.opened_at)}</dd>
                  <dt>Opening float</dt>
                  <dd>{moneyExact(d.current.opening_float_minor, prop.currency)}</dd>
                  {d.current.byMethod.map((m) => (
                    <Fragment key={`${m.payment_method}${m.kind}`}>
                      <dt>{`${m.payment_method} ${m.kind}s (${m.n})`}</dt>
                      <dd>{moneyExact(m.amount_minor, prop.currency)}</dd>
                    </Fragment>
                  ))}
                  <dt>Expected cash in drawer</dt>
                  <dd>
                    <b>{moneyExact(d.current.expected_cash_now_minor, prop.currency)}</b>
                  </dd>
                </div>
                <Field label="Cash counted">
                  <Input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
                </Field>
                <Button variant="primary" busy={busy} disabled={counted === ''} onClick={() => run(async () => { await api.post(`/cashier/${d.current.id}/close`, { countedCash: counted }); q.reload(); }, { success: 'Shift closed' })}>
                  Close shift
                </Button>
              </div>
            ) : (
              <div className="stack">
                <Field label="Opening float">
                  <Input inputMode="decimal" value={floatAmt} onChange={(e) => setFloat(e.target.value)} placeholder="0.00" />
                </Field>
                <Button variant="primary" busy={busy} onClick={() => run(async () => { await api.post('/cashier/open', { propertyId: prop.id, openingFloat: floatAmt || 0 }); q.reload(); }, { success: 'Shift opened' })}>
                  Open shift
                </Button>
                <div className="small muted">Payments you take while the shift is open are counted against it.</div>
              </div>
            )}
          </Card>
          <Card title="Recent shifts" flush>
            <DataTable
              rows={d.recent}
              empty={<Empty title="No cashier shifts yet" />}
              columns={[
                { key: 'user_name', label: 'Cashier' },
                { key: 'opened_at', label: 'Opened', render: (s) => dateTime(s.opened_at) },
                { key: 'closed_at', label: 'Closed', render: (s) => (s.closed_at ? dateTime(s.closed_at) : <Badge tone="info">Open</Badge>) },
                { key: 'expected_cash_minor', label: 'Expected', num: true, render: (s) => (s.expected_cash_minor == null ? '—' : moneyExact(s.expected_cash_minor, prop.currency)) },
                { key: 'counted_cash_minor', label: 'Counted', num: true, render: (s) => (s.counted_cash_minor == null ? '—' : moneyExact(s.counted_cash_minor, prop.currency)) },
                { key: 'variance_minor', label: 'Variance', num: true, render: (s) => (s.variance_minor == null ? '—' : <span style={{ color: s.variance_minor ? 'var(--danger)' : undefined }}>{moneyExact(s.variance_minor, prop.currency)}</span>) },
              ]}
            />
          </Card>
        </div>
      )}
    </Async>
  );
}

function NightAudit({ prop, onDone }) {
  const q = useApi(`/night-audit${qs({ property: prop.id })}`);
  const [confirm, setConfirm] = useState(false);
  const [run, busy] = useAction();
  const { refresh } = useApp();
  return (
    <Async q={q}>
      {(d) => (
        <div className="stack">
          <Card title={`Close business day ${date(d.businessDate)}`} sub="Posts tonight’s room and package charges once, marks unarrived bookings as no-shows and advances the business date">
            <div className="stack">
              {d.departuresPending.length > 0 ? (
                <Notice tone="danger">
                  {d.departuresPending.length} departure(s) are still in house: {d.departuresPending.map((x) => `${x.conf_no} (${x.guest})`).join(', ')}. Check them out or extend their stay first.
                </Notice>
              ) : (
                <Notice tone="good">All of today’s departures have checked out.</Notice>
              )}
              {d.arrivalsPending.length > 0 && (
                <Notice tone="warn">
                  {d.arrivalsPending.length} arrival(s) have not checked in and will be marked as no-shows (guaranteed bookings are charged per policy): {d.arrivalsPending.slice(0, 8).map((x) => x.conf_no).join(', ')}
                  {d.arrivalsPending.length > 8 ? '…' : ''}
                </Notice>
              )}
              <div className="small muted">{d.inHouse} reservations are in house tonight.</div>
              <div>
                <Button variant="primary" icon={Moon} disabled={d.departuresPending.length > 0} onClick={() => setConfirm(true)}>
                  Run night audit
                </Button>
              </div>
            </div>
          </Card>
          <Card title="Audit history" flush>
            <DataTable
              rows={d.history}
              empty={<Empty title="No night audits yet" />}
              columns={[
                { key: 'business_date', label: 'Business date', render: (h) => date(h.business_date) },
                { key: 'status', label: 'Result', render: (h) => <Badge tone={h.status === 'completed' ? 'good' : 'danger'}>{h.status}</Badge> },
                { key: 'rooms', label: 'Rooms posted', num: true, render: (h) => h.summary?.roomsPosted ?? '—' },
                { key: 'rev', label: 'Room revenue', num: true, render: (h) => (h.summary ? moneyExact(h.summary.roomRevenueMinor, prop.currency) : '—') },
                { key: 'noshows', label: 'No-shows', num: true, render: (h) => h.summary?.noShows ?? '—' },
                { key: 'run_by_name', label: 'Run by', render: (h) => h.run_by_name || '—' },
                { key: 'error', label: 'Error', render: (h) => h.error || '' },
              ]}
            />
          </Card>
          {confirm && (
            <Confirm
              title="Run the night audit?"
              message={`This closes ${date(d.businessDate)} for ${prop.name}: room charges are posted and the business date moves to ${date(addDays(d.businessDate, 1))}. It cannot be undone; corrections are made by reversal.`}
              confirmLabel="Close the day"
              busy={busy}
              onClose={() => setConfirm(false)}
              onConfirm={() =>
                run(
                  async () => {
                    const r = await api.post('/night-audit', { propertyId: prop.id });
                    setConfirm(false);
                    q.reload();
                    onDone?.();
                    refresh();
                    return r;
                  },
                  { success: (r) => `Day closed: ${r.roomsPosted} room charges posted, ${r.noShows} no-shows. New business date ${date(r.nextBusinessDate)}.` },
                )
              }
            />
          )}
        </div>
      )}
    </Async>
  );
}
