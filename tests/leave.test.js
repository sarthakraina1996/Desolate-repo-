import test from 'node:test';
import assert from 'node:assert/strict';
import { countLeaveDays, leaveDaysByYear, entitlement } from '../server/lib/leave.js';

const ctx = { weeklyOffs: [0, 6], holidays: new Set(['2026-10-02']) };

test('weekends and company holidays are not counted', () => {
  // Thu 1 Oct to Tue 6 Oct 2026: Fri 2 Oct holiday, Sat/Sun off
  assert.equal(countLeaveDays({ from: '2026-10-01', to: '2026-10-06' }, ctx), 3);
});

test('calendar-day leave counts every day', () => {
  assert.equal(countLeaveDays({ from: '2026-10-01', to: '2026-10-06', calendarDays: true }, ctx), 6);
});

test('half day counts 0.5 and nothing on a weekly off', () => {
  assert.equal(countLeaveDays({ from: '2026-10-05', to: '2026-10-05', halfDay: true }, ctx), 0.5);
  assert.equal(countLeaveDays({ from: '2026-10-03', to: '2026-10-03', halfDay: true }, ctx), 0);
});

test('leave across the new year is split by year', () => {
  const m = leaveDaysByYear({ from: '2026-12-30', to: '2027-01-04' }, { weeklyOffs: [0, 6], holidays: new Set() });
  assert.equal(m.get(2026), 2);
  assert.equal(m.get(2027), 2);
});

test('annual entitlement is pro-rated from the joining month', () => {
  const cl = { annual_quota: 12, accrual: 'annual' };
  assert.equal(entitlement(cl, '2020-01-10', 2026, '2026-10-12'), 12);
  assert.equal(entitlement(cl, '2026-07-15', 2026, '2026-10-12'), 6);
  assert.equal(entitlement(cl, '2027-01-01', 2026, '2026-10-12'), 0);
});

test('monthly accrual credits up to the current month', () => {
  const el = { annual_quota: 20, accrual: 'monthly' };
  assert.equal(entitlement(el, '2020-01-01', 2026, '2026-10-12'), 16.5);
  assert.equal(entitlement(el, '2020-01-01', 2025, '2026-10-12'), 20);
});

test('unlimited types have no entitlement cap', () => {
  assert.equal(entitlement({ annual_quota: null }, '2020-01-01', 2026, '2026-10-12'), null);
});
