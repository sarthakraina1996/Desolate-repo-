// Tax calculation from effective-dated, optionally slab-based rules (India GST on rooms is
// chosen by the value per room per night). Each component (CGST, SGST, VAT) is rounded on its
// own so the invoice shows exactly what is payable per component.
import { fail } from '../../core/errors.js';
import { bpOf, mulDiv, allocate } from '../../core/money.js';
import { json } from '../../db/connection.js';

export function rulesFor(db, propertyId, category, date) {
  return db
    .all(
      `SELECT * FROM tax_rules WHERE property_id = ? AND category = ? AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?) ORDER BY slab_min_minor`,
      propertyId,
      category,
      date,
      date,
    )
    .map((r) => ({ ...r, components: json(r.components, []) }));
}

// Picks the rule whose slab contains the unit value (rules without slabs always match).
export function pickRule(rules, unitNetMinor) {
  const match = rules.filter(
    (r) =>
      (r.slab_min_minor == null || unitNetMinor >= r.slab_min_minor) &&
      (r.slab_max_minor == null || unitNetMinor <= r.slab_max_minor),
  );
  if (match.length > 1) fail(500, 'Overlapping tax rules are configured for this category');
  return match[0] || null;
}

// amountMinor is the line amount as priced (quantity × unit). With inclusive pricing the tax is
// extracted from it; otherwise it is added. unitMinor (per room per night) selects the slab.
export function computeTax(rules, { amountMinor, unitMinor = amountMinor, inclusive = false }) {
  if (inclusive) {
    // Inclusive prices: find the rule by the extracted unit value (slabs are rare here).
    const candidates = rules.length ? rules : [];
    for (const r of candidates) {
      const unitNet = mulDiv(unitMinor, 10000, 10000 + r.rate_bp);
      if (pickRule([r], unitNet)) return split(r, mulDiv(amountMinor, 10000, 10000 + r.rate_bp), amountMinor);
    }
    return { net: amountMinor, tax: 0, gross: amountMinor, rule: null, lines: [] };
  }
  const rule = pickRule(rules, unitMinor);
  if (!rule) return { net: amountMinor, tax: 0, gross: amountMinor, rule: null, lines: [] };
  const lines = rule.components.map((c) => ({
    code: c.code,
    rate_bp: c.rate_bp,
    account: c.account,
    amount: bpOf(amountMinor, c.rate_bp),
  }));
  const tax = lines.reduce((a, l) => a + l.amount, 0);
  return { net: amountMinor, tax, gross: amountMinor + tax, rule: ruleInfo(rule), lines };
}

function split(rule, net, gross) {
  const tax = gross - net;
  const parts = allocate(tax, rule.components.map((c) => c.rate_bp || 1));
  const lines = rule.components.map((c, i) => ({ code: c.code, rate_bp: c.rate_bp, account: c.account, amount: parts[i] }));
  return { net, tax, gross, rule: ruleInfo(rule), lines };
}

const ruleInfo = (r) => ({ id: r.id, name: r.name, rate_bp: r.rate_bp });
