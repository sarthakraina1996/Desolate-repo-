// Financial integrity: immutable postings, invoices and journals; reversals instead of edits;
// balanced double entry; duplicate-safe postings; atomic, re-runnable night audit; invoice
// numbering; reconciliation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BD, fixture, rejects } from './fixture.js';
import { checkIn, checkOut } from '../server/modules/frontdesk/service.js';
import { folioBalance, issueInvoice, postAllowance, postCharge, postPayment, reversePosting } from '../server/modules/folios/service.js';
import { runNightAudit } from '../server/modules/nightaudit/service.js';
import { postJournal } from '../server/modules/finance/ledger.js';
import { reconcile } from '../server/modules/finance/reconciliation.js';

const ID = { idType: 'passport', idNumber: 'P7654321', idCountry: 'IN', nowTime: '15:00' };

function inHouse(f, line = {}) {
  const r = f.book(f.actors.front_desk, { roomId: f.rooms.DLX[0], ...line });
  const d = checkIn(f.db, f.actors.front_desk, r.id, ID);
  return { res: d, folio: d.folios[0] };
}

test('postings, invoices and journals cannot be edited or deleted', () => {
  const f = fixture();
  try {
    const { folio } = inHouse(f);
    const p = postCharge(f.db, f.actors.front_desk, { reservationId: folio.reservation_id, chargeCode: 'MINIBAR', unitMinor: 50000 });
    assert.throws(() => f.db.run('UPDATE folio_postings SET amount_minor = 1 WHERE id = ?', p.id), /immutable/);
    assert.throws(() => f.db.run('UPDATE folio_postings SET description = ? WHERE id = ?', 'edited', p.id), /immutable/);
    assert.throws(() => f.db.run('DELETE FROM folio_postings WHERE id = ?', p.id), /cannot be deleted|immutable/);
    const je = f.db.get("SELECT * FROM journal_entries WHERE source = 'folio.charge' AND source_id = ?", p.id);
    assert.ok(je, 'every posting has its journal entry');
    assert.throws(() => f.db.run('UPDATE journal_entries SET description = ? WHERE id = ?', 'x', je.id), /immutable/);
    assert.throws(() => f.db.run('UPDATE journal_lines SET debit_minor = debit_minor + 1 WHERE entry_id = ?', je.id), /immutable/);
    assert.throws(() => f.db.run('DELETE FROM journal_lines WHERE entry_id = ?', je.id), /cannot be deleted|immutable/);
    const inv = issueInvoice(f.db, f.actors.front_desk, folio.id);
    assert.throws(() => f.db.run('UPDATE invoices SET gross_minor = 0 WHERE id = ?', inv.id), /immutable/);
    assert.throws(() => f.db.run('DELETE FROM invoices WHERE id = ?', inv.id), /cannot be deleted/);
    assert.throws(() => f.db.run('DELETE FROM audit_log'), /./);
  } finally {
    f.close();
  }
});

test('a wrong charge is corrected by a reversal, once, and never after invoicing', () => {
  const f = fixture();
  try {
    const { folio } = inHouse(f);
    const p = postCharge(f.db, f.actors.front_desk, { reservationId: folio.reservation_id, chargeCode: 'LAUNDRY', unitMinor: 80000 });
    const before = folioBalance(f.db, folio.id);
    rejects(() => reversePosting(f.db, f.actors.front_desk, p.id, ''), 400);
    const rev = reversePosting(f.db, f.actors.front_desk, p.id, 'Posted to wrong room');
    assert.equal(rev.amount_minor, -p.amount_minor);
    assert.equal(rev.reverses_id, p.id);
    assert.equal(folioBalance(f.db, folio.id), before - p.amount_minor);
    assert.equal(f.db.value('SELECT reversed FROM folio_postings WHERE id = ?', p.id), 1);
    rejects(() => reversePosting(f.db, f.actors.front_desk, p.id, 'Again'), 409);
    // Once invoiced, a posting can only be corrected by a credit note.
    const q = postCharge(f.db, f.actors.front_desk, { reservationId: folio.reservation_id, chargeCode: 'SPA', unitMinor: 300000 });
    issueInvoice(f.db, f.actors.front_desk, folio.id);
    rejects(() => reversePosting(f.db, f.actors.front_desk, q.id, 'Late correction'), 409, 'invoiced');
    for (const c of reconcile(f.db, [f.prop.id]).checks) assert.ok(c.ok, `${c.id}: ${c.left} vs ${c.right}`);
  } finally {
    f.close();
  }
});

