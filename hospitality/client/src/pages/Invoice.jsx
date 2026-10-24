// Printable tax invoice (GST for Indian properties, VAT for EU), with the tax summary.
import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useApi } from '../lib/hooks.js';
import { date, moneyExact } from '../lib/format.js';
import { Async, Button } from '../components/ui.jsx';
import { WEB_DEMO } from '../lib/env.js';

export default function Invoice() {
  const { id } = useParams();
  const q = useApi(`/invoices/${id}`);
  return (
    <Async q={q}>
      {({ invoice: i, property: p, demo }) => {
        const ccy = i.currency;
        const gst = p.tax_regime === 'IN_GST';
        return (
          <>
            <div className="row no-print" style={{ marginBottom: 12 }}>
              <Link to={`/folios/${i.folio_id}`}>← Back to folio</Link>
              <span className="spacer" />
              {!WEB_DEMO && <Button icon={Printer} onClick={() => window.print()}>Print / save as PDF</Button>}
            </div>
            <div className="invoice">
              {demo && <div className="notice warn" style={{ marginBottom: 16 }}>Demo document — fictional business, not a valid tax invoice.</div>}
              <div className="row" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
                <div>
                  <h1>{p.legal_name || p.name}</h1>
                  <div className="small muted">{p.name}</div>
                  <div className="small muted">{p.address}, {p.city} {p.postal_code}</div>
                  {p.tax_id && <div className="small">{p.tax_id_type}: <b>{p.tax_id}</b></div>}
                </div>
                <span className="spacer" />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--brand-blue)' }}>{i.kind === 'credit_note' ? 'Credit note' : 'Tax invoice'}</div>
                  <div className="small">No. <b>{i.invoice_no}</b></div>
                  <div className="small">Date {date(i.issue_date)}</div>
                  <div className="small">Place of supply: {i.place_of_supply}</div>
                </div>
              </div>
              <div className="grid g2" style={{ marginBottom: 18 }}>
                <div>
                  <div className="small muted">Billed to</div>
                  <b>{i.bill_to_name}</b>
                  {i.bill_to_address && <div className="small">{i.bill_to_address}</div>}
                  {i.bill_to_tax_id && <div className="small">{gst ? 'GSTIN' : 'VAT no.'}: {i.bill_to_tax_id}</div>}
                </div>
                {i.lines.stay && (
                  <div>
                    <div className="small muted">Stay</div>
                    <div className="small">Booking {i.lines.stay.conf_no}</div>
                    <div className="small">{date(i.lines.stay.arrival)} – {date(i.lines.stay.departure)}</div>
                  </div>
                )}
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    {gst && <th>SAC</th>}
                    <th className="num">Taxable value</th>
                    <th className="num">Tax</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {i.lines.items.map((l) => (
                    <tr key={l.posting_no}>
                      <td>{date(l.date)}</td>
                      <td>{l.description}<div className="small muted">{l.taxes.map((t) => `${t.code} ${t.rate_bp / 100}%`).join(' + ')}</div></td>
                      {gst && <td>{l.sac || '—'}</td>}
                      <td className="num">{moneyExact(l.net_minor, ccy)}</td>
                      <td className="num">{moneyExact(l.tax_minor, ccy)}</td>
                      <td className="num">{moneyExact(l.gross_minor, ccy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid g2" style={{ marginTop: 18 }}>
                <div>
                  <div className="small strong" style={{ marginBottom: 6 }}>Tax summary</div>
                  <table>
                    <thead><tr><th>Tax</th><th className="num">Rate</th><th className="num">Taxable</th><th className="num">Amount</th></tr></thead>
                    <tbody>
                      {i.tax_breakdown.map((t) => (
                        <tr key={t.code + t.rate_bp}><td>{t.code}</td><td className="num">{t.rate_bp / 100}%</td><td className="num">{moneyExact(t.taxable_minor, ccy)}</td><td className="num">{moneyExact(t.amount_minor, ccy)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="folio-summary">
                  <div className="line"><span>Taxable value</span><b className="num">{moneyExact(i.net_minor, ccy)}</b></div>
                  <div className="line"><span>Tax</span><b className="num">{moneyExact(i.tax_minor, ccy)}</b></div>
                  <div className="line total"><span>Invoice total</span><span className="num">{moneyExact(i.gross_minor, ccy)}</span></div>
                  <div className="line"><span className="muted">Paid</span><span className="num">{moneyExact(i.paid_minor, ccy)}</span></div>
                </div>
              </div>
              <div className="small muted" style={{ marginTop: 24 }}>
                Tax rates are applied from the property’s configured rules for the business date. Country-specific invoice requirements (e.g. GST e-invoicing IRN/QR, Portuguese certified-software ATCUD) must be validated before production use.
              </div>
            </div>
          </>
        );
      }}
    </Async>
  );
}
