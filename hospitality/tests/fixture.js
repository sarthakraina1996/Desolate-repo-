// Small, fully controlled hotel for service-level tests: one organisation, one Indian
// property (business date 2026-10-24) with 6 Deluxe and 2 Suite rooms, a BAR plan and a
// breakfast package, and one user per role. Services are called directly with an actor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db/connection.js';
import { createBuilding, createOrganization, createProperty } from '../server/modules/properties/service.js';
import { saveRoom, saveRoomType } from '../server/modules/rooms/service.js';
import { saveRatePlan } from '../server/modules/rates/service.js';
import { hashPassword, loadUser } from '../server/modules/auth/service.js';
import { createBooking } from '../server/modules/reservations/service.js';

export const BD = '2026-10-24';
const ROLES = ['admin', 'gm', 'front_desk', 'housekeeping_manager', 'housekeeping_attendant', 'finance', 'banquet_manager', 'owner'];

export function fixture({ inspection = true, overbookingPct = 0, code = 'FXH', orgName = 'Fixture Hotels' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhos-fx-'));
  const db = openDb(path.join(dir, 'fx.db'));
  const orgId = createOrganization(db, { name: orgName, reportingCurrency: 'INR' });
  const hash = hashPassword('Fixture@2026');
  const users = {};
  for (const role of ROLES) {
    const id = db.insert('users', {
      org_id: orgId,
      email: `${role}@${code.toLowerCase()}.test`,
      name: role,
      role,
      all_properties: ['admin', 'owner', 'finance'].includes(role) ? 1 : 0,
      password_hash: hash,
    });
    users[role] = id;
  }
  const admin = loadUser(db, users.admin);
  const le = db.insert('legal_entities', { org_id: orgId, name: `${orgName} Pvt Ltd`, country: 'IN', tax_id_type: 'GSTIN', tax_id: '07AAAAA0000A1Z5', base_currency: 'INR' });
  const prop = createProperty(db, admin, orgId, {
    code,
    name: `${code} Hotel`,
    country: 'IN',
    state: 'Delhi',
    state_code: '07',
    city: 'New Delhi',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    tax_regime: 'IN_GST',
    business_date: BD,
    invoice_prefix: code,
    legal_entity_id: le,
    inspection_required: inspection ? 1 : 0,
    overbooking_pct: overbookingPct,
  });
  for (const role of ROLES) db.run('INSERT OR IGNORE INTO user_properties (user_id, property_id) VALUES (?, ?)', users[role], prop.id);
  const actors = Object.fromEntries(ROLES.map((r) => [r, loadUser(db, users[r])]));
  const building = createBuilding(db, admin, prop.id, { code: 'MAIN', name: 'Main', floors: [{ level: 1 }] });
  const floor = db.value('SELECT id FROM floors WHERE building_id = ?', building.id);
  const dlx = saveRoomType(db, admin, prop.id, { code: 'DLX', name: 'Deluxe', base_adults: 2, max_adults: 3, max_children: 2, max_occupancy: 4 });
  const ste = saveRoomType(db, admin, prop.id, { code: 'STE', name: 'Suite', base_adults: 2, max_adults: 4, max_children: 2, max_occupancy: 5 });
  const rooms = { DLX: [], STE: [] };
  for (let i = 1; i <= 8; i++) {
    const type = i <= 6 ? dlx : ste;
    const room = saveRoom(db, admin, prop.id, { number: String(100 + i), building_id: building.id, floor_id: floor, room_type_id: type.id, commissioned_on: '2020-01-01' });
    db.run("UPDATE rooms SET hk_status = 'inspected' WHERE id = ?", room.id);
    rooms[type.code].push(room.id);
  }
  const policy = db.value("SELECT id FROM cancellation_policies WHERE property_id = ? AND code = 'FLEX24'", prop.id);
  const bar = saveRatePlan(db, admin, prop.id, {
    code: 'BAR',
    name: 'Best available',
    meal_plan: 'RO',
    cancellation_policy_id: policy,
    roomTypes: [
      { room_type_id: dlx.id, base_minor: 500000, weekend_minor: 500000, extra_adult_minor: 100000, extra_child_minor: 50000 },
      { room_type_id: ste.id, base_minor: 1200000, weekend_minor: 1200000, extra_adult_minor: 150000, extra_child_minor: 50000 },
    ],
  });
  const bb = saveRatePlan(db, admin, prop.id, { code: 'BB', name: 'Bed & breakfast', meal_plan: 'BB', parent_id: bar.id, derive_kind: 'amount', derive_value: 160000, fnb_component_minor: 80000, cancellation_policy_id: policy });
  let n = 0;
  // Books one room; returns the reservation detail.
  const book = (actor = actors.front_desk, line = {}, extra = {}, opts = {}) => {
    n++;
    const b = createBooking(
      db,
      actor,
      {
        propertyId: prop.id,
        guest: { first_name: 'Guest', last_name: `No${n}`, email: `guest${n}@example.test` },
        source: 'Direct',
        ...extra,
        rooms: [{ roomTypeId: dlx.id, ratePlanId: bar.id, arrival: BD, departure: '2026-10-26', adults: 2, ...line }],
      },
      opts,
    );
    return b.reservations[0];
  };
  const close = () => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { db, dir, orgId, prop, actors, users, admin, types: { dlx, ste }, rooms, plans: { bar, bb }, book, close };
}

// Asserts that fn throws an HttpError with the given status (and code, when given).
export function rejects(fn, status, code) {
  try {
    fn();
  } catch (e) {
    if (e.status !== status || (code && e.code !== code)) throw new Error(`Expected ${status}${code ? `/${code}` : ''}, got ${e.status}/${e.code}: ${e.message}`);
    return e;
  }
  throw new Error(`Expected ${status}${code ? `/${code}` : ''}, but it succeeded`);
}
