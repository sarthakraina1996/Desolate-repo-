// Revenue: the rate grid (ARI — availability, rates and restrictions per room type, rate plan
// and night), bulk rate and restriction updates, and the rate plans with their derivations.
// Forecasting and dynamic pricing arrive in Phase 5.
import { useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Layers, Lock, TrendingUp } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, usePref } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { addDays, dow } from '../lib/dates.js';
import { dayName, money, number } from '../lib/format.js';
import { Async, Badge, Button, Card, Field, Input, Modal, Notice, PageHead, Select, Tabs, useAction } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';

export default function Revenue() {
  const { property, opProperty, properties, setScope, can } = useApp();
  const prop = property || opProperty;
  const [tab, setTab] = usePref('rev-tab', 'grid');
  if (!prop) return null;
  return (
    <>
      <PageHead title="Revenue" sub={`${prop.name} · Right Room · Right Price · Right Place`}>
        {properties.length > 1 && <Select aria-label="Property" value={prop.id} onChange={(e) => setScope(e.target.value)} options={properties.map((p) => ({ value: p.id, label: p.name }))} />}
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'grid', label: 'Rate grid (ARI)', icon: CalendarRange }, { value: 'plans', label: 'Rate plans', icon: Layers }, { value: 'pricing', label: 'Dynamic pricing', icon: TrendingUp }]} />
      {tab === 'grid' && <RateGrid prop={prop} canEdit={can('rates.manage')} />}
      {tab === 'plans' && <Plans prop={prop} />}
      {tab === 'pricing' && (
        <Card title="Forecasting and dynamic pricing — Phase 5">
          <div className="stack">
            <Notice>
              Not built yet. The planned engine starts as a transparent, configurable rules engine that evaluates expected demand and revenue across candidate price points (using pace,
              pickup, lead time, seasonality, events and remaining inventory), recommends a rate with its reasons, and applies it only with manager approval or within approved
              constraints, with rollback and history. Statistical / ML forecasting is added once enough reliable history exists. Recommendations will never be presented as guaranteed.
            </Notice>
            <div className="small muted">Today: rates are managed in the rate grid; the dashboard shows pace through on-the-books room nights and the 14-night house forecast on the Front Desk dashboard.</div>
          </div>
        </Card>
      )}
    </>
  );
}

