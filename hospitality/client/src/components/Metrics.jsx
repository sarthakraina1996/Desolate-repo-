// Shared metric UI: period / comparison picker, metric explanation and drill-down modal.
import { useState } from 'react';
import { Info } from 'lucide-react';
import { useApi } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { date, money, number } from '../lib/format.js';
import { DataTable } from './DataTable.jsx';
import { Async, Button, Field, Input, Modal, Select } from './ui.jsx';

export const PERIODS = [
  { value: 'today', label: 'Today (provisional)' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'mtd', label: 'Month to date' },
  { value: 'qtd', label: 'Quarter to date' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'fy', label: 'Financial year to date' },
  { value: 'custom', label: 'Custom range…' },
];
export const COMPARES = [
  { value: 'previous', label: 'vs previous period' },
  { value: 'last_year', label: 'vs same period last year' },
  { value: 'none', label: 'No comparison' },
];

// period: { preset, from, to, compare }
export function PeriodPicker({ value, onChange, compare = true }) {
  const [custom, setCustom] = useState({ from: value.from || '', to: value.to || '' });
  return (
    <>
      <Select aria-label="Period" value={value.preset} options={PERIODS} onChange={(e) => onChange({ ...value, preset: e.target.value })} />
      {value.preset === 'custom' && (
        <>
          <Input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <Input type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          <Button size="sm" disabled={!custom.from || !custom.to} onClick={() => onChange({ ...value, ...custom })}>
            Apply
          </Button>
        </>
      )}
      {compare && <Select aria-label="Comparison" value={value.compare} options={COMPARES} onChange={(e) => onChange({ ...value, compare: e.target.value })} />}
    </>
  );
}

export const periodQuery = (p) => ({ preset: p.preset, from: p.preset === 'custom' ? p.from : undefined, to: p.preset === 'custom' ? p.to : undefined, compare: p.compare });

// Drill-down: the source rows behind a metric, with their sum.
export function Drilldown({ metric, title, scope, period, currency, onClose }) {
  const [offset, setOffset] = useState(0);
  const q = useApi(`/metrics/drilldown${qs({ metric, property: scope, ...periodQuery(period), limit: 50, offset })}`);
  const defs = useApi('/metrics/definitions');
  const def = defs.data?.find((d) => d.id === metric);
  return (
    <Modal title={title} onClose={onClose} size="xl">
      {def && (
        <div className="notice" style={{ marginBottom: 12 }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b>{def.formula}.</b> {def.definition}
            {def.assumptions?.length ? <div className="small" style={{ marginTop: 4 }}>{def.assumptions.join(' ')}</div> : null}
            {def.exclusions?.length ? <div className="small">Excludes: {def.exclusions.join('; ')}.</div> : null}
          </div>
        </div>
      )}
      <Async q={q}>
        {(d) => (
          <>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {date(d.period.from)} – {date(d.period.to)} · {number(d.total)} source rows
              {d.sum_minor != null && (
                <>
                  {' '}
                  · sum of rows <b className="num">{money(d.sum_minor, currency)}</b> {d.note && <span>({d.note})</span>}
                </>
              )}
            </div>
            <DataTable
              rows={d.rows}
              rowKey={(r) => `${r.id ?? r.reservation_id}-${r.night ?? r.business_date ?? ''}-${r.room ?? ''}`}
              columns={
                d.kind === 'postings'
                  ? [
                      { key: 'business_date', label: 'Date', render: (r) => date(r.business_date) },
                      { key: 'property', label: 'Property' },
                      { key: 'conf_no', label: 'Reservation', render: (r) => r.conf_no || '—' },
                      { key: 'guest', label: 'Guest / account', render: (r) => r.guest || r.folio_no },
                      { key: 'description', label: 'Description' },
                      { key: 'net_minor', label: 'Net', num: true, render: (r) => money(r.net_minor, r.currency) },
                    ]
                  : d.kind === 'room_nights'
                    ? [
                        { key: 'night', label: 'Night', render: (r) => date(r.night) },
                        { key: 'property', label: 'Property' },
                        { key: 'room', label: 'Room', render: (r) => r.room || 'Unassigned' },
                        { key: 'room_type', label: 'Type' },
                        { key: 'conf_no', label: 'Reservation' },
                        { key: 'guest', label: 'Guest' },
                        { key: 'source', label: 'Source', render: (r) => r.channel || r.source },
                        { key: 'rate_minor', label: 'Rate', num: true, render: (r) => money(r.rate_minor, r.currency) },
                      ]
                    : [
                        { key: 'conf_no', label: 'Reservation' },
                        { key: 'property', label: 'Property' },
                        { key: 'guest', label: 'Guest' },
                        { key: 'arrival', label: 'Arrival', render: (r) => date(r.arrival) },
                        { key: 'nights', label: 'Nights', num: true },
                        { key: 'source', label: 'Source', render: (r) => r.channel || r.source },
                        { key: 'cancel_reason', label: 'Reason', render: (r) => r.cancel_reason || '—' },
                      ]
              }
              pageSize={50}
              total={d.total}
              page={Math.floor(offset / 50)}
              onPage={(p) => setOffset(p * 50)}
              dense
            />
          </>
        )}
      </Async>
    </Modal>
  );
}

export function ExplainButton({ onClick }) {
  return (
    <button className="btn ghost xs" onClick={onClick} aria-label="How is this calculated?" title="How is this calculated?">
      <Info size={13} />
    </button>
  );
}

export function FieldRange({ from, to, onFrom, onTo }) {
  return (
    <>
      <Field label="From">
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
      </Field>
      <Field label="To">
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      </Field>
    </>
  );
}
