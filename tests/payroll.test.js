import test from 'node:test';
import assert from 'node:assert/strict';
import { salaryStructure, computePayslip, estimateMonthlyTds, DEFAULT_PAYROLL_RULES as R } from '../server/lib/payroll.js';

test('salary structure splits monthly CTC into basic, HRA, special and employer PF', () => {
  const s = salaryStructure(1200000, R); // 1,00,000 per month
  assert.equal(s.monthlyCtc, 100000);
  assert.equal(s.basic, 40000);
  assert.equal(s.hra, 16000);
  assert.equal(s.employerPf, 1800); // 12% of the 15,000 ceiling
  assert.equal(s.special, 100000 - 40000 - 16000 - 1800);
  assert.equal(s.gross, s.basic + s.hra + s.special);
});

test('full month payslip: PF capped, no ESI above threshold, PT applies', () => {
  const p = computePayslip({ ctc: 1200000, monthlyTds: 5000, month: '2026-10', employedDays: 31, lopDays: 0, rules: R });
  assert.equal(p.paidDays, 31);
  assert.equal(p.deductions.pf, 1800);
  assert.equal(p.deductions.esi, 0);
  assert.equal(p.deductions.pt, 200);
  assert.equal(p.deductions.tds, 5000);
  assert.equal(p.net, p.totalEarnings - p.totalDeductions);
});

test('loss of pay reduces earnings pro rata on calendar days', () => {
  const full = computePayslip({ ctc: 600000, month: '2026-09', employedDays: 30, lopDays: 0, rules: R });
  const lop = computePayslip({ ctc: 600000, month: '2026-09', employedDays: 30, lopDays: 3, rules: R });
  assert.equal(lop.paidDays, 27);
  assert.ok(Math.abs(lop.gross - full.gross * 0.9) <= 3);
  assert.ok(lop.lopAmount > 0);
});

test('ESI applies when fixed gross is within the threshold', () => {
  const p = computePayslip({ ctc: 250000, month: '2026-10', rules: R });
  assert.ok(p.structure.gross <= R.esiThreshold);
  assert.equal(p.deductions.esi, Math.ceil(p.gross * 0.0075));
  assert.equal(p.employer.esi, Math.ceil(p.gross * 0.0325));
  assert.equal(p.deductions.pt, 0); // below the PT threshold
});

test('mid-month joiner is paid only for employed days', () => {
  const p = computePayslip({ ctc: 600000, month: '2026-10', employedDays: 11, rules: R });
  assert.equal(p.paidDays, 11);
  assert.ok(p.gross < p.structure.gross / 2);
});

test('adjustments: bonus is earnings, reimbursement is outside gross, deduction is deducted', () => {
  const p = computePayslip({ ctc: 600000, month: '2026-10', rules: R, adjustments: [{ kind: 'Bonus', amount: 5000 }, { kind: 'Reimbursement', amount: 1200 }, { kind: 'Deduction', amount: 700 }] });
  assert.equal(p.earnings.bonus, 5000);
  assert.equal(p.earnings.reimbursement, 1200);
  assert.equal(p.totalEarnings, p.gross + 1200);
  assert.equal(p.deductions.other, 700);
});

test('LWF is deducted only in configured months', () => {
  assert.equal(computePayslip({ ctc: 600000, month: '2026-12', rules: R }).deductions.lwf, 20);
  assert.equal(computePayslip({ ctc: 600000, month: '2026-11', rules: R }).deductions.lwf, 0);
});

test('TDS estimate: nil up to 12 lakh taxable, positive above', () => {
  assert.equal(estimateMonthlyTds(1000000, R), 0);
  assert.ok(estimateMonthlyTds(2400000, R) > 0);
  assert.ok(estimateMonthlyTds(4000000, R) > estimateMonthlyTds(2400000, R));
});
