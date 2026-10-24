// Reservation: stay, guest, nightly rates and room per night, folios, lifecycle actions
// (confirm quote, modify, cancel, no-show, check in / out) and the modification history.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, CalendarClock, LogIn, LogOut, Pencil, Receipt } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { date, dateTime, money, party, statusLabel, titleCase } from '../lib/format.js';
import { Async, Badge, Button, Card, Field, Input, Modal, Notice, PageHead, Select, StatusBadge, Textarea, useAction } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { CheckInModal, CheckOutModal } from './FrontDesk.jsx';

export default function ReservationDetail() {
  const { id } = useParams();
  const q = useApi(`/reservations/${id}`);
  return <Async q={q}>{(r) => <Detail r={r} reload={q.reload} />}</Async>;
}

function Detail({ r, reload }) {
  const { can } = useApp();
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const [run, busy] = useAction();
  const ccy = r.currency;
  const g = r.guest;
  const today = r.business_date;
  return (
    <>
      <PageHead
        crumbs={
          <>
            <Link to="/reservations">Reservations</Link> / {r.conf_no}
          </>
        }
        title={
          <span className="row" style={{ gap: 10 }}>
            {g.first_name} {g.last_name} <StatusBadge status={r.status} />
            {r.is_complimentary ? <Badge tone="violet">Complimentary</Badge> : null}
          </span>
        }
        sub={`${r.property_name} · ${r.conf_no}${r.channel_ref ? ` · ${r.channel} ${r.channel_ref}` : ''}${r.group_name ? ` · ${r.group_name}` : ''}`}
      >
        {r.status === 'quote' && can('reservations.modify') && (
          <Button variant="primary" busy={busy} onClick={() => run(async () => { await api.post(`/reservations/${r.id}/confirm`); reload(); }, { success: 'Quote confirmed' })}>
            Confirm quote
          </Button>
        )}
        {r.status === 'confirmed' && r.arrival === today && can('frontdesk.operate') && (
          <Button variant="primary" icon={LogIn} onClick={() => setModal('checkin')}>
            Check in
          </Button>
        )}
        {r.status === 'in_house' && can('frontdesk.operate') && (
          <Button variant="primary" icon={LogOut} onClick={() => setModal('checkout')}>
            Check out
          </Button>
        )}
        {['quote', 'confirmed', 'in_house'].includes(r.status) && can('reservations.modify') && (
          <Button icon={Pencil} onClick={() => setModal('modify')}>
            Modify
          </Button>
        )}
        {['quote', 'confirmed'].includes(r.status) && can('reservations.cancel') && (
          <Button className="danger" icon={Ban} onClick={() => setModal('cancel')}>
            Cancel
          </Button>
        )}
        {r.status === 'confirmed' && r.arrival <= today && can('frontdesk.operate') && (
          <Button icon={CalendarClock} onClick={() => run(async () => { await api.post(`/reservations/${r.id}/no-show`); reload(); }, { success: 'Marked as no-show' })}>
            No-show
          </Button>
        )}
      </PageHead>
      <div className="grid g-2-1">
        <div className="stack">
          <Card title="Stay">
            <div className="grid g3">
              <div className="dl">
                <dt>Arrival</dt>
                <dd>{date(r.arrival)}</dd>
                <dt>Departure</dt>
                <dd>{date(r.departure)}</dd>
                <dt>Nights</dt>
                <dd>{r.nights_count}</dd>
                <dt>Guests</dt>
                <dd>
                  {party(r.adults, r.children)}
                </dd>
              </div>
              <div className="dl">
                <dt>Room type</dt>
                <dd>{r.room_type_name}</dd>
                <dt>Room</dt>
                <dd>{r.room_number ? <Link to={`/rooms/${r.room_id}`}>{r.room_number}</Link> : <Badge tone="warn">Unassigned</Badge>}</dd>
                <dt>Rate plan</dt>
                <dd>{r.rate_plan_name || 'Manual rate'}</dd>
                <dt>Meal plan</dt>
                <dd>{r.meal_plan || '—'}</dd>
              </div>
              <div className="dl">
                <dt>Source</dt>
                <dd>{r.channel || r.source}</dd>
                <dt>Segment</dt>
                <dd>{r.segment || '—'}</dd>
                <dt>Company</dt>
                <dd>{r.company_name || '—'}</dd>
                <dt>Guarantee</dt>
                <dd>{titleCase(r.guarantee)}</dd>
              </div>
            </div>
            {(r.special_requests || r.notes) && (
              <div className="stack" style={{ gap: 6, marginTop: 12 }}>
                {r.special_requests && <Notice>Request: {r.special_requests}</Notice>}
                {r.notes && <div className="small muted">Notes: {r.notes}</div>}
              </div>
            )}
          </Card>
          <Card title="Nights" sub="Rate per night and the room holding each night" flush>
            <DataTable
              rows={r.nights}
              rowKey={(n) => n.night}
              pageSize={31}
              columns={[
                { key: 'night', label: 'Night', render: (n) => `${date(n.night)}${n.night === today ? ' · tonight' : ''}` },
                { key: 'room_number', label: 'Room', render: (n) => n.room_number || <Badge tone="warn">Unassigned</Badge> },
                { key: 'rate_minor', label: ccy === 'INR' ? 'Rate (excl. GST)' : 'Rate (incl. VAT)', num: true, render: (n) => (n.rate_minor == null ? '—' : money(n.rate_minor, ccy)) },
              ]}
            />
          </Card>
          <Card title="History" sub="Every change, who made it and when" flush>
            <DataTable
              rows={r.history}
              pageSize={10}
              columns={[
                { key: 'at', label: 'When', render: (h) => dateTime(h.at) },
                { key: 'action', label: 'Action', render: (h) => titleCase(h.action) },
                { key: 'user_name', label: 'By', render: (h) => h.user_name || 'System / channel' },
                {
                  key: 'changes',
                  label: 'Details',
                  sortable: false,
                  render: (h) => (
                    <span className="small muted">
                      {h.changes
                        ? Object.entries(h.changes)
                            .filter(([, v]) => v !== null && v !== undefined)
                            .slice(0, 5)
                            .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' && v && 'from' in v ? `${v.from ?? '—'} → ${v.to ?? '—'}` : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
                            .join(' · ')
                        : ''}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </div>
        <div className="stack">
          <Card title="Guest" action={<Link className="btn sm" to={`/guests/${g.id}`}>Profile</Link>}>
            <div className="dl">
              <dt>Name</dt>
              <dd>
                {g.title ? `${g.title} ` : ''}
                {g.first_name} {g.last_name} {g.vip ? <Badge tone="warn">{g.vip}</Badge> : null}
              </dd>
              <dt>Email</dt>
              <dd>{g.email || '—'}</dd>
              <dt>Phone</dt>
              <dd>{g.phone || '—'}</dd>
              <dt>Nationality</dt>
              <dd>{g.nationality || '—'}</dd>
              <dt>ID verified</dt>
              <dd>{g.id_verified_at ? `${titleCase(g.id_type || '')} ${g.id_number_masked || ''}` : <Badge tone="warn">Not yet</Badge>}</dd>
            </div>
          </Card>
          {r.folios && (
            <Card title="Folios" sub={`Balance ${money(r.balance_minor, ccy)}`}>
              <ul className="list-plain">
                {r.folios.map((f) => (
                  <li key={f.id}>
                    <Receipt size={16} className="muted" />
                    <div style={{ flex: 1 }}>
                      <Link to={`/folios/${f.id}`}>
                        <b>{f.folio_no}</b>
                      </Link>{' '}
                      <span className="small muted">window {f.folio_window} · {f.name}</span>
                    </div>
                    <Badge tone={f.status === 'open' ? 'info' : ''}>{f.status}</Badge>
                    <b className="num">{money(f.balance_minor, ccy)}</b>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {r.cancellation_policy && (
            <Card title="Cancellation policy">
              <div className="small">
                <b>{r.cancellation_policy.name}</b>
                <div className="muted">
                  {r.cancellation_policy.non_refundable
                    ? 'Non-refundable: the full stay is charged on cancellation.'
                    : `Free until ${r.cancellation_policy.free_cancel_hours} hours before arrival, then ${r.cancellation_policy.penalty_kind.replace('_', ' ')}.`}{' '}
                  No-show: {r.cancellation_policy.no_show_kind.replace('_', ' ')} (guaranteed bookings).
                </div>
              </div>
            </Card>
          )}
          {r.cancel_reason && <Notice tone="danger">Cancelled: {r.cancel_reason}</Notice>}
        </div>
      </div>
      {modal === 'cancel' && <CancelModal r={r} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'modify' && <ModifyModal r={r} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'checkin' && <CheckInModal reservationId={r.id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'checkout' && <CheckOutModal reservationId={r.id} onClose={() => setModal(null)} onDone={(out) => { setModal(null); if (out?.invoices?.[0]) navigate(`/invoices/${out.invoices[0].id}`); else reload(); }} />}
    </>
  );
}

function CancelModal({ r, onClose, onDone }) {
  const { can } = useApp();
  const [reason, setReason] = useState('');
  const [waive, setWaive] = useState(false);
  const [run, busy] = useAction();
  return (
    <Modal
      title={`Cancel ${r.conf_no}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep booking</Button>
          <Button variant="accent" busy={busy} disabled={!reason} onClick={() => run(async () => { const out = await api.post(`/reservations/${r.id}/cancel`, { reason, waiveFee: waive }); onDone(out); }, { success: (o) => (o.feePosted ? `Cancelled; fee of ${money(o.feePosted.amount_minor, r.currency)} posted to the folio` : 'Cancelled') })}>
            Cancel booking
          </Button>
        </>
      }
    >
      <div className="stack">
        <Notice tone="warn">The room nights are released at once. A fee is posted to the folio when the policy requires one.</Notice>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest changed travel plans" />
        </Field>
        {(can('reservations.override') || can('folio.adjust')) && (
          <label className="check">
            <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> Waive any cancellation fee (manager)
          </label>
        )}
      </div>
    </Modal>
  );
}

function ModifyModal({ r, onClose, onDone }) {
  const { can } = useApp();
  const types = useApi(`/room-types?property=${r.property_id}`);
  const plans = useApi(`/rate-plans?property=${r.property_id}`);
  const inHouse = r.status === 'in_house';
  const [f, setF] = useState({ arrival: r.arrival, departure: r.departure, roomTypeId: r.room_type_id, ratePlanId: r.rate_plan_id || '', adults: r.adults, children: r.children, eta: r.eta || '', specialRequests: r.special_requests || '', notes: r.notes || '' });
  const [err, setErr] = useState(null);
  const [run, busy] = useAction();
  const body = () => {
    const b = { version: r.version };
    if (!inHouse && f.arrival !== r.arrival) b.arrival = f.arrival;
    if (f.departure !== r.departure) b.departure = f.departure;
    if (!inHouse && Number(f.roomTypeId) !== r.room_type_id) b.roomTypeId = Number(f.roomTypeId);
    if (!inHouse && Number(f.ratePlanId || 0) !== (r.rate_plan_id || 0)) b.ratePlanId = f.ratePlanId ? Number(f.ratePlanId) : null;
    if (Number(f.adults) !== r.adults) b.adults = Number(f.adults);
    if (Number(f.children) !== r.children) b.children = Number(f.children);
    if (!inHouse && f.eta !== (r.eta || '')) b.eta = f.eta;
    if (f.specialRequests !== (r.special_requests || '')) b.specialRequests = f.specialRequests;
    if (f.notes !== (r.notes || '')) b.notes = f.notes;
    if (f.rate) b.rate = f.rate;
    return b;
  };
  return (
    <Modal
      title={`Modify ${r.conf_no}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => run(async () => { await api.put(`/reservations/${r.id}`, body()); onDone(); }, { success: 'Reservation updated', onError: setErr })}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Arrival">
          <Input type="date" value={f.arrival} disabled={inHouse} onChange={(e) => setF({ ...f, arrival: e.target.value })} />
        </Field>
        <Field label="Departure">
          <Input type="date" value={f.departure} onChange={(e) => setF({ ...f, departure: e.target.value })} />
        </Field>
        <Field label="Room type">
          <Select value={f.roomTypeId} disabled={inHouse} options={(types.data || []).map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => setF({ ...f, roomTypeId: e.target.value })} />
        </Field>
        <Field label="Rate plan">
          <Select value={f.ratePlanId} disabled={inHouse} placeholder="Manual rate" options={(plans.data?.plans || []).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} onChange={(e) => setF({ ...f, ratePlanId: e.target.value })} />
        </Field>
        <Field label="Adults">
          <Input type="number" min={1} value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} />
        </Field>
        <Field label="Children">
          <Input type="number" min={0} value={f.children} onChange={(e) => setF({ ...f, children: e.target.value })} />
        </Field>
        {can('reservations.override') && (
          <Field label="Manual rate per night (manager)" hint="Re-prices the remaining nights">
            <Input inputMode="decimal" value={f.rate || ''} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          </Field>
        )}
        <Field label="Expected arrival time">
          <Input type="time" value={f.eta} disabled={inHouse} onChange={(e) => setF({ ...f, eta: e.target.value })} />
        </Field>
        <Field label="Special requests" className="span2">
          <Input value={f.specialRequests} onChange={(e) => setF({ ...f, specialRequests: e.target.value })} />
        </Field>
        <Field label="Notes" className="span2">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      {inHouse && <div className="small muted" style={{ marginTop: 10 }}>The guest is in house: nights already stayed keep their rate; use Front Desk → Room move to change rooms.</div>}
      {err && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="danger">{err.message}</Notice>
        </div>
      )}
      <div className="small muted" style={{ marginTop: 8 }}>
        Status: {statusLabel(r.status)} · version {r.version}. If someone else changes this booking first, you will be asked to reload.
      </div>
    </Modal>
  );
}
