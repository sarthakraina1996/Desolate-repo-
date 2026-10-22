// Indian payroll arithmetic. Pure functions only: no database access, so the
// rules can be unit tested and reused by the seed script and the API.
import { daysInMonth } from './dates.js';

// Statutory and structure rules used unless HR overrides them in settings.
export const DEFAULT_PAYROLL_RULES = {
  basicPct: 40, // Basic as % of monthly CTC
  hraPct: 40, // HRA as % of Basic (50 for metro is also common)
  pfEnabled: true,
  pfRate: 12, // employee and employer share, % of PF wages
  pfWageCeiling: 15000, // PF wages are capped at this Basic
  esiThreshold: 21000, // ESI applies when fixed monthly gross <= this
  esiEmployeeRate: 0.75,
  esiEmployerRate: 3.25,
  ptAmount: 200, // Professional Tax per month
  ptMinGross: 25000, // PT applies at or above this monthly gross
  lwfEmployee: 20, // Labour Welfare Fund, deducted in lwfMonths
  lwfEmployer: 40,
  lwfMonths: [12],
  unmarkedAs: 'present', // how past working days with no attendance mark are paid
};

const r = Math.round;

// Splits annual CTC into monthly Basic, HRA, employer PF and a balancing Special allowance.
export function salaryStructure(ctcAnnual, rules = DEFAULT_PAYROLL_RULES) {
  const monthlyCtc = r((Number(ctcAnnual) || 0) / 12);
  const basic = r((monthlyCtc * rules.basicPct) / 100);
  const hra = r((basic * rules.hraPct) / 100);
  const employerPf = rules.pfEnabled
    ? r((Math.min(basic, rules.pfWageCeiling) * rules.pfRate) / 100)
    : 0;
  const special = Math.max(0, monthlyCtc - basic - hra - employerPf);
  return { monthlyCtc, basic, hra, special, employerPf, gross: basic + hra + special };
}

// Rough monthly TDS, new regime (FY 2025-26 slabs, Rs 75k std deduction, 87A rebate to Rs 12L
// with marginal relief, 4% cess). Estimate only: ignores other income and exemptions.
export function estimateMonthlyTds(ctcAnnual, rules = DEFAULT_PAYROLL_RULES) {
  const s = salaryStructure(ctcAnnual, rules);
  const taxable = Math.max(0, s.gross * 12 - 75000);
  const slabs = [
    [400000, 0],
    [800000, 0.05],
    [1200000, 0.1],
    [1600000, 0.15],
    [2000000, 0.2],
    [2400000, 0.25],
    [Infinity, 0.3],
  ];
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of slabs) {
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * rate;
    lower = upper;
  }
  // 87A rebate, and marginal relief: tax above Rs 12L can't exceed the income above it.
  if (taxable <= 1200000) tax = 0;
  else tax = Math.min(tax, taxable - 1200000);
  return r((tax * 1.04) / 12);
}

// Computes one month's payslip: pro-rated earnings, statutory deductions and employer cost.
// adjustments: [{ kind: 'Bonus'|'Arrears'|'Reimbursement'|'Deduction', amount }]
export function computePayslip({
  ctc,
  monthlyTds = 0,
  month,
  employedDays,
  lopDays = 0,
  adjustments = [],
  rules = DEFAULT_PAYROLL_RULES,
}) {
  // Pay factor: days employed this month minus loss-of-pay days, over calendar days.
  const dim = daysInMonth(month);
  const employed = employedDays ?? dim;
  const lop = Math.min(Math.max(0, lopDays), employed);
  const paidDays = Math.max(0, employed - lop);
  const factor = paidDays / dim;
  const s = salaryStructure(ctc, rules);

  // One-off adjustments; reimbursements are paid but not part of gross.
  const sum = (kinds) =>
    adjustments
      .filter((a) => kinds.includes(a.kind))
      .reduce((t, a) => t + (Number(a.amount) || 0), 0);
  const bonus = sum(['Bonus', 'Arrears']);
  const reimbursement = sum(['Reimbursement']);
  const otherDeduction = sum(['Deduction']);

  const earnings = {
    basic: r(s.basic * factor),
    hra: r(s.hra * factor),
    special: r(s.special * factor),
    bonus,
    reimbursement,
  };
  const gross = earnings.basic + earnings.hra + earnings.special + bonus;
  const totalEarnings = gross + reimbursement;

  // Statutory deductions. ESI eligibility uses fixed gross, but is charged on actual gross;
  // PT, LWF and TDS are skipped in a month with no paid days.
  const pfWages = Math.min(earnings.basic, rules.pfWageCeiling);
  const pf = rules.pfEnabled ? r((pfWages * rules.pfRate) / 100) : 0;
  const employerPf = pf;
  const esiApplicable = s.gross > 0 && s.gross <= rules.esiThreshold;
  const esi = esiApplicable ? Math.ceil((gross * rules.esiEmployeeRate) / 100) : 0;
  const employerEsi = esiApplicable ? Math.ceil((gross * rules.esiEmployerRate) / 100) : 0;
  const monthNum = Number(month.slice(5, 7));
  const working = paidDays > 0;
  const pt = working && gross >= rules.ptMinGross ? rules.ptAmount : 0;
  const lwfDue = working && (rules.lwfMonths || []).includes(monthNum);
  const lwf = lwfDue ? rules.lwfEmployee : 0;
  const employerLwf = lwfDue ? rules.lwfEmployer : 0;
  const tds = working ? Math.max(0, r(Number(monthlyTds) || 0)) : 0;

  const deductions = { pf, esi, pt, tds, lwf, other: otherDeduction };
  const totalDeductions = pf + esi + pt + tds + lwf + otherDeduction;
  const net = Math.max(0, totalEarnings - totalDeductions);
  // Pay lost to unpaid days and partial employment, for display on the payslip.
  const lopAmount = s.gross - r(s.basic * factor) - r(s.hra * factor) - r(s.special * factor);

  return {
    month,
    daysInMonth: dim,
    employedDays: employed,
    lopDays: lop,
    paidDays,
    structure: s,
    earnings,
    lopAmount: Math.max(0, lopAmount),
    gross,
    totalEarnings,
    deductions,
    totalDeductions,
    net,
    employer: { pf: employerPf, esi: employerEsi, lwf: employerLwf },
    employerCost: totalEarnings + employerPf + employerEsi + employerLwf,
  };
}
