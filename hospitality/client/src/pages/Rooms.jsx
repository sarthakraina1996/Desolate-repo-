// Rooms: list with live status, floor view by building and floor, and room types with their
// standard amenities (which individual rooms inherit).
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building, LayoutGrid, List, Layers } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, usePref } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { number, plural } from '../lib/format.js';
import { Async, Badge, Card, Empty, Input, PageHead, ROOM_CODES, RoomCode, Select, Tabs } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';

export default function Rooms() {
  const { property, opProperty, properties, setScope } = useApp();
  const prop = property || opProperty;
  const [params] = useSearchParams();
  const [tab, setTab] = usePref('rooms-tab', 'floor');
  const [code, setCode] = useState(params.get('code') || '');
  const [type, setType] = useState(params.get('type') || '');
  const [search, setSearch] = useState('');
  const q = useApi(prop ? `/rooms${qs({ property: prop.id })}` : null);
  const types = useApi(prop ? `/room-types${qs({ property: prop.id })}` : null);
  const navigate = useNavigate();
  const rows = useMemo(
    () => (q.data?.rooms || []).filter((r) => (!code || r.code === code) && (!type || String(r.room_type_id) === type) && (!search || r.number.includes(search) || r.occupant?.guest.toLowerCase().includes(search.toLowerCase()))),
    [q.data, code, type, search],
  );
  if (!prop) return null;
  const counts = {};
  for (const r of q.data?.rooms || []) counts[r.code] = (counts[r.code] || 0) + 1;
  return (
    <>
      <PageHead title="Rooms" sub={`${prop.name} · ${number(q.data?.rooms.length)} rooms`}>
        {properties.length > 1 && <Select aria-label="Property" value={prop.id} onChange={(e) => setScope(e.target.value)} options={properties.map((p) => ({ value: p.id, label: p.name }))} />}
      </PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'floor', label: 'Floor view', icon: LayoutGrid },
          { value: 'list', label: 'Room list', icon: List },
          { value: 'types', label: 'Room types', icon: Layers, count: types.data?.length },
        ]}
      />
      {tab !== 'types' && (
        <div className="filters">
          <Input className="search" placeholder="Room number or guest" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          <Select aria-label="Status" value={code} placeholder="All statuses" options={Object.entries(ROOM_CODES).map(([k, v]) => ({ value: k, label: `${v.label} (${counts[k] || 0})` }))} onChange={(e) => setCode(e.target.value)} />
          <Select aria-label="Room type" value={type} placeholder="All room types" options={(types.data || []).map((t) => ({ value: String(t.id), label: t.name }))} onChange={(e) => setType(e.target.value)} />
          <div className="row wrap" style={{ gap: 6 }}>
            {Object.entries(counts).map(([k, n]) => (
              <span key={k} className="small">
                <RoomCode code={k} short /> {n}
              </span>
            ))}
          </div>
        </div>
      )}
      {tab === 'floor' && (
        <Async q={q} isEmpty={() => !rows.length} emptyView={<Empty title="No rooms match" />}>
          {() => <FloorView rooms={rows} />}
        </Async>
      )}
      {tab === 'list' && (
        <Card flush>
          <Async q={q}>
            {() => (
              <DataTable
                rows={rows}
                onRowClick={(r) => navigate(`/rooms/${r.id}`)}
                exportName={`rooms-${prop.code}.csv`}
                pageSize={50}
                columns={[
                  { key: 'number', label: 'Room', render: (r) => <b>{r.number}</b>, value: (r) => r.number.padStart(6, '0') },
                  { key: 'type_name', label: 'Type' },
                  { key: 'building_name', label: 'Building' },
                  { key: 'floor_level', label: 'Floor', num: true },
                  { key: 'area_sqft', label: 'Area (sq ft)', num: true, render: (r) => number(r.area_sqft) },
                  { key: 'view_type', label: 'View' },
                  { key: 'code', label: 'Status', render: (r) => <RoomCode code={r.code} /> },
                  { key: 'occupant', label: 'Guest', value: (r) => r.occupant?.guest || '', render: (r) => (r.occupant ? `${r.occupant.guest}${r.occupant.dueOut ? ' · due out' : ''}` : r.arrival ? <span className="muted">Arriving: {r.arrival.guest}</span> : '—') },
                  { key: 'flags', label: 'Flags', sortable: false, render: (r) => <span className="row">{r.dnd ? <Badge tone="violet">DND</Badge> : null}{r.maintenance_flag === 'required' ? <Badge tone="warn">Maintenance</Badge> : null}{r.accessible ? <Badge>Accessible</Badge> : null}</span> },
                ]}
              />
            )}
          </Async>
        </Card>
      )}
      {tab === 'types' && <RoomTypes q={types} />}
    </>
  );
}

