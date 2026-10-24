// Room types, physical rooms, amenity inheritance with authorised exceptions, out-of-order /
// out-of-service blocks (which lock room nights like reservations do) and the room profile.
import { stamp } from '../../core/clock.js';
import { conflict, fail, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { addDays, nights as nightsOf } from '../../core/dates.js';
import { json } from '../../db/connection.js';

// Attributes a room inherits from its type unless the room sets its own value.
export const INHERITED = [
  'area_sqft',
  'bedrooms',
  'bed_type',
  'bed_size',
  'max_adults',
  'max_children',
  'extra_beds',
  'view_type',
  'smoking',
  'balcony',
  'bathroom',
  'ac_type',
];

const SQFT_TO_SQM = 0.09290304;
export const sqm = (sqft) => (sqft == null ? null : Math.round(sqft * SQFT_TO_SQM * 10) / 10);

const TYPE_FIELDS = [
  'code',
  'name',
  'category',
  'description',
  'base_adults',
  'max_adults',
  'max_children',
  'max_occupancy',
  'extra_beds',
  'area_sqft',
  'bedrooms',
  'bed_type',
  'bed_size',
  'view_type',
  'smoking',
  'balcony',
  'bathroom',
  'ac_type',
  'color',
  'sort',
  'active',
];
const ROOM_FIELDS = [
  'number',
  'building_id',
  'floor_id',
  'room_type_id',
  ...INHERITED,
  'accessible',
  'accessibility_features',
  'connecting_room_id',
  'description',
  'last_refurbished_on',
  'warranty_notes',
  'cost_centre_id',
  'rate_plan_codes',
  'commissioned_on',
  'decommissioned_on',
  'sort',
];

const pick = (input, fields) => {
  const row = {};
  for (const f of fields) if (input[f] !== undefined) row[f] = input[f];
  return row;
};

// ---------- room types ----------
export function listRoomTypes(db, propertyId) {
  const types = db.all(
    `SELECT t.*, (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = t.id AND r.decommissioned_on IS NULL) AS room_count
     FROM room_types t WHERE t.property_id = ? ORDER BY t.sort, t.code`,
    propertyId,
  );
  const am = db.all(
    `SELECT rta.room_type_id, a.code, a.name, a.category, a.icon FROM room_type_amenities rta
     JOIN amenities a ON a.id = rta.amenity_id JOIN room_types t ON t.id = rta.room_type_id
     WHERE t.property_id = ? ORDER BY a.category, a.name`,
    propertyId,
  );
  return types.map((t) => ({
    ...t,
    area_sqm: sqm(t.area_sqft),
    amenities: am.filter((a) => a.room_type_id === t.id).map(({ room_type_id, ...a }) => a),
  }));
}

function amenityIds(db, orgId, codes = []) {
  return codes.map((code) => {
    const id = db.value('SELECT id FROM amenities WHERE org_id = ? AND code = ?', orgId, code);
    if (!id) fail(400, `Unknown amenity ${code}`);
    return id;
  });
}

export function saveRoomType(db, actor, propertyId, input, id = null) {
  return db.tx(() => {
    const orgId = db.value('SELECT org_id FROM properties WHERE id = ?', propertyId);
    const row = pick(input, TYPE_FIELDS);
    let typeId = id;
    let before = null;
    if (id) {
      before = db.get('SELECT * FROM room_types WHERE id = ? AND property_id = ?', id, propertyId);
      if (!before) notFound('Room type');
      db.update('room_types', id, row);
    } else {
      if (!row.code || !row.name) fail(400, 'Room type code and name are required');
      typeId = db.insert('room_types', { ...row, property_id: propertyId });
    }
    if (Array.isArray(input.amenities)) {
      db.run('DELETE FROM room_type_amenities WHERE room_type_id = ?', typeId);
      for (const aid of amenityIds(db, orgId, input.amenities))
        db.run('INSERT INTO room_type_amenities (room_type_id, amenity_id) VALUES (?, ?)', typeId, aid);
    }
    const after = db.get('SELECT * FROM room_types WHERE id = ?', typeId);
    audit(db, actor, id ? 'room_type.update' : 'room_type.create', {
      entity: 'room_type',
      entityId: typeId,
      propertyId,
      before,
      after: { ...after, amenities: input.amenities },
    });
    emit(db, { propertyId, entity: 'room_type', entityUid: after.uid, op: id ? 'update' : 'create', payload: after });
    return after;
  });
}

// ---------- rooms ----------
export function saveRoom(db, actor, propertyId, input, id = null) {
  return db.tx(() => {
    const row = pick(input, ROOM_FIELDS);
    if (row.accessibility_features !== undefined)
      row.accessibility_features = JSON.stringify(row.accessibility_features || []);
    if (row.rate_plan_codes !== undefined)
      row.rate_plan_codes = row.rate_plan_codes == null ? null : JSON.stringify(row.rate_plan_codes);
    for (const [col, table] of [
      ['building_id', 'buildings'],
      ['floor_id', 'floors'],
      ['room_type_id', 'room_types'],
      ['connecting_room_id', 'rooms'],
      ['cost_centre_id', 'cost_centres'],
    ])
      if (row[col] != null && !db.value(`SELECT 1 FROM ${table} WHERE id = ? AND property_id = ?`, row[col], propertyId))
        fail(400, `${col.replace('_id', '').replace('_', ' ')} does not belong to this property`);
    let roomId = id;
    let before = null;
    if (id) {
      before = db.get('SELECT * FROM rooms WHERE id = ? AND property_id = ?', id, propertyId);
      if (!before) notFound('Room');
      if (row.room_type_id && row.room_type_id !== before.room_type_id) {
        // Changing a room's type moves future inventory; refuse while bookings hold the room.
        const held = db.value(
          `SELECT COUNT(*) FROM room_nights WHERE room_id = ? AND reservation_id IS NOT NULL AND night >= (SELECT business_date FROM properties WHERE id = ?)`,
          id,
          propertyId,
        );
        if (held) conflict('Move the future reservations off this room before changing its type');
      }
      db.update('rooms', id, { ...row, version: before.version + 1, updated_at: stamp(actor) });
    } else {
      if (!row.number || !row.building_id || !row.floor_id || !row.room_type_id)
        fail(400, 'Room number, building, floor and room type are required');
      row.commissioned_on ||= db.value('SELECT business_date FROM properties WHERE id = ?', propertyId);
      roomId = db.insert('rooms', { ...row, property_id: propertyId });
    }
    const after = db.get('SELECT * FROM rooms WHERE id = ?', roomId);
    audit(db, actor, id ? 'room.update' : 'room.create', { entity: 'room', entityId: roomId, propertyId, before, after });
    emit(db, { propertyId, entity: 'room', entityUid: after.uid, op: id ? 'update' : 'create', payload: after });
    return after;
  });
}

// Adds or removes one amenity for a single room, with a recorded reason (authorised exception).
export function setAmenityOverride(db, actor, room, { amenity, mode, reason }) {
  if (!['add', 'remove', 'inherit'].includes(mode)) fail(400, 'Mode must be add, remove or inherit');
  const orgId = db.value('SELECT org_id FROM properties WHERE id = ?', room.property_id);
  const [aid] = amenityIds(db, orgId, [amenity]);
  return db.tx(() => {
    db.run('DELETE FROM room_amenity_overrides WHERE room_id = ? AND amenity_id = ?', room.id, aid);
    if (mode !== 'inherit') {
      if (!reason) fail(400, 'A reason is required for a room-level amenity exception');
      db.run(
        'INSERT INTO room_amenity_overrides (room_id, amenity_id, mode, reason, approved_by) VALUES (?, ?, ?, ?, ?)',
        room.id,
        aid,
        mode,
        reason,
        actor?.id ?? null,
      );
    }
    audit(db, actor, 'room.amenity_override', {
      entity: 'room',
      entityId: room.id,
      propertyId: room.property_id,
      after: { amenity, mode, reason },
    });
    return effectiveRoom(db, room.id);
  });
}

// The room as guests and staff see it: inherited attributes with the source of each value,
// amenities after exceptions, and area in both units.
export function effectiveRoom(db, roomId) {
  const room = db.get(
    `SELECT r.*, t.code AS type_code, t.name AS type_name, t.category AS type_category, t.color AS type_color,
            t.base_adults, t.max_occupancy, b.code AS building_code, b.name AS building_name,
            f.level AS floor_level, f.name AS floor_name, cr.number AS connecting_room_number,
            cc.code AS cost_centre_code, cc.name AS cost_centre_name
     FROM rooms r JOIN room_types t ON t.id = r.room_type_id
     JOIN buildings b ON b.id = r.building_id JOIN floors f ON f.id = r.floor_id
     LEFT JOIN rooms cr ON cr.id = r.connecting_room_id
     LEFT JOIN cost_centres cc ON cc.id = r.cost_centre_id
     WHERE r.id = ?`,
    roomId,
  );
  if (!room) notFound('Room');
  const type = db.get('SELECT * FROM room_types WHERE id = ?', room.room_type_id);
  const attributes = {};
  for (const f of INHERITED) {
    const own = room[f];
    attributes[f] = { value: own ?? type[f], source: own != null ? 'room' : 'type' };
  }
  attributes.area_sqm = { value: sqm(attributes.area_sqft.value), source: attributes.area_sqft.source };
  const typeAmenities = db.all(
    `SELECT a.id, a.code, a.name, a.category, a.icon FROM room_type_amenities rta
     JOIN amenities a ON a.id = rta.amenity_id WHERE rta.room_type_id = ?`,
    room.room_type_id,
  );
  const overrides = db.all(
    `SELECT o.mode, o.reason, o.at, a.id, a.code, a.name, a.category, a.icon, u.name AS approved_by_name
     FROM room_amenity_overrides o JOIN amenities a ON a.id = o.amenity_id
     LEFT JOIN users u ON u.id = o.approved_by WHERE o.room_id = ?`,
    roomId,
  );
  const removed = new Set(overrides.filter((o) => o.mode === 'remove').map((o) => o.id));
  const amenities = [
    ...typeAmenities.filter((a) => !removed.has(a.id)).map((a) => ({ ...a, source: 'type' })),
    ...overrides
      .filter((o) => o.mode === 'add' && !typeAmenities.some((a) => a.id === o.id))
      .map((o) => ({ id: o.id, code: o.code, name: o.name, category: o.category, icon: o.icon, source: 'room', reason: o.reason })),
  ].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return {
    ...room,
    accessibility_features: json(room.accessibility_features, []),
    rate_plan_codes: json(room.rate_plan_codes, null),
    attributes,
    amenities,
    amenityExceptions: overrides,
  };
}

// ---------- blocks (out of order / out of service) ----------
export function createBlock(db, actor, propertyId, { roomId, kind, startDate, endDate, reason }) {
  if (!['ooo', 'oos'].includes(kind)) fail(400, 'Block kind must be ooo or oos');
  if (!reason) fail(400, 'A reason is required');
  if (!(endDate > startDate)) fail(400, 'The block must end after it starts');
  return db.tx(() => {
    const room = db.get('SELECT * FROM rooms WHERE id = ? AND property_id = ?', roomId, propertyId);
    if (!room) notFound('Room');
    const nights = nightsOf(startDate, endDate);
    const clash = db.all(
      `SELECT rn.night, r.conf_no, r.id AS reservation_id, g.first_name || ' ' || g.last_name AS guest
       FROM room_nights rn JOIN reservations r ON r.id = rn.reservation_id JOIN guests g ON g.id = r.guest_id
       WHERE rn.room_id = ? AND rn.night >= ? AND rn.night < ? ORDER BY rn.night`,
      roomId,
      startDate,
      endDate,
    );
    if (clash.length)
      conflict(`Room ${room.number} has reservations in this period; move them first`, {
        code: 'room_occupied',
        details: { reservations: clash },
      });
    const blockId = db.insert('room_blocks', {
      property_id: propertyId,
      room_id: roomId,
      kind,
      start_date: startDate,
      end_date: endDate,
      reason,
      created_by: actor?.id ?? null,
      created_at: stamp(actor),
    });
    try {
      for (const night of nights)
        db.run(
          'INSERT INTO room_nights (room_id, night, property_id, block_id) VALUES (?, ?, ?, ?)',
          roomId,
          night,
          propertyId,
          blockId,
        );
    } catch (e) {
      if (/UNIQUE|PRIMARY KEY/.test(e.message))
        conflict(`Room ${room.number} is already blocked for part of this period`, { code: 'room_blocked' });
      throw e;
    }
    const block = db.get('SELECT * FROM room_blocks WHERE id = ?', blockId);
    audit(db, actor, 'room.block', { entity: 'room_block', entityId: blockId, propertyId, after: block });
    emit(db, { propertyId, entity: 'room_block', entityUid: block.uid, op: 'create', payload: block });
    return block;
  });
}

// Ends a block early: nights from the business date on are released; past nights stay as the
// record of when the room was out of order.
export function releaseBlock(db, actor, propertyId, blockId) {
  return db.tx(() => {
    const block = db.get('SELECT * FROM room_blocks WHERE id = ? AND property_id = ?', blockId, propertyId);
    if (!block) notFound('Block');
    if (block.released_at) fail(400, 'This block was already released');
    const bd = db.value('SELECT business_date FROM properties WHERE id = ?', propertyId);
    db.run('DELETE FROM room_nights WHERE block_id = ? AND night >= ?', blockId, bd);
    const end = bd > block.start_date ? (bd < block.end_date ? bd : block.end_date) : block.end_date;
    db.run(
      'UPDATE room_blocks SET released_at = ?, released_by = ?, end_date = ? WHERE id = ?',
      stamp(actor),
      actor?.id ?? null,
      end,
      blockId,
    );
    const after = db.get('SELECT * FROM room_blocks WHERE id = ?', blockId);
    audit(db, actor, 'room.block_release', { entity: 'room_block', entityId: blockId, propertyId, before: block, after });
    emit(db, { propertyId, entity: 'room_block', entityUid: block.uid, op: 'release', payload: after });
    return after;
  });
}

// Active block on a room for a given night, if any.
export const blockOn = (db, roomId, night) =>
  db.get(
    `SELECT b.* FROM room_nights rn JOIN room_blocks b ON b.id = rn.block_id
     WHERE rn.room_id = ? AND rn.night = ?`,
    roomId,
    night,
  );

// Rooms with their live status for a property on its business date: occupancy (from in-house
// reservations), cleanliness, DND, maintenance flag and any block tonight.
export function roomsWithStatus(db, propertyId) {
  const bd = db.value('SELECT business_date FROM properties WHERE id = ?', propertyId);
  const yesterday = addDays(bd, -1);
  const rooms = db.all(
    `SELECT r.id, r.number, r.room_type_id, r.hk_status, r.dnd, r.maintenance_flag, r.maintenance_note,
            r.accessible, r.connecting_room_id, r.sort, r.building_id, r.floor_id,
            COALESCE(r.view_type, t.view_type) AS view_type, COALESCE(r.area_sqft, t.area_sqft) AS area_sqft,
            COALESCE(r.max_adults, t.max_adults) AS max_adults,
            t.code AS type_code, t.name AS type_name, t.color AS type_color, t.sort AS type_sort,
            b.code AS building_code, b.name AS building_name, f.level AS floor_level, f.name AS floor_name
     FROM rooms r JOIN room_types t ON t.id = r.room_type_id
     JOIN buildings b ON b.id = r.building_id JOIN floors f ON f.id = r.floor_id
     WHERE r.property_id = ? AND r.commissioned_on <= ? AND (r.decommissioned_on IS NULL OR r.decommissioned_on > ?)
     ORDER BY b.sort, f.level, r.sort, r.number`,
    propertyId,
    bd,
    bd,
  );
  // Current occupant: an in-house reservation holding the room tonight or last night (a
  // guest due out today is still in the room until checked out).
  const occupants = db.all(
    `SELECT rn.room_id, r.id, r.conf_no, r.arrival, r.departure, r.adults, r.children, r.status,
            g.first_name, g.last_name, g.vip
     FROM room_nights rn JOIN reservations r ON r.id = rn.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE rn.property_id = ? AND rn.night IN (?, ?) AND r.status = 'in_house'
     ORDER BY rn.night DESC`,
    propertyId,
    bd,
    yesterday,
  );
  const arrivals = db.all(
    `SELECT rn.room_id, r.id, r.conf_no, r.arrival, g.first_name, g.last_name, g.vip
     FROM room_nights rn JOIN reservations r ON r.id = rn.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE rn.property_id = ? AND rn.night = ? AND r.status = 'confirmed' AND r.arrival = ?`,
    propertyId,
    bd,
    bd,
  );
  const blocks = db.all(
    `SELECT rn.room_id, b.id, b.kind, b.reason, b.start_date, b.end_date FROM room_nights rn
     JOIN room_blocks b ON b.id = rn.block_id WHERE rn.property_id = ? AND rn.night = ?`,
    propertyId,
    bd,
  );
  const byRoom = (list) => {
    const m = new Map();
    for (const x of list) if (!m.has(x.room_id)) m.set(x.room_id, x);
    return m;
  };
  const occ = byRoom(occupants);
  const arr = byRoom(arrivals);
  const blk = byRoom(blocks);
  return {
    businessDate: bd,
    rooms: rooms.map((r) => {
      const o = occ.get(r.id);
      const b = blk.get(r.id);
      const occupied = Boolean(o);
      return {
        ...r,
        occupied,
        occupant: o
          ? { reservationId: o.id, confNo: o.conf_no, guest: `${o.first_name} ${o.last_name}`.trim(), vip: o.vip, arrival: o.arrival, departure: o.departure, dueOut: o.departure === bd, adults: o.adults, children: o.children }
          : null,
        arrival: arr.get(r.id)
          ? { reservationId: arr.get(r.id).id, confNo: arr.get(r.id).conf_no, guest: `${arr.get(r.id).first_name} ${arr.get(r.id).last_name}`.trim(), vip: arr.get(r.id).vip }
          : null,
        block: b ? { id: b.id, kind: b.kind, reason: b.reason, start: b.start_date, end: b.end_date } : null,
        code: statusCode({ occupied, hk: r.hk_status, block: b?.kind }),
      };
    }),
  };
}

// Display code from the separate status dimensions (PRD HK-1).
export function statusCode({ occupied, hk, block }) {
  if (block === 'ooo') return 'OOO';
  if (block === 'oos') return 'OOS';
  if (hk === 'cleaning') return 'CIP';
  if (occupied) return hk === 'dirty' ? 'OD' : 'OC';
  if (hk === 'dirty') return 'VD';
  return hk === 'inspected' ? 'INSP' : 'VC';
}
