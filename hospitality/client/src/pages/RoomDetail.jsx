// Room profile: inherited and room-specific attributes (with their source), amenities and
// authorised exceptions, live status, upcoming stays, maintenance history, assets, images and
// performance over the last 12 months.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ImagePlus, Wrench } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { date, dateTime, money, number, pct, titleCase } from '../lib/format.js';
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, Notice, PageHead, RoomCode, Select, Tabs, useAction } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { BlockForm } from './Calendar.jsx';
import { WEB_DEMO } from '../lib/env.js';

const LABELS = {
  area_sqft: 'Area (sq ft)',
  area_sqm: 'Area (m²)',
  bedrooms: 'Bedrooms',
  bed_type: 'Bed type',
  bed_size: 'Bed size',
  max_adults: 'Max adults',
  max_children: 'Max children',
  extra_beds: 'Extra beds',
  view_type: 'View',
  smoking: 'Smoking',
  balcony: 'Balcony / terrace',
  bathroom: 'Bathroom',
  ac_type: 'Air conditioning',
};
const fmt = (k, v) => (v == null ? '—' : ['smoking', 'balcony'].includes(k) ? (v ? 'Yes' : 'No') : typeof v === 'number' ? number(v, k === 'area_sqm' ? 1 : 0) : v);

export default function RoomDetail() {
  const { id } = useParams();
  const q = useApi(`/rooms/${id}`);
  return <Async q={q}>{(d) => <Room d={d} reload={q.reload} />}</Async>;
}