function FloorView({ rooms }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rooms) {
      const k = `${r.building_name}|${r.floor_level}`;
      if (!m.has(k)) m.set(k, { building: r.building_name, level: r.floor_level, name: r.floor_name, rooms: [] });
      m.get(k).rooms.push(r);
    }
    return [...m.values()].sort((a, b) => a.building.localeCompare(b.building) || b.level - a.level);
  }, [rooms]);
  const navigate = useNavigate();
  let lastBuilding = null;
  return (
    <div className="floor-plan">
      {groups.map((g) => {
        const head = g.building !== lastBuilding;
        lastBuilding = g.building;
        return (
          <div key={`${g.building}-${g.level}`}>
            {head && (
              <div className="row strong" style={{ margin: '8px 0' }}>
                <Building size={16} className="muted" /> {g.building}
              </div>
            )}
            <div className="floor-row">
              <div className="lvl">{g.name}</div>
              <div className="hk-tiles" style={{ flex: 1 }}>
                {g.rooms.map((r) => (
                  <button key={r.id} className={`hk-tile ${r.code}`} onClick={() => navigate(`/rooms/${r.id}`)} title={`${r.number} · ${r.type_name} · ${ROOM_CODES[r.code]?.label}`}>
                    <div className="row">
                      <span className="no">{r.number}</span>
                      <span className="spacer" />
                      <RoomCode code={r.code} short />
                    </div>
                    <span className="small muted">{r.type_code}</span>
                    <span className="small" style={{ minHeight: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.occupant ? r.occupant.guest : r.arrival ? `→ ${r.arrival.guest}` : r.block ? r.block.reason : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoomTypes({ q }) {
  return (
    <Async q={q}>
      {(types) => (
        <div className="grid g3">
          {types.map((t) => (
            <Card key={t.id} title={t.name} sub={`${t.code} · ${t.category} · ${t.room_count} rooms`} action={<span className="swatch" style={{ background: t.color, width: 14, height: 14 }} />}>
              <div className="dl" style={{ marginBottom: 12 }}>
                <dt>Area</dt>
                <dd>
                  {number(t.area_sqft)} sq ft ({t.area_sqm} m²)
                </dd>
                <dt>Bed</dt>
                <dd>
                  {t.bed_type} · {t.bed_size}
                </dd>
                <dt>Occupancy</dt>
                <dd>
                  {plural(t.max_adults, 'adult')}, {plural(t.max_children, 'child', 'children')} (max {t.max_occupancy}){t.extra_beds ? ` · ${t.extra_beds} extra bed` : ''}
                </dd>
                <dt>View</dt>
                <dd>{t.view_type}</dd>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {t.amenities.map((a) => (
                  <span key={a.code} className="chip" style={{ padding: '3px 8px', fontSize: 12 }}>
                    {a.name}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <Link to={`/rooms?type=${t.id}`} className="small" onClick={() => {}}>
                  Rooms inherit these amenities; exceptions are set per room.
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Async>
  );
}
