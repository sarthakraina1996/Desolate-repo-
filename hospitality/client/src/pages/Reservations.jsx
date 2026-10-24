// Reservations register: server-side search, filters, sorting and paging; CSV export.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { date, money, number } from '../lib/format.js';
import { Async, Badge, Button, Card, Input, PageHead, Select, StatusBadge } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { BookingForm } from '../components/BookingForm.jsx';

const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_house', label: 'In house' },
  { value: 'checked_out,closed', label: 'Departed' },
  { value: 'quote', label: 'Quotes' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No-shows' },
];
const SOURCES = ['Direct', 'Website', 'Phone', 'Walk-in', 'Corporate', 'Group', 'Travel Agent', 'OTA'];

export default function Reservations() {
  const { scope, can, properties } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') || '');
  const dq = useDebounced(q, 300);
  const [f, setF] = useState({ status: params.get('status') || '', source: '', arrivalFrom: '', arrivalTo: '', sort: 'arrival', dir: 'desc', page: 0 });
  const [create, setCreate] = useState(false);
  useEffect(() => {
    if (params.get('q') !== null && params.get('q') !== q) setQ(params.get('q'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const data = useApi(
    `/reservations${qs({ property: scope, q: dq, status: f.status, source: f.source, arrivalFrom: f.arrivalFrom, arrivalTo: f.arrivalTo, sort: f.sort, dir: f.dir, limit: 25, offset: f.page * 25 })}`,
  );
  const multi = scope === 'all' && properties.length > 1;
  return (
    <>
      <PageHead title="Reservations" sub="Search, filter and open any booking">
        {can('reservations.create') && (
          <Button variant="accent" icon={Plus} onClick={() => setCreate(true)}>
            New booking
          </Button>
        )}
      </PageHead>
      <div className="filters">
        <Input
          className="search"
          style={{ width: 300 }}
          placeholder="Guest, confirmation no., email, phone or OTA ref"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setF({ ...f, page: 0 });
            if (params.get('q')) setParams({});
          }}
          aria-label="Search reservations"
        />
        <Select aria-label="Status" value={f.status} options={STATUSES} onChange={(e) => setF({ ...f, status: e.target.value, page: 0 })} />
        <Select aria-label="Source" value={f.source} placeholder="All sources" options={SOURCES.map((s) => ({ value: s, label: s }))} onChange={(e) => setF({ ...f, source: e.target.value, page: 0 })} />
        <label className="row small muted">
          Arrival from
          <Input type="date" value={f.arrivalFrom} onChange={(e) => setF({ ...f, arrivalFrom: e.target.value, page: 0 })} />
        </label>
        <label className="row small muted">
          to
          <Input type="date" value={f.arrivalTo} onChange={(e) => setF({ ...f, arrivalTo: e.target.value, page: 0 })} />
        </label>
      </div>
      <Card flush>
        <Async q={data}>
          {(d) => (
            <DataTable
              rows={d.rows}
              total={d.total}
              page={f.page}
              pageSize={25}
              onPage={(page) => setF({ ...f, page })}
              sort={f.sort}
              dir={f.dir}
              onSort={(sort, dir) => setF({ ...f, sort, dir, page: 0 })}
              onRowClick={(r) => navigate(`/reservations/${r.id}`)}
              exportName="reservations.csv"
              columns={[
                {
                  key: 'guest',
                  label: 'Guest',
                  render: (r) => (
                    <>
                      <b>
                        {r.vip ? '★ ' : ''}
                        {r.first_name} {r.last_name}
                      </b>
                      <div className="sub">{r.conf_no}</div>
                    </>
                  ),
                  csv: (r) => `${r.first_name} ${r.last_name}`,
                },
                ...(multi ? [{ key: 'property_code', label: 'Property', sortable: false }] : []),
                { key: 'arrival', label: 'Arrival', render: (r) => date(r.arrival), csv: (r) => r.arrival },
                { key: 'departure', label: 'Departure', render: (r) => date(r.departure), csv: (r) => r.departure },
                { key: 'nights', label: 'Nights', num: true, sortable: false },
                { key: 'room_type_code', label: 'Room', sortable: false, render: (r) => `${r.room_number || '—'} · ${r.room_type_code}`, csv: (r) => `${r.room_number || ''} ${r.room_type_code}` },
                { key: 'adults', label: 'Guests', sortable: false, render: (r) => `${r.adults}${r.children ? ` + ${r.children}` : ''}` },
                { key: 'source', label: 'Source', sortable: false, render: (r) => r.channel || r.source },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                {
                  key: 'total',
                  label: 'Room total',
                  num: true,
                  render: (r) => (r.total_minor == null ? '—' : r.is_complimentary ? <Badge tone="violet">Comp</Badge> : money(r.total_minor, r.currency)),
                  csv: (r) => (r.total_minor == null ? '' : r.total_minor / 100),
                },
              ]}
            />
          )}
        </Async>
      </Card>
      {data.data && <div className="small muted" style={{ marginTop: 8 }}>{number(data.data.total)} reservations match</div>}
      {create && (
        <BookingForm
          onClose={() => setCreate(false)}
          onCreated={(out) => {
            setCreate(false);
            navigate(`/reservations/${out.reservations[0].id}`);
          }}
        />
      )}
    </>
  );
}