test('allowances reduce revenue with matching tax', () => {
  const f = fixture();
  try {
    const { folio } = inHouse(f);
    postCharge(f.db, f.actors.front_desk, { reservationId: folio.reservation_id, chargeCode: 'REST', unitMinor: 400000 });
    const a = postAllowance(f.db, f.actors.gm, { folioId: folio.id, chargeCode: 'REST', amountMinor: 100000, reason: 'Slow service' });
    assert.ok(a.net_minor < 0 && a.tax_minor <= 0);
    for (const c of reconcile(f.db, [f.prop.id]).checks) assert.ok(c.ok, `${c.id}: ${c.left} vs ${c.right}`);
  } finally {
    f.close();
  }
});

test('the general ledger only accepts balanced entries on known accounts', () => {
  const f = fixture();
  try {
    const base = { propertyId: f.prop.id, businessDate: BD, source: 'manual', description: 'Test', currency: 'INR' };
    rejects(() => postJournal(f.db, f.admin, { ...base, lines: [{ account: '1010', debit: 100 }, { account: '4010', credit: 99 }] }), 500, 'unbalanced_journal');
    rejects(() => postJournal(f.db, f.admin, { ...base, lines: [{ account: '1010', debit: 100 }, { account: '9999', credit: 100 }] }), 500);
    rejects(() => postJournal(f.db, f.admin, { ...base, lines: [{ account: '1010', debit: -100 }, { account: '4010', credit: -100 }] }), 500);
    const before = f.db.value('SELECT COUNT(*) FROM journal_entries');
    assert.ok(postJournal(f.db, f.admin, { ...base, lines: [{ account: '1010', debit: 100 }, { account: '4910', credit: 100 }] }));
    assert.equal(f.db.value('SELECT COUNT(*) FROM journal_entries'), before + 1);
  } finally {
    f.close();
  }
});

test('the same posting key never posts twice (retries and replays are safe)', () => {
  const f = fixture();
  try {
    const { folio } = inHouse(f);
    const pay = { folioId: folio.id, method: 'UPI', amountMinor: 250000, dedupeKey: 'pay:client-retry-1' };
    const a = postPayment(f.db, f.actors.front_desk, pay);
    const b = postPayment(f.db, f.actors.front_desk, pay);
    assert.equal(b.id, a.id);
    assert.equal(b.duplicate, true);
    assert.equal(f.db.value("SELECT COUNT(*) FROM folio_postings WHERE kind = 'payment'"), 1);
    assert.equal(f.db.value("SELECT COUNT(*) FROM journal_entries WHERE source = 'folio.payment'"), 1);
  } finally {
    f.close();
  }
});

