// Pure units: money arithmetic, tax rules, reporting periods, KPI formulas, TOTP, dates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, bpOf, convert, mulDiv, roundHalfUp, toMinor } from '../server/core/money.js';
import { computeTax, pickRule } from '../server/modules/folios/tax.js';
import { taxRulesFor } from '../server/modules/properties/templates.js';
import { comparePeriod, resolvePeriod } from '../server/modules/metrics/periods.js';
import * as F from '../server/modules/metrics/formulas.js';
import { deriveMetrics } from '../server/modules/metrics/engine.js';
import { base32Encode, hotp, totp, verifyTotp } from '../server/core/totp.js';
import { addMonths, fiscalYear, nights } from '../server/core/dates.js';
import { assertTransition } from '../server/modules/reservations/service.js';

test('money: rounding is half away from zero and exact for large values', () => {
  assert.equal(roundHalfUp(2.5), 3);
  assert.equal(roundHalfUp(-2.5), -3);
  assert.equal(bpOf(10000, 1800), 1800);
  assert.equal(bpOf(333, 250), 8); // 8.325 → 8
  assert.equal(bpOf(350, 1000), 35);
  assert.equal(bpOf(5, 1000), 1); // 0.5 → 1
  assert.equal(bpOf(-5, 1000), -1);
  assert.equal(bpOf(9_007_199_254_740_000, 1), 900_719_925_474); // beyond float precision
  assert.equal(mulDiv(11800, 10000, 11800), 10000);
});

test('money: allocation always sums to the whole', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  for (const amount of [1, 7, 999, 123457])
    for (const w of [[900, 900], [1, 2, 3], [5, 0, 5]]) assert.equal(allocate(amount, w).reduce((a, b) => a + b, 0), amount);
});

test('money: parsing major units and converting currencies', () => {
  assert.equal(toMinor('1,250.50', 'INR'), 125050);
  assert.equal(toMinor('12', 'JPY'), 12);
  assert.equal(toMinor(-3.5, 'EUR'), -350);
  assert.ok(Number.isNaN(toMinor('1.234', 'INR')), 'too many decimals is rejected, not rounded');
  assert.ok(Number.isNaN(toMinor('abc')));
  assert.equal(convert(10000, 98_500_000, 'EUR', 'INR'), 985000); // €100 × 98.5
  assert.equal(convert(1000, 1_000_000, 'JPY', 'INR'), 100000); // exponent shift
});

const inGst = (date) =>
  taxRulesFor('IN_GST')
    .filter((r) => r.category === 'room' && r.effective_from <= date && (!r.effective_to || r.effective_to >= date))
    .map((r) => ({ ...r }));

test('tax: India GST room slabs follow the per-night value and effective dates', () => {
  const after = inGst('2026-10-24');
  assert.equal(pickRule(after, 100000).rate_bp, 0); // ₹1,000 exempt
  assert.equal(pickRule(after, 100001).rate_bp, 500); // ₹1,000.01
  assert.equal(pickRule(after, 750000).rate_bp, 500); // ₹7,500
  assert.equal(pickRule(after, 750001).rate_bp, 1800); // ₹7,500.01
  const before = inGst('2025-09-21');
  assert.equal(pickRule(before, 500000).rate_bp, 1200, 'the 12% slab applied before 22 Sep 2025');
});

test('tax: components are rounded separately and inclusive prices are extracted', () => {
  const rules = inGst('2026-10-24');
  const t = computeTax(rules, { amountMinor: 3 * 500000, unitMinor: 500000 });
  assert.equal(t.tax, 75000);
  assert.deepEqual(t.lines.map((l) => [l.code, l.amount]), [['CGST', 37500], ['SGST', 37500]]);
  assert.equal(computeTax(rules, { amountMinor: 80000 }).tax, 0);
  const vat = taxRulesFor('EU_VAT').filter((r) => r.category === 'room');
  const inc = computeTax(vat, { amountMinor: 10600, inclusive: true });
  assert.equal(inc.net, 10000);
  assert.equal(inc.tax, 600);
  assert.equal(inc.net + inc.tax, inc.gross);
  const odd = computeTax(vat, { amountMinor: 9999, inclusive: true });
  assert.equal(odd.net + odd.tax, 9999, 'inclusive extraction never loses a cent');
});

