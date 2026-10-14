import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addMonths, daysBetween, describeDaysUntil, formatLongDate, isValidISODate, nextRenewalDate, nowInTimeZone, todayInTimeZone,
} from '../src/dates.js';

describe('addMonths', () => {
  it('adds months within a year and across year ends', () => {
    assert.equal(addMonths('2026-01-15', 1), '2026-02-15');
    assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
    assert.equal(addMonths('2026-10-14', 12), '2027-10-14');
  });

  it('clamps to the last day of shorter months', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
    assert.equal(addMonths('2026-08-31', 3), '2026-11-30');
  });
});

describe('nextRenewalDate', () => {
  it('returns the start date when it is today or in the future', () => {
    assert.equal(nextRenewalDate('2026-10-14', 'monthly', '2026-10-14'), '2026-10-14');
    assert.equal(nextRenewalDate('2026-12-01', 'yearly', '2026-10-14'), '2026-12-01');
  });

  it('finds the next monthly renewal', () => {
    assert.equal(nextRenewalDate('2026-01-20', 'monthly', '2026-10-14'), '2026-10-20');
    assert.equal(nextRenewalDate('2026-01-10', 'monthly', '2026-10-14'), '2026-11-10');
  });

  it('keeps a month-end anchor instead of drifting', () => {
    // Started Jan 31: Feb renews on the 28th, but March is back on the 31st.
    assert.equal(nextRenewalDate('2026-01-31', 'monthly', '2026-02-15'), '2026-02-28');
    assert.equal(nextRenewalDate('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31');
  });

  it('handles quarterly and yearly cycles', () => {
    assert.equal(nextRenewalDate('2025-11-05', 'quarterly', '2026-10-14'), '2026-11-05');
    assert.equal(nextRenewalDate('2026-01-05', 'quarterly', '2026-10-14'), '2027-01-05');
    assert.equal(nextRenewalDate('2020-10-14', 'yearly', '2026-10-14'), '2026-10-14');
    assert.equal(nextRenewalDate('2020-10-13', 'yearly', '2026-10-14'), '2027-10-13');
    assert.equal(nextRenewalDate('2024-02-29', 'yearly', '2026-10-14'), '2027-02-28');
  });
});

describe('other helpers', () => {
  it('counts days between calendar dates', () => {
    assert.equal(daysBetween('2026-10-14', '2026-10-21'), 7);
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
    assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30); // across a DST change in many zones
  });

  it('validates ISO dates', () => {
    assert.ok(isValidISODate('2028-02-29'));
    assert.ok(!isValidISODate('2026-02-29'));
    assert.ok(!isValidISODate('2026-13-01'));
    assert.ok(!isValidISODate('14/10/2026'));
    assert.ok(!isValidISODate(undefined));
  });

  it('reads today in a specific time zone', () => {
    const instant = new Date('2026-10-14T20:00:00Z');
    assert.equal(todayInTimeZone('Asia/Kolkata', instant), '2026-10-15');
    assert.equal(todayInTimeZone('America/New_York', instant), '2026-10-14');
    assert.deepEqual(nowInTimeZone('UTC', new Date('2026-10-14T00:05:00Z')), { date: '2026-10-14', time: '00:05' });
  });

  it('formats dates and countdowns for humans', () => {
    assert.equal(formatLongDate('2026-11-01'), '1 Nov 2026');
    assert.equal(describeDaysUntil(0), 'today');
    assert.equal(describeDaysUntil(1), 'tomorrow');
    assert.equal(describeDaysUntil(7), 'in 7 days');
  });
});