function RateGrid({ prop, canEdit }) {
  const [from, setFrom] = useState(prop.business_date);
  const days = 14;
  const q = useApi(`/rates/grid${qs({ property: prop.id, from, days })}`);
  const [edit, setEdit] = useState(null);
  const [restrict, setRestrict] = useState(null);
  return (
    <div className="stack">
      <div className="row wrap">
        <Button icon={ChevronLeft} aria-label="Earlier" onClick={() => setFrom(addDays(from, -days))} />
        <Button onClick={() => setFrom(prop.business_date)}>Today</Button>
        <Button icon={ChevronRight} aria-label="Later" onClick={() => setFrom(addDays(from, days))} />
        <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" />
        <span className="spacer" />
        <span className="small muted">Prices are per room per night for base occupancy, {prop.currency === 'INR' ? 'excluding GST' : 'including VAT'}. Shaded cells are explicit overrides; derived plans follow their parent.</span>
        {canEdit && <Button icon={Lock} onClick={() => setRestrict({})}>Set restrictions</Button>}
      </div>
      <Async q={q}>
        {(g) => (
          <div className="rate-grid">
            <table>
              <thead>
                <tr>
                  <th>Room type / rate plan</th>
                  {g.nights.map((n) => (
                    <th key={n} className={[5, 6].includes(dow(n)) ? 'weekend' : ''}>
                      {dayName(n)}
                      <br />
                      {n.slice(8)}/{n.slice(5, 7)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.roomTypes.map((t) => (
                  <>
                    <tr key={`t${t.id}`} className="type-row">
                      <td>
                        <span className="swatch" style={{ background: t.color, marginRight: 6 }} />
                        {t.name} <span className="faint small">available</span>
                      </td>
                      {t.availability.map((a, i) => (
                        <td key={i} className={t.restrictions[i]?.length ? 'restricted' : ''} title={t.restrictions[i]?.map((r) => [r.stop_sell && 'Stop sell', r.cta && 'CTA', r.ctd && 'CTD', r.min_los && `Min LOS ${r.min_los}`, r.max_los && `Max LOS ${r.max_los}`].filter(Boolean).join(', ')).join('; ')}>
                          <span style={{ color: a?.available <= 0 ? 'var(--danger)' : a?.available <= 2 ? 'var(--warn)' : undefined }}>{a?.available ?? '—'}</span>
                          {t.restrictions[i]?.some((r) => r.stop_sell) && <Badge tone="danger">Stop</Badge>}
                          {t.restrictions[i]?.some((r) => r.min_los) && <div className="small faint">min {Math.max(...t.restrictions[i].map((r) => r.min_los || 0))}</div>}
                        </td>
                      ))}
                    </tr>
                    {t.plans.map((p) => (
                      <tr key={`p${t.id}-${p.id}`}>
                        <td>
                          <span style={{ paddingLeft: 18 }}>{p.code}</span> <span className="small muted">{p.name}</span> {p.derived && <Badge>derived</Badge>}
                        </td>
                        {p.rates.map((r) => (
                          <td
                            key={r.night}
                            className={`${r.override ? 'override' : ''} ${[5, 6].includes(dow(r.night)) && !r.override ? 'weekend' : ''}`}
                            style={{ cursor: canEdit && !p.derived ? 'pointer' : undefined }}
                            onClick={() => canEdit && !p.derived && setEdit({ type: t, plan: p, night: r.night, rate: r.rate_minor })}
                          >
                            {r.rate_minor == null ? '—' : money(r.rate_minor, prop.currency, { decimals: 0 })}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      {edit && <RateEdit prop={prop} edit={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); q.reload(); }} />}
      {restrict && <RestrictionEdit prop={prop} types={q.data?.roomTypes || []} from={from} onClose={() => setRestrict(null)} onDone={() => { setRestrict(null); q.reload(); }} />}
    </div>
  );
}

function RateEdit({ prop, edit, onClose, onDone }) {
  const [f, setF] = useState({ from: edit.night, to: addDays(edit.night, 1), amount: edit.rate != null ? String(edit.rate / 100) : '', weekdays: [] });
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <Modal title={`${edit.plan.code} · ${edit.type.name}`} onClose={onClose} footer={<><Button onClick={() => run(async () => { await api.put('/rates/daily', { propertyId: prop.id, ratePlanId: edit.plan.id, roomTypeId: edit.type.id, from: f.from, to: f.to, amount: null, weekdays: f.weekdays.length ? f.weekdays : null }); onDone(); }, { success: 'Overrides removed', onError: setErr })}>Clear overrides</Button><span className="spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!f.amount} onClick={() => run(async () => { const r = await api.put('/rates/daily', { propertyId: prop.id, ratePlanId: edit.plan.id, roomTypeId: edit.type.id, from: f.from, to: f.to, amount: f.amount, weekdays: f.weekdays.length ? f.weekdays : null }); onDone(); return r; }, { success: (r) => `Rate set for ${r.nights} night(s)`, onError: setErr })}>Set rate</Button></>}>
      <div className="form-grid">
        <Field label="From night"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Until (exclusive)"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label={`Rate (${prop.currency})`} className="span2"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
      </div>
      <div className="small strong" style={{ margin: '12px 0 6px' }}>Only these weekdays (optional)</div>
      <div className="row wrap">
        {days.map((d, i) => (
          <label key={d} className="check"><input type="checkbox" checked={f.weekdays.includes(i)} onChange={(e) => setF({ ...f, weekdays: e.target.checked ? [...f.weekdays, i] : f.weekdays.filter((x) => x !== i) })} /> {d}</label>
        ))}
      </div>
      {err && <div style={{ marginTop: 10 }}><Notice tone="danger">{err.message}</Notice></div>}
      <div className="small muted" style={{ marginTop: 10 }}>Derived plans (BB, NRF, Corporate, Long stay) follow this change automatically. Existing reservations keep the rate they were booked at.</div>
    </Modal>
  );
}

function RestrictionEdit({ prop, types, from, onClose, onDone }) {
  const [f, setF] = useState({ roomTypeId: 0, from, to: addDays(from, 1), min_los: '', max_los: '', cta: false, ctd: false, stop_sell: false });
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  return (
    <Modal title="Stay restrictions" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => run(async () => { await api.put('/rates/restrictions', { propertyId: prop.id, ...f, roomTypeId: Number(f.roomTypeId) }); onDone(); }, { success: 'Restrictions saved (all cleared values remove the restriction)', onError: setErr })}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Room type" className="span2"><Select value={f.roomTypeId} options={[{ value: 0, label: 'All room types' }, ...types.map((t) => ({ value: t.id, label: t.name }))]} onChange={(e) => setF({ ...f, roomTypeId: e.target.value })} /></Field>
        <Field label="From night"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Until (exclusive)"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Minimum stay (nights) for arrivals"><Input type="number" min={1} value={f.min_los} onChange={(e) => setF({ ...f, min_los: e.target.value })} /></Field>
        <Field label="Maximum stay (nights)"><Input type="number" min={1} value={f.max_los} onChange={(e) => setF({ ...f, max_los: e.target.value })} /></Field>
      </div>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <label className="check"><input type="checkbox" checked={f.cta} onChange={(e) => setF({ ...f, cta: e.target.checked })} /> Closed to arrival</label>
        <label className="check"><input type="checkbox" checked={f.ctd} onChange={(e) => setF({ ...f, ctd: e.target.checked })} /> Closed to departure</label>
        <label className="check"><input type="checkbox" checked={f.stop_sell} onChange={(e) => setF({ ...f, stop_sell: e.target.checked })} /> Stop sell</label>
      </div>
      {err && <div style={{ marginTop: 10 }}><Notice tone="danger">{err.message}</Notice></div>}
      <div className="small muted" style={{ marginTop: 10 }}>Restrictions apply to new bookings here and will be published to channels when the Channel Manager is connected.</div>
    </Modal>
  );
}

function Plans({ prop }) {
  const q = useApi(`/rate-plans${qs({ property: prop.id })}`);
  const types = useApi(`/room-types${qs({ property: prop.id })}`);
  return (
    <Card flush>
      <Async q={q}>
        {(d) => (
          <DataTable
            rows={d.plans}
            columns={[
              { key: 'code', label: 'Code', render: (p) => <b>{p.code}</b> },
              { key: 'name', label: 'Rate plan' },
              { key: 'meal_plan', label: 'Meal plan' },
              { key: 'derive', label: 'Pricing', sortable: false, render: (p) => (p.parent_id ? `${p.parent_code} ${p.derive_kind === 'percent' ? `${p.derive_value > 0 ? '+' : ''}${p.derive_value / 100}%` : `${p.derive_value > 0 ? '+' : ''}${money(p.derive_value, prop.currency, { decimals: 0 })}`}` : `Base rates for ${p.roomTypes.length} room types`) },
              { key: 'cancellation_policy_name', label: 'Cancellation' },
              { key: 'min_los', label: 'Min LOS', num: true },
              { key: 'is_public', label: 'Public', render: (p) => (p.is_public ? <Badge tone="good">Public</Badge> : <Badge>Negotiated</Badge>) },
              { key: 'fnb', label: 'F&B component', num: true, render: (p) => (p.fnb_component_minor ? `${money(p.fnb_component_minor, prop.currency, { decimals: 0 })} / adult` : '—') },
              { key: 'base', label: 'Base (first type)', num: true, sortable: false, render: (p) => (p.roomTypes[0] ? `${money(p.roomTypes[0].base_minor, prop.currency, { decimals: 0 })} · ${types.data?.find((t) => t.id === p.roomTypes[0].room_type_id)?.code || ''}` : '—') },
            ]}
          />
        )}
      </Async>
      <div className="small muted" style={{ padding: 12 }}>Package components (breakfast) are posted to F&B revenue at the night audit, not to rooms. {number(q.data?.plans?.length)} plans.</div>
    </Card>
  );
}
