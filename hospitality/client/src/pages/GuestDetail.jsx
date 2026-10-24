// Guest profile: contact, preferences, identity, consent, stay history, spend by department,
// and data-subject export / erasure for authorised users.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, Pencil, UserX } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { date, money, titleCase } from '../lib/format.js';
import { Async, Badge, Button, Card, Confirm, Empty, Field, Input, Modal, Notice, PageHead, StatusBadge, Textarea, useAction } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { WEB_DEMO } from '../lib/env.js';

const DEPARTMENT_LABEL = { rooms: 'Rooms', fnb: 'F&B', banquets: 'Banquets', spa: 'Spa', other: 'Other services', misc: 'Miscellaneous' };

export default function GuestDetail() {
  const { id } = useParams();
  const q = useApi(`/guests/${id}`);
  return <Async q={q}>{(d) => <Guest d={d} reload={q.reload} />}</Async>;
}

function Guest({ d, reload }) {
  const { can } = useApp();
  const navigate = useNavigate();
  const g = d.guest;
  const [edit, setEdit] = useState(false);
  const [erase, setErase] = useState(false);
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  const exportData = async () => {
    const data = await api.get(`/guests/${g.id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `guest-${g.id}-export.json`;
    a.click();
  };
  return (
    <>
      <PageHead
        crumbs={<><Link to="/guests">Guests</Link> / {g.first_name} {g.last_name}</>}
        title={<span className="row" style={{ gap: 10 }}>{g.first_name} {g.last_name} {g.vip ? <Badge tone="warn">{g.vip}</Badge> : null} {g.anonymized_at && <Badge tone="danger">Erased</Badge>}</span>}
        sub={`${d.stays.length} stay(s)${g.company_name ? ` · ${g.company_name}` : ''}`}
      >
        {can('guests.manage') && !g.anonymized_at && <Button icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>}
        {can('guests.privacy') && !WEB_DEMO && <Button icon={Download} onClick={() => run(exportData, { success: 'Export downloaded' })}>Export data</Button>}
        {can('guests.privacy') && can('guests.manage') && !g.anonymized_at && <Button className="danger" icon={UserX} onClick={() => setErase(true)}>Erase</Button>}
      </PageHead>
      <div className="grid g-1-2">
        <div className="stack">
          <Card title="Profile">
            <div className="dl">
              <dt>Email</dt><dd>{g.email || '—'}</dd>
              <dt>Phone</dt><dd>{g.phone || '—'}</dd>
              <dt>Nationality</dt><dd>{g.nationality || '—'}</dd>
              <dt>City</dt><dd>{g.city || '—'}</dd>
              <dt>Loyalty</dt><dd>{g.loyalty_no || '—'}</dd>
              <dt>Identity</dt><dd>{g.id_verified_at ? `${titleCase(g.id_type)} ${g.id_number_masked} (verified ${date(g.id_verified_at)})` : 'Not verified'}</dd>
              <dt>Marketing consent</dt><dd>{g.marketing_consent ? `Yes (${date(g.consent_at)})` : 'No'}</dd>
              <dt>Preferences</dt><dd>{g.preferences?.length ? g.preferences.join(', ') : '—'}</dd>
            </div>
            {g.notes && <div className="small muted" style={{ marginTop: 10 }}>{g.notes}</div>}
            {g.pii_masked && <Notice>Contact details are masked for your role.</Notice>}
          </Card>
          {d.spend && (
            <Card title="Spend by department" sub="Net of tax, all stays in your properties">
              {d.spend.length ? (
                <ul className="list-plain">{d.spend.map((s) => <li key={s.currency + s.department}><span style={{ flex: 1 }}>{DEPARTMENT_LABEL[s.department] || titleCase(s.department)}</span><b className="num">{money(s.net_minor, s.currency)}</b></li>)}</ul>
              ) : <Empty title="No spend recorded" />}
            </Card>
          )}
        </div>
        <Card title="Stays" flush>
          <DataTable
            rows={d.stays}
            empty={<Empty title="No stays yet" />}
            onRowClick={(s) => navigate(`/reservations/${s.id}`)}
            columns={[
              { key: 'conf_no', label: 'Booking' },
              { key: 'property_code', label: 'Property' },
              { key: 'arrival', label: 'Arrival', render: (s) => date(s.arrival) },
              { key: 'departure', label: 'Departure', render: (s) => date(s.departure) },
              { key: 'room', label: 'Room', render: (s) => `${s.room_number || '—'} · ${s.room_type_name}` },
              { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.status} /> },
              { key: 'total_minor', label: 'Room total', num: true, render: (s) => money(s.total_minor, s.currency) },
            ]}
          />
        </Card>
      </div>
      {edit && <EditGuest g={g} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
      {erase && (
        <Confirm
          title="Erase this guest’s personal data?"
          message="Name, contact details, identity and preferences are removed permanently. Reservations and financial records are kept (legal retention) but no longer identify the guest."
          confirmLabel="Erase personal data"
          tone="accent"
          busy={busy}
          onClose={() => setErase(false)}
          onConfirm={() => run(async () => { await api.post(`/guests/${g.id}/erase`, { reason }); setErase(false); reload(); }, { success: 'Personal data erased' })}
        >
          <Field label="Reason (e.g. erasure request reference)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Confirm>
      )}
    </>
  );
}

function EditGuest({ g, onClose, onDone }) {
  const [f, setF] = useState({ title: g.title || '', first_name: g.first_name, last_name: g.last_name, email: g.pii_masked ? undefined : g.email || '', phone: g.pii_masked ? undefined : g.phone || '', nationality: g.nationality || '', city: g.city || '', vip: g.vip || '', loyalty_no: g.loyalty_no || '', notes: g.notes || '', preferences: (g.preferences || []).join(', '), marketing_consent: Boolean(g.marketing_consent) });
  const [run, busy] = useAction();
  const body = () => ({ ...f, preferences: f.preferences.split(',').map((s) => s.trim()).filter(Boolean) });
  return (
    <Modal title="Edit guest" size="lg" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => run(async () => { await api.put(`/guests/${g.id}`, body()); onDone(); }, { success: 'Guest updated' })}>Save</Button></>}>
      <div className="form-grid">
        <Field label="First name"><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
        <Field label="Last name"><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
        {f.email !== undefined && <Field label="Email"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
        {f.phone !== undefined && <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>}
        <Field label="Nationality (ISO)"><Input value={f.nationality} maxLength={2} onChange={(e) => setF({ ...f, nationality: e.target.value.toUpperCase() })} /></Field>
        <Field label="City"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Field label="VIP level"><Input value={f.vip} onChange={(e) => setF({ ...f, vip: e.target.value })} placeholder="VIP1, VIP2…" /></Field>
        <Field label="Loyalty number"><Input value={f.loyalty_no} onChange={(e) => setF({ ...f, loyalty_no: e.target.value })} /></Field>
        <Field label="Preferences (comma separated)" className="span2"><Input value={f.preferences} onChange={(e) => setF({ ...f, preferences: e.target.value })} /></Field>
        <Field label="Notes" className="span2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="check span2"><input type="checkbox" checked={f.marketing_consent} onChange={(e) => setF({ ...f, marketing_consent: e.target.checked })} /> Guest consents to marketing messages</label>
      </div>
    </Modal>
  );
}
