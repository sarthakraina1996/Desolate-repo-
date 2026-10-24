// Route helpers shared by the module routers.
import { requirePermission, assertProperty } from './access.js';
import { can } from './permissions.js';

// Middleware: the signed-in user must hold every listed permission.
export const perm =
  (...permissions) =>
  (req, _res, next) => {
    for (const p of permissions) requirePermission(req, p);
    next();
  };

// The property a request is about (query ?property=, body.propertyId or :propertyId), scoped.
export const propertyOf = (db, req) =>
  assertProperty(db, req.user, req.params.propertyId ?? req.query.property ?? req.body?.propertyId);

// Actor passed to services (the signed-in user).
export const actorOf = (req) => req.user;

const MONEY_FIELDS = [
  'adr',
  'revpar',
  'trevpar',
  'room_revenue',
  'rooms_other_revenue',
  'fnb_revenue',
  'banquet_revenue',
  'spa_revenue',
  'other_revenue',
  'misc_revenue',
  'total_operating_revenue',
  'commission_cost',
  'net_room_revenue',
  'provisional_room_revenue',
];

// Removes monetary values for users without financial visibility (PRD DASH, security §5).
export function redactMoney(obj, user) {
  if (can(user, 'dashboard.financial')) return obj;
  const walk = (o) => {
    if (Array.isArray(o)) return o.map(walk);
    if (!o || typeof o !== 'object') return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = MONEY_FIELDS.includes(k) ? null : walk(v);
    return out;
  };
  return { ...walk(obj), financialRestricted: true };
}

export const intParam = (v, d) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : d;
};