test('periods: presets resolve against the last closed business day', () => {
  const bd = '2026-10-24';
  assert.deepEqual(resolvePeriod({ preset: 'today', businessDate: bd }), { preset: 'today', from: bd, to: bd, provisional: true });
  assert.deepEqual(resolvePeriod({ preset: 'yesterday', businessDate: bd }), { preset: 'yesterday', from: '2026-10-23', to: '2026-10-23' });
  assert.equal(resolvePeriod({ preset: 'last7', businessDate: bd }).from, '2026-10-17');
  assert.equal(resolvePeriod({ preset: 'mtd', businessDate: bd }).from, '2026-10-01');
  assert.equal(resolvePeriod({ preset: 'qtd', businessDate: bd }).from, '2026-10-01');
  assert.equal(resolvePeriod({ preset: 'ytd', businessDate: bd }).from, '2026-01-01');
  assert.equal(resolvePeriod({ preset: 'fy', businessDate: bd, fyStartMonth: 4 }).from, '2026-04-01');
  assert.equal(resolvePeriod({ preset: 'fy', businessDate: '2026-02-10', fyStartMonth: 4 }).from, '2025-04-01');
  // On the 1st, MTD is the whole previous month (the 1st is still open).
  assert.deepEqual([resolvePeriod({ preset: 'mtd', businessDate: '2026-11-01' }).from, resolvePeriod({ preset: 'mtd', businessDate: '2026-11-01' }).to], ['2026-10-01', '2026-10-31']);
  assert.throws(() => resolvePeriod({ preset: 'custom', from: '2026-02-01', to: '2026-01-01', businessDate: bd }), /valid custom/);
  assert.throws(() => resolvePeriod({ preset: 'custom', from: '2020-01-01', to: '2026-01-01', businessDate: bd }), /three years/);
});

test('periods: comparisons', () => {
  assert.deepEqual(comparePeriod({ from: '2026-10-01', to: '2026-10-23' }, 'previous'), { mode: 'previous', from: '2026-09-08', to: '2026-09-30' });
  assert.deepEqual(comparePeriod({ from: '2024-02-29', to: '2024-02-29' }, 'last_year'), { mode: 'last_year', from: '2023-02-28', to: '2023-02-28' });
  assert.equal(comparePeriod({ from: '2026-10-01', to: '2026-10-23' }, 'none'), null);
});

test('formulas: division by zero is null, never 0 or Infinity', () => {
  assert.equal(F.occupancyPct(0, 0), null);
  assert.equal(F.adr(100, 0), null);
  assert.equal(F.revpar(100, 0), null);
  assert.equal(F.alos(10, 0), null);
  assert.equal(F.occupancyPct(45, 60), 75);
  assert.equal(F.adr(1000001, 2), 500001); // rounded to the minor unit
  assert.equal(F.cancellationRatePct(1, 9), 10); // cancelled / (kept + cancelled)
  assert.deepEqual(F.change(80, 75, { isPercent: true }), { abs: 5, pct: null });
  assert.deepEqual(F.change(110, 100), { abs: 10, pct: 10 });
  assert.deepEqual(F.change(10, null), { abs: null, pct: null });
});

test('formulas: portfolio ratios are weighted, never averaged', () => {
  // A 10-room hotel at 90% and a 100-room hotel at 50%: portfolio occupancy is 59/110 = 53.6%,
  // not the 70% a simple average of percentages would show.
  const base = { comp_room_nights: 0, house_use_room_nights: 0, ooo_room_nights: 0, otb_room_nights: 0, direct_room_nights: 0, rooms_other_revenue: 0, fnb_revenue: 0, banquet_revenue: 0, spa_revenue: 0, other_revenue: 0, misc_revenue: 0, commission_cost: 0, provisional_room_revenue: 0 };
  const small = { ...base, available_room_nights: 10, sold_room_nights: 9, room_revenue: 9 * 1000000 };
  const large = { ...base, available_room_nights: 100, sold_room_nights: 50, room_revenue: 50 * 400000 };
  const sum = Object.fromEntries(Object.keys(small).map((k) => [k, small[k] + large[k]]));
  const m = deriveMetrics(sum);
  assert.equal(Math.round(m.occupancy_pct * 10) / 10, 53.6);
  assert.equal(m.adr, Math.round((9 * 1000000 + 50 * 400000) / 59)); // weighted ADR
  assert.equal(m.revpar, Math.round((9 * 1000000 + 50 * 400000) / 110));
  assert.notEqual(Math.round(m.occupancy_pct), (deriveMetrics(small).occupancy_pct + deriveMetrics(large).occupancy_pct) / 2);
});

test('TOTP matches the RFC 6238 test vector and tolerates one step of drift', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp(secret, { time: 59_000, digits: 8 }), '94287082');
  assert.equal(hotp(Buffer.from('12345678901234567890'), 1), '287082');
  const now = 1_700_000_000_000;
  const code = totp(secret, { time: now });
  assert.ok(verifyTotp(secret, code, { time: now + 30_000 }));
  assert.ok(!verifyTotp(secret, code, { time: now + 120_000 }));
  assert.ok(!verifyTotp(secret, String((Number(code) + 1) % 1e6).padStart(6, '0'), { time: now }));
});

test('dates: nights, months and fiscal years', () => {
  assert.deepEqual(nights('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(fiscalYear('2026-03-31', 4).label, 'FY2025-26');
  assert.equal(fiscalYear('2026-04-01', 4).label, 'FY2026-27');
});

test('reservation state machine rejects illegal transitions', () => {
  assertTransition('confirmed', 'in_house');
  assertTransition('in_house', 'checked_out');
  for (const [from, to] of [['cancelled', 'in_house'], ['checked_out', 'in_house'], ['quote', 'in_house'], ['no_show', 'checked_out']])
    assert.throws(() => assertTransition(from, to), (e) => e.status === 409, `${from} → ${to}`);
});
