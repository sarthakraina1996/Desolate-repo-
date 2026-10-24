// Guests and companies: search profiles; corporate, travel-agent and OTA accounts with their
// receivable balances.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useDebounced, usePref } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { date, money, number, titleCase } from '../lib/format.js';
import { Async, Badge, Card, Empty, Input, PageHead, Tabs } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';

export default function Guests() {
  const [tab, setTab] = usePref('guests-tab', 'guests');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [page, setPage] = useState(0);
  const guests = useApi(tab === 'guests' ? `/guests${qs({ q: dq, limit: 25, offset: page * 25 })}` : null);
  const companies = useApi(tab === 'companies' ? '/companies' : null);
  const navigate = useNavigate();
  const { user } = useApp();
  return (
    <>
      <PageHead title="Guests" sub="Profiles are shared across the group’s properties" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'guests', label: 'Guest profiles', icon: Users }, { value: 'companies', label: 'Companies & agents', icon: Building2 }]} />
      {tab === 'guests' && (
        <>
          <div className="filters">
            <Input className="search" style={{ width: 320 }} placeholder="Name, email, phone or loyalty number" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search guests" />
          </div>
          <Card flush>
            <Async q={guests}>
              {(d) => (
                <DataTable
                  rows={d.rows}
                  total={d.total}
                  page={page}
                  onPage={setPage}
                  onRowClick={(g) => navigate(`/guests/${g.id}`)}
                  empty={<Empty title="No guests match" />}
                  columns={[
                    { key: 'name', label: 'Guest', sortable: false, render: (g) => <><b>{g.vip ? '★ ' : ''}{g.first_name} {g.last_name}</b>{g.company_name && <div className="sub">{g.company_name}</div>}</> },
                    { key: 'email', label: 'Email', sortable: false, render: (g) => g.email || '—' },
                    { key: 'phone', label: 'Phone', sortable: false, render: (g) => g.phone || '—' },
                    { key: 'country', label: 'Country', sortable: false },
                    { key: 'stays', label: 'Stays', num: true, sortable: false },
                    { key: 'last_stay', label: 'Last stay', sortable: false, render: (g) => date(g.last_stay) },
                    { key: 'consent', label: 'Marketing', sortable: false, render: (g) => (g.marketing_consent ? <Badge tone="good">Opted in</Badge> : <Badge>No</Badge>) },
                  ]}
                />
              )}
            </Async>
          </Card>
          {guests.data?.rows?.[0]?.pii_masked && <div className="small muted" style={{ marginTop: 8 }}>Contact details are masked for your role ({user.roleLabel}).</div>}
        </>
      )}
      {tab === 'companies' && (
        <Card flush>
          <Async q={companies}>
            {(rows) => (
              <DataTable
                rows={rows}
                exportName="companies.csv"
                columns={[
                  { key: 'name', label: 'Account', render: (c) => <b>{c.name}</b> },
                  { key: 'kind', label: 'Type', render: (c) => titleCase(c.kind) },
                  { key: 'city', label: 'City', render: (c) => c.city || '—' },
                  { key: 'tax_id', label: 'Tax ID', render: (c) => c.tax_id || '—' },
                  { key: 'ar_enabled', label: 'Credit', render: (c) => (c.ar_enabled ? <Badge tone="info">{c.credit_days} days</Badge> : '—') },
                  { key: 'commission_bp', label: 'Commission', num: true, render: (c) => (c.commission_bp ? `${number(c.commission_bp / 100, 1)}%` : '—') },
                  { key: 'ar_balance_minor', label: 'Receivable', num: true, render: (c) => (c.ar_balance_minor ? money(c.ar_balance_minor, 'INR') : '—') },
                ]}
              />
            )}
          </Async>
        </Card>
      )}
    </>
  );
}