test('night audit is atomic: an interrupted run changes nothing and a re-run posts once', () => {
  const f = fixture();
  try {
    const { res } = inHouse(f);
    const late = f.book(f.actors.front_desk, { arrival: BD, departure: '2026-10-25' }); // never arrives
    const crash = () => {
      throw new Error('power cut');
    };
    assert.throws(() => runNightAudit(f.db, f.actors.gm, f.prop.id, { hooks: { beforeCommit: crash } }), /power cut/);
    assert.equal(f.db.value('SELECT business_date FROM properties WHERE id = ?', f.prop.id), BD, 'business date unchanged');
    assert.equal(f.db.value("SELECT COUNT(*) FROM folio_postings WHERE charge_code = 'ROOM'"), 0, 'no room charges left behind');
    assert.equal(f.db.value('SELECT status FROM reservations WHERE id = ?', late.id), 'confirmed', 'no-show rolled back');
    assert.equal(f.db.value("SELECT COUNT(*) FROM night_audits WHERE status = 'failed'"), 1, 'the failed attempt is recorded');

    const ok = runNightAudit(f.db, f.actors.gm, f.prop.id);
    assert.deepEqual([ok.roomsPosted, ok.noShows], [1, 1]);
    assert.equal(f.db.value('SELECT status FROM reservations WHERE id = ?', late.id), 'no_show');
    assert.equal(f.db.value("SELECT COUNT(*) FROM folio_postings WHERE reservation_id = ? AND charge_code = 'ROOM'", res.id), 1);
    // The completed day cannot be audited again; the next one can, and posts its own night.
    runNightAudit(f.db, f.actors.gm, f.prop.id);
    assert.equal(f.db.value("SELECT COUNT(*) FROM folio_postings WHERE reservation_id = ? AND charge_code = 'ROOM'", res.id), 2);
    assert.equal(f.db.value("SELECT COUNT(DISTINCT business_date) FROM night_audits WHERE status = 'completed'"), 2);
  } finally {
    f.close();
  }
});

test('night audit will not close a day with guests due out still in house', () => {
  const f = fixture();
  try {
    const { res } = inHouse(f, { departure: '2026-10-25' });
    runNightAudit(f.db, f.actors.gm, f.prop.id);
    const e = rejects(() => runNightAudit(f.db, f.actors.gm, f.prop.id), 409, 'departures_pending');
    assert.equal(e.details.reservations[0].id, res.id);
    rejects(() => runNightAudit(f.db, f.actors.gm, f.prop.id, { autoNoShow: false }), 409);
  } finally {
    f.close();
  }
});

test('invoice numbers are sequential per property and financial year', () => {
  const f = fixture();
  try {
    const nums = [];
    for (const roomId of [f.rooms.DLX[0], f.rooms.DLX[1], f.rooms.DLX[2]]) {
      const r = f.book(f.actors.front_desk, { roomId, departure: '2026-10-25' });
      const folio = checkIn(f.db, f.actors.front_desk, r.id, ID).folios[0];
      postCharge(f.db, f.actors.front_desk, { reservationId: r.id, chargeCode: 'REST', unitMinor: 100000 });
      postPayment(f.db, f.actors.front_desk, { folioId: folio.id, method: 'CASH', amountMinor: folioBalance(f.db, folio.id) });
      nums.push(issueInvoice(f.db, f.actors.front_desk, folio.id).invoice_no);
    }
    assert.deepEqual(nums, ['FXH/202627/00001', 'FXH/202627/00002', 'FXH/202627/00003']);
    // Night audit and checkout for one of them keeps the ledger reconciled.
    runNightAudit(f.db, f.actors.gm, f.prop.id);
    for (const r of f.db.all("SELECT id FROM reservations WHERE status = 'in_house'")) {
      const fo = f.db.get("SELECT id FROM folios WHERE reservation_id = ? AND status = 'open'", r.id);
      const bal = folioBalance(f.db, fo.id);
      if (bal > 0) postPayment(f.db, f.actors.front_desk, { folioId: fo.id, method: 'CARD', amountMinor: bal, cardLast4: '1111' });
      checkOut(f.db, f.actors.front_desk, r.id, { nowTime: '11:00' });
    }
    const all = f.db.all('SELECT invoice_no FROM invoices ORDER BY id').map((x) => x.invoice_no);
    assert.equal(new Set(all).size, all.length);
    for (const c of reconcile(f.db, [f.prop.id]).checks) assert.ok(c.ok, `${c.id}: ${c.left} vs ${c.right}`);
  } finally {
    f.close();
  }
});
