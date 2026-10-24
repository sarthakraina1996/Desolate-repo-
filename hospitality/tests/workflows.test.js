// End-to-end operational workflows on the fixture hotel: book → check in → charges → night
// audits → payments → check out → invoice (WF-A), the housekeeping inspection gate (WF-C),
// settlement rules at check-out and company (city ledger) billing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BD, fixture, rejects } from './fixture.js';
import { checkIn, checkOut } from '../server/modules/frontdesk/service.js';
import { folioBalance, postCharge, postPayment } from '../server/modules/folios/service.js';
import { runNightAudit } from '../server/modules/nightaudit/service.js';
import { inspectRoom, setRoomStatus } from '../server/modules/housekeeping/service.js';
import { saveCompany } from '../server/modules/guests/service.js';
import { reconcile } from '../server/modules/finance/reconciliation.js';
import { trialBalance } from '../server/modules/finance/ledger.js';

const ID = { idType: 'passport', idNumber: 'P1234567', idCountry: 'IN', nowTime: '15:00' };
const room = (f, id) => f.db.get('SELECT * FROM rooms WHERE id = ?', id);

function assertBooksBalance(f) {
  const rows = trialBalance(f.db, [f.prop.id]);
  assert.ok(rows.length > 0, 'postings reached the general ledger');
  const dr = rows.reduce((a, r) => a + r.debit_minor, 0);
  const cr = rows.reduce((a, r) => a + r.credit_minor, 0);
  assert.equal(dr, cr, 'trial balance debits equal credits');
  for (const c of reconcile(f.db, [f.prop.id]).checks) assert.ok(c.ok, `${c.id} ${c.name}: ${c.left} vs ${c.right}`);
}

test('WF-A: a stay from booking to invoice', () => {
  const f = fixture();
  try {
    const desk = f.actors.front_desk;
    const r = f.book(desk, { roomId: f.rooms.DLX[0] });
    rejects(() => checkIn(f.db, desk, r.id, { nowTime: '15:00' }), 409, 'id_required');
    const inHouse = checkIn(f.db, desk, r.id, ID);
    assert.equal(inHouse.status, 'in_house');
    const folio = inHouse.folios[0];

    // Restaurant charge: ₹2,000 + 5% GST split CGST/SGST.
    const rest = postCharge(f.db, desk, { reservationId: r.id, chargeCode: 'REST', unitMinor: 200000, source: 'pos' });
    assert.equal(rest.tax_minor, 10000);
    assert.deepEqual(JSON.parse(rest.taxes).map((t) => [t.code, t.amount]), [['CGST', 5000], ['SGST', 5000]]);

    const n1 = runNightAudit(f.db, f.actors.gm, f.prop.id);
    assert.deepEqual([n1.businessDate, n1.roomsPosted, n1.roomRevenueMinor], [BD, 1, 500000]);
    assert.equal(f.db.value('SELECT business_date FROM properties WHERE id = ?', f.prop.id), '2026-10-25');
    postPayment(f.db, desk, { folioId: folio.id, method: 'CASH', amountMinor: 300000 });
    runNightAudit(f.db, f.actors.gm, f.prop.id);

    // Departure day: two nights at ₹5,000 + 5% and the restaurant bill, less the cash paid.
    const due = 2 * 525000 + 210000 - 300000;
    assert.equal(folioBalance(f.db, folio.id), due);
    const e = rejects(() => checkOut(f.db, desk, r.id, { nowTime: '11:00' }), 409, 'balance_due');
    assert.equal(e.details.balance_minor, due);
    rejects(() => postPayment(f.db, desk, { folioId: folio.id, method: 'CARD', amountMinor: due, cardLast4: '4242424242424242' }), 400);
    postPayment(f.db, desk, { folioId: folio.id, method: 'CARD', amountMinor: due, cardLast4: '4242' });
    const out = checkOut(f.db, desk, r.id, { nowTime: '11:00' });
    assert.equal(out.status, 'closed');
    assert.equal(out.invoices.length, 1);
    const inv = f.db.get('SELECT * FROM invoices WHERE id = ?', out.invoices[0].id);
    assert.equal(inv.gross_minor, 2 * 525000 + 210000);
    assert.equal(inv.net_minor + inv.tax_minor, inv.gross_minor);
    assert.equal(inv.paid_minor, inv.gross_minor);
    assert.match(inv.invoice_no, /^FXH\/202627\/00001$/);
    assert.equal(f.db.value('SELECT status FROM folios WHERE id = ?', folio.id), 'closed');
    assert.equal(room(f, f.rooms.DLX[0]).hk_status, 'dirty');
    assert.equal(f.db.value("SELECT COUNT(*) FROM hk_tasks WHERE room_id = ? AND kind = 'departure'", f.rooms.DLX[0]), 1);
    // No card number beyond the last four digits is stored anywhere on the posting.
    assert.equal(f.db.value("SELECT COUNT(*) FROM folio_postings WHERE card_last4 IS NOT NULL AND length(card_last4) <> 4"), 0);
    assertBooksBalance(f);
  } finally {
    f.close();
  }
});