function Room({ d, reload }) {
  const { can, opProperty } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [block, setBlock] = useState(false);
  const [amenity, setAmenity] = useState(false);
  const [run, busy] = useAction();
  const r = d.room;
  const s = d.status;
  const allRooms = useApi(`/rooms?property=${r.property_id}`);
  const list = allRooms.data?.rooms || [];
  const i = list.findIndex((x) => x.id === r.id);
  const upload = async (file) => {
    const form = new FormData();
    form.append('file', file);
    await api(`/rooms/${r.id}/images`, { method: 'POST', form });
    reload();
  };
  return (
    <>
      <PageHead
        crumbs={
          <>
            <Link to="/rooms">Rooms</Link> / {r.number}
          </>
        }
        title={
          <span className="row" style={{ gap: 10 }}>
            Room {r.number} — {r.type_name} {s && <RoomCode code={s.code} />}
          </span>
        }
        sub={`${r.building_name} · ${r.floor_name} · ${r.type_category}`}
      >
        <Button icon={ChevronLeft} disabled={i <= 0} onClick={() => navigate(`/rooms/${list[i - 1].id}`)}>
          Previous
        </Button>
        <Button icon={ChevronRight} disabled={i < 0 || i >= list.length - 1} onClick={() => navigate(`/rooms/${list[i + 1].id}`)}>
          Next
        </Button>
      </PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'amenities', label: 'Amenities', count: r.amenities.length },
          { value: 'maintenance', label: 'Maintenance', count: d.blocks.length },
          { value: 'performance', label: 'Performance' },
          { value: 'history', label: 'Status history' },
        ]}
      />
      {tab === 'overview' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,.8fr)' }}>
          <div className="stack">
            <div className="room-hero">
              {d.images[0] && <img src={`/api/files/room-images/${d.images[0].file}`} alt={d.images[0].caption || `Room ${r.number}`} />}
              <div className="caption">
                <div style={{ fontSize: 22, fontWeight: 700 }}>{r.number}</div>
                <div>
                  {r.type_name} · {fmt('area_sqft', r.attributes.area_sqft.value)} sq ft · {r.attributes.view_type.value} view
                </div>
                {!d.images.length && <div className="small" style={{ opacity: 0.85, marginTop: 4 }}>No photographs uploaded yet</div>}
              </div>
            </div>
            {can('rooms.manage') && !WEB_DEMO && (
              <label className="btn sm" style={{ alignSelf: 'flex-start' }}>
                <ImagePlus size={14} /> Upload photo
                <input type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => e.target.files[0] && run(() => upload(e.target.files[0]), { success: 'Photo added' })} />
              </label>
            )}
            {r.description && <p className="muted">{r.description}</p>}
          </div>
          <Card title="Room information" sub="“Room” marks a value set on this room; others come from the room type">
            <div className="dl">
              <dt>Room number</dt>
              <dd>{r.number}</dd>
              <dt>Room type</dt>
              <dd>{r.type_name}</dd>
              <dt>Building / floor</dt>
              <dd>
                {r.building_name} · {r.floor_name}
              </dd>
              {Object.keys(LABELS).map((k) => (
                <FragmentRow key={k} label={LABELS[k]} value={fmt(k, r.attributes[k]?.value)} source={r.attributes[k]?.source} />
              ))}
              <dt>Accessible</dt>
              <dd>{r.accessible ? `Yes — ${r.accessibility_features.join(', ')}` : 'No'}</dd>
              <dt>Connecting room</dt>
              <dd>{r.connecting_room_number || '—'}</dd>
              <dt>Cost centre</dt>
              <dd>{r.cost_centre_name || '—'}</dd>
              <dt>Last refurbished</dt>
              <dd>{date(r.last_refurbished_on)}</dd>
              <dt>Rate plans</dt>
              <dd>{r.rate_plan_codes ? r.rate_plan_codes.join(', ') : 'All rate plans'}</dd>
            </div>
          </Card>
          <div className="stack">
            <Card title="Current status">
              {s ? (
                <div className="dl">
                  <dt>Occupancy</dt>
                  <dd>{s.occupied ? <Badge tone="info">Occupied</Badge> : <Badge tone="good">Vacant</Badge>}</dd>
                  <dt>Housekeeping</dt>
                  <dd>
                    <Badge tone={{ inspected: 'teal', clean: 'good', dirty: 'warn', cleaning: 'violet' }[s.hk_status]}>{titleCase(s.hk_status)}</Badge>
                  </dd>
                  <dt>Maintenance</dt>
                  <dd>{s.block ? <Badge tone="danger">{s.block.kind === 'ooo' ? 'Out of order' : 'Out of service'}</Badge> : s.maintenance_flag === 'required' ? <Badge tone="warn">Required</Badge> : <Badge tone="good">Good</Badge>}</dd>
                  {s.dnd ? (
                    <>
                      <dt>Service</dt>
                      <dd>
                        <Badge tone="violet">Do not disturb</Badge>
                      </dd>
                    </>
                  ) : null}
                  {s.occupant && (
                    <>
                      <dt>Guest</dt>
                      <dd>
                        <Link to={`/reservations/${s.occupant.reservationId}`}>{s.occupant.guest}</Link>
                        <div className="small muted">until {date(s.occupant.departure)}</div>
                      </dd>
                    </>
                  )}
                  {s.arrival && (
                    <>
                      <dt>Arriving today</dt>
                      <dd>
                        <Link to={`/reservations/${s.arrival.reservationId}`}>{s.arrival.guest}</Link>
                      </dd>
                    </>
                  )}
                </div>
              ) : (
                <Empty title="Not in service" />
              )}
              <div className="stack" style={{ gap: 8, marginTop: 14 }}>
                <Link className="btn primary" to={`/calendar`}>
                  View on calendar
                </Link>
                {can('rooms.block') && (
                  <Button icon={Wrench} onClick={() => setBlock(true)}>
                    Block room
                  </Button>
                )}
                <Link className="btn" to="/housekeeping">
                  Housekeeping
                </Link>
              </div>
            </Card>
            <Card title="Upcoming stays">
              {d.upcoming.length ? (
                <ul className="list-plain">
                  {d.upcoming.map((u) => (
                    <li key={u.id}>
                      <div style={{ flex: 1 }}>
                        <Link to={`/reservations/${u.id}`}>{u.guest}</Link>
                        <div className="small muted">
                          {date(u.from_night, { year: false })} → {date(u.out_date, { year: false })} in this room · {u.conf_no}
                        </div>
                      </div>
                      <Badge tone={u.status === 'in_house' ? 'good' : 'info'}>{u.status === 'in_house' ? 'In house' : 'Booked'}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="No upcoming stays" />
              )}
            </Card>
          </div>
        </div>
      )}
      {tab === 'amenities' && (
        <Card
          title="Amenities"
          sub="Inherited from the room type unless marked as a room exception"
          action={
            can('rooms.manage') && (
              <Button size="sm" onClick={() => setAmenity(true)}>
                Add exception
              </Button>
            )
          }
        >
          <div className="amenity-grid">
            {r.amenities.map((a) => (
              <div key={a.code} className="chip">
                {a.name}
                {a.source === 'room' && <span className="src room" title={a.reason}>Room</span>}
              </div>
            ))}
          </div>
          {r.amenityExceptions.length > 0 && (
            <>
              <div className="divider" />
              <div className="small strong" style={{ marginBottom: 6 }}>
                Authorised exceptions
              </div>
              <ul className="list-plain">
                {r.amenityExceptions.map((x) => (
                  <li key={x.code}>
                    <Badge tone={x.mode === 'add' ? 'good' : 'danger'}>{x.mode === 'add' ? 'Added' : 'Removed'}</Badge>
                    <b>{x.name}</b>
                    <span className="small muted">
                      {x.reason} · {x.approved_by_name || 'system'} · {dateTime(x.at)}
                    </span>
                    <span className="spacer" />
                    {can('rooms.manage') && (
                      <Button size="xs" busy={busy} onClick={() => run(async () => { await api.put(`/rooms/${r.id}/amenities`, { amenity: x.code, mode: 'inherit' }); reload(); }, { success: 'Exception removed' })}>
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      {tab === 'maintenance' && (
        <div className="stack">
          <Card title="Out-of-order and out-of-service history" flush>
            <DataTable
              rows={d.blocks}
              empty={<Empty title="No maintenance blocks" />}
              columns={[
                { key: 'kind', label: 'Type', render: (b) => <Badge tone={b.kind === 'ooo' ? 'danger' : ''}>{b.kind === 'ooo' ? 'Out of order' : 'Out of service'}</Badge> },
                { key: 'start_date', label: 'From', render: (b) => date(b.start_date) },
                { key: 'end_date', label: 'Back in service', render: (b) => date(b.end_date) },
                { key: 'reason', label: 'Reason' },
                { key: 'created_by_name', label: 'By', render: (b) => b.created_by_name || '—' },
                {
                  key: 'state',
                  label: '',
                  sortable: false,
                  render: (b) =>
                    b.released_at ? (
                      <Badge>Released</Badge>
                    ) : b.end_date > (opProperty?.business_date || '') && can('rooms.block') ? (
                      <Button size="xs" busy={busy} onClick={() => run(async () => { await api.post(`/blocks/${b.id}/release`); reload(); }, { success: 'Room back in service' })}>
                        Release now
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
          <Card title="Assets" flush>
            <DataTable rows={d.assets} empty={<Empty title="No assets registered for this room">The asset register arrives with the Maintenance & Engineering module.</Empty>} columns={[{ key: 'name', label: 'Asset' }, { key: 'category', label: 'Category' }, { key: 'warranty_until', label: 'Warranty until', render: (a) => date(a.warranty_until) }]} />
          </Card>
          {r.warranty_notes && <Notice>{r.warranty_notes}</Notice>}
        </div>
      )}
      {tab === 'performance' && (
        <div className="stack">
          <div className="kpi-strip">
            <div className="kpi">
              <span className="label">Occupied nights</span>
              <span className="value">{number(d.stats.occupied_nights)}</span>
              <span className="foot">of {number(d.stats.available_nights)} available</span>
            </div>
            <div className="kpi">
              <span className="label">Occupancy</span>
              <span className="value">{pct(d.stats.occupancy_pct)}</span>
              <span className="foot">
                {date(d.stats.period.from)} – {date(d.stats.period.to)}
              </span>
            </div>
            {d.stats.room_revenue_minor != null && (
              <>
                <div className="kpi">
                  <span className="label">Room revenue</span>
                  <span className="value">{money(d.stats.room_revenue_minor, d.stats.currency, { decimals: 0 })}</span>
                  <span className="foot">net of tax</span>
                </div>
                <div className="kpi">
                  <span className="label">ADR</span>
                  <span className="value">{money(d.stats.adr_minor, d.stats.currency, { decimals: 0 })}</span>
                </div>
              </>
            )}
          </div>
          <Notice>
            Room-level costs (housekeeping, laundry, amenities, energy, maintenance, allocated payroll and overhead) and room profitability arrive with the Finance module (Phase 4).
            Measured and allocated costs will be shown separately, with the allocation driver for each.
          </Notice>
        </div>
      )}
      {tab === 'history' && (
        <Card flush>
          <DataTable
            rows={d.statusLog}
            empty={<Empty title="No status changes recorded" />}
            columns={[
              { key: 'at', label: 'When', render: (l) => dateTime(l.at) },
              { key: 'field', label: 'Field', render: (l) => titleCase(l.field) },
              { key: 'change', label: 'Change', render: (l) => `${l.from_value} → ${l.to_value}` },
              { key: 'reason', label: 'Reason', render: (l) => l.reason || '—' },
              { key: 'user_name', label: 'By', render: (l) => l.user_name || 'System' },
            ]}
          />
        </Card>
      )}
      {block && (
        <BlockForm
          room={r}
          defaultStart={opProperty?.business_date}
          onClose={() => setBlock(false)}
          onDone={() => {
            setBlock(false);
            reload();
          }}
        />
      )}
      {amenity && <AmenityException room={r} onClose={() => setAmenity(false)} onDone={() => { setAmenity(false); reload(); }} />}
    </>
  );
}

function FragmentRow({ label, value, source }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value}
        {source === 'room' && <span className="src room">Room</span>}
      </dd>
    </>
  );
}

function AmenityException({ room, onClose, onDone }) {
  const all = useApi('/amenities');
  const [f, setF] = useState({ amenity: '', mode: 'add', reason: '' });
  const [run, busy] = useAction();
  return (
    <Modal
      title={`Amenity exception — room ${room.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!f.amenity || !f.reason} onClick={() => run(async () => { await api.put(`/rooms/${room.id}/amenities`, f); onDone(); }, { success: 'Exception recorded' })}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Change">
          <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={[{ value: 'add', label: 'Add an amenity this room has' }, { value: 'remove', label: 'Remove an amenity this room lacks' }]} />
        </Field>
        <Field label="Amenity">
          <Select value={f.amenity} placeholder="Choose" options={(all.data || []).map((a) => ({ value: a.code, label: `${a.name} (${a.category})` }))} onChange={(e) => setF({ ...f, amenity: e.target.value })} />
        </Field>
        <Field label="Reason (recorded with your name)">
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Bathtub replaced by walk-in shower in 2025 refit" />
        </Field>
      </div>
    </Modal>
  );
}