test('WF-C: a room must be inspected before check-in when the property requires it', () => {
  const f = fixture({ inspection: true });
  try {
    const id = f.rooms.DLX[1];
    setRoomStatus(f.db, f.actors.housekeeping_attendant, room(f, id), { hk_status: 'clean', reason: 'Cleaned' });
    const r = f.book(f.actors.front_desk, { roomId: id });
    const e = rejects(() => checkIn(f.db, f.actors.front_desk, r.id, ID), 409, 'room_not_ready');
    assert.match(e.message, /not yet inspected/);
    rejects(() => inspectRoom(f.db, f.actors.housekeeping_attendant, room(f, id)), 403, 'forbidden');
    inspectRoom(f.db, f.actors.housekeeping_manager, room(f, id));
    assert.equal(checkIn(f.db, f.actors.front_desk, r.id, ID).status, 'in_house');
    // A dirty room cannot be inspected.
    setRoomStatus(f.db, f.actors.housekeeping_manager, room(f, f.rooms.DLX[2]), { hk_status: 'dirty' });
    rejects(() => inspectRoom(f.db, f.actors.housekeeping_manager, room(f, f.rooms.DLX[2])), 409);
  } finally {
    f.close();
  }
  const g = fixture({ inspection: false });
  try {
    const id = g.rooms.DLX[1];
    setRoomStatus(g.db, g.actors.housekeeping_attendant, room(g, id), { hk_status: 'clean' });
    const r = g.book(g.actors.front_desk, { roomId: id });
    assert.equal(checkIn(g.db, g.actors.front_desk, r.id, ID).status, 'in_house', 'clean is enough without the inspection policy');
  } finally {
    g.close();
  }
});

test('check-in refuses an occupied or blocked room and early or late arrivals', () => {
  const f = fixture();
  try {
    const id = f.rooms.DLX[0];
    const a = f.book(f.actors.front_desk, { roomId: id });
    checkIn(f.db, f.actors.front_desk, a.id, ID);
    const future = f.book(f.actors.front_desk, { arrival: '2026-10-27', departure: '2026-10-28' });
    rejects(() => checkIn(f.db, f.actors.front_desk, future.id, ID), 409, 'not_due');
    const unassigned = f.book(f.actors.front_desk);
    rejects(() => checkIn(f.db, f.actors.front_desk, unassigned.id, ID), 409, 'no_room');
    rejects(() => checkIn(f.db, f.actors.front_desk, unassigned.id, { ...ID, roomId: id }), 409, 'room_taken');
  } finally {
    f.close();
  }
});

test('check-out: a credit must be refunded first, and refunds cannot exceed the credit', () => {
  const f = fixture();
  try {
    const desk = f.actors.front_desk;
    const r = f.book(desk, { roomId: f.rooms.DLX[0], departure: '2026-10-25' });
    const folio = checkIn(f.db, desk, r.id, ID).folios[0];
    runNightAudit(f.db, f.actors.gm, f.prop.id);
    postPayment(f.db, desk, { folioId: folio.id, method: 'CASH', amountMinor: 600000 });
    const e = rejects(() => checkOut(f.db, desk, r.id, { nowTime: '10:00' }), 409, 'credit_balance');
    assert.equal(e.details.balance_minor, -75000);
    rejects(() => postPayment(f.db, desk, { folioId: folio.id, kind: 'refund', method: 'CASH', amountMinor: 75001 }), 400);
    postPayment(f.db, desk, { folioId: folio.id, kind: 'refund', method: 'CASH', amountMinor: 75000 });
    assert.equal(checkOut(f.db, desk, r.id, { nowTime: '10:00' }).status, 'closed');
    assertBooksBalance(f);
  } finally {
    f.close();
  }
});

test('company billing moves the balance to the city ledger', () => {
  const f = fixture();
  try {
    const desk = f.actors.front_desk;
    const co = saveCompany(f.db, f.admin, f.orgId, { kind: 'corporate', name: 'Acme Travel', ar_enabled: 1, credit_limit_minor: 10_000_000, credit_days: 30 });
    const r = f.book(desk, { roomId: f.rooms.DLX[0], departure: '2026-10-25' }, { companyId: co.id });
    checkIn(f.db, desk, r.id, ID);
    runNightAudit(f.db, f.actors.gm, f.prop.id);
    const out = checkOut(f.db, desk, r.id, { billTo: 'company', companyId: co.id, nowTime: '11:30' });
    assert.equal(out.status, 'closed');
    const ar = f.db.get("SELECT * FROM folios WHERE kind = 'company' AND company_id = ?", co.id);
    assert.equal(folioBalance(f.db, ar.id), 525000);
    assert.equal(f.db.value('SELECT bill_to_name FROM invoices WHERE id = ?', out.invoices[0].id), 'Acme Travel');
    assertBooksBalance(f);
  } finally {
    f.close();
  }
});
