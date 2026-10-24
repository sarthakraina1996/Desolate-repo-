// Room types, rooms, amenity exceptions, out-of-order / out-of-service blocks, images.
import path from 'node:path';
import fs from 'node:fs';
import { fail, notFound } from '../../core/errors.js';
import { str, int, num, date, oneOf, bool } from '../../core/validate.js';
import { perm, propertyOf } from '../../core/http.js';
import { assertProperty, scopedRow } from '../../core/access.js';
import { can } from '../../core/permissions.js';
import { audit } from '../../core/audit.js';
import { addDays } from '../../core/dates.js';
import {
  createBlock,
  effectiveRoom,
  INHERITED,
  listRoomTypes,
  releaseBlock,
  roomsWithStatus,
  saveRoom,
  saveRoomType,
  setAmenityOverride,
} from './service.js';

function typeInput(b) {
  const out = {};
  const s = (k, max = 120) => b[k] !== undefined && (out[k] = str(b[k], { max, name: k }));
  const i = (k, min = 0, max = 20) => b[k] !== undefined && (out[k] = int(b[k], { min, max, name: k }));
  ['code', 'name', 'category', 'bed_type', 'bed_size', 'view_type', 'bathroom', 'ac_type', 'color'].forEach((k) => s(k));
  s('description', 2000);
  ['base_adults', 'max_adults', 'max_children', 'max_occupancy', 'extra_beds', 'bedrooms'].forEach((k) => i(k));
  i('sort', 0, 1000);
  if (b.area_sqft !== undefined) out.area_sqft = num(b.area_sqft, { min: 0, max: 50000, name: 'Area' });
  for (const k of ['smoking', 'balcony', 'active']) if (b[k] !== undefined) out[k] = bool(b[k]) ? 1 : 0;
  if (Array.isArray(b.amenities)) out.amenities = b.amenities.map((a) => str(a, { max: 40 }));
  return out;
}

function roomInput(b) {
  const out = {};
  if (b.number !== undefined) out.number = str(b.number, { required: true, max: 10, name: 'Room number' });
  for (const k of ['building_id', 'floor_id', 'room_type_id', 'connecting_room_id', 'cost_centre_id'])
    if (b[k] !== undefined) out[k] = b[k] === null ? null : int(b[k], { min: 1, name: k });
  for (const k of INHERITED) {
    if (b[k] === undefined) continue;
    if (b[k] === null || b[k] === '') out[k] = null;
    else if (['area_sqft'].includes(k)) out[k] = num(b[k], { min: 0, max: 50000, name: k });
    else if (['bedrooms', 'max_adults', 'max_children', 'extra_beds'].includes(k)) out[k] = int(b[k], { min: 0, max: 20, name: k });
    else if (['smoking', 'balcony'].includes(k)) out[k] = bool(b[k]) ? 1 : 0;
    else out[k] = str(b[k], { max: 120, name: k });
  }
  if (b.accessible !== undefined) out.accessible = bool(b.accessible) ? 1 : 0;
  if (b.accessibility_features !== undefined) out.accessibility_features = (b.accessibility_features || []).map((x) => str(x, { max: 80 }));
  if (b.rate_plan_codes !== undefined) out.rate_plan_codes = b.rate_plan_codes === null ? null : b.rate_plan_codes.map((x) => str(x, { max: 20 }));
  for (const k of ['description', 'warranty_notes']) if (b[k] !== undefined) out[k] = str(b[k], { max: 2000 });
  for (const k of ['last_refurbished_on', 'commissioned_on', 'decommissioned_on']) if (b[k] !== undefined) out[k] = date(b[k], { name: k });
  if (b.sort !== undefined) out.sort = int(b.sort, { min: 0, max: 100000 });
  return out;
}

export default function roomRoutes(r, { db, upload, uploads }) {
  r.get('/room-types', perm('rooms.view'), (req, res) => res.json(listRoomTypes(db, propertyOf(db, req))));
  r.post('/room-types', perm('rooms.manage'), (req, res) =>
    res.status(201).json(saveRoomType(db, req.user, propertyOf(db, req), typeInput(req.body || {}))),
  );
  r.put('/room-types/:id', perm('rooms.manage'), (req, res) => {
    const t = scopedRow(db, req.user, 'room_types', int(req.params.id, { min: 1 }), 'Room type');
    res.json(saveRoomType(db, req.user, t.property_id, typeInput(req.body || {}), t.id));
  });

  // Rooms with live status; filters for the room list and floor view.
  r.get('/rooms', perm('rooms.view'), (req, res) => {
    const pid = propertyOf(db, req);
    const out = roomsWithStatus(db, pid);
    let rooms = out.rooms;
    if (req.query.type) rooms = rooms.filter((x) => String(x.room_type_id) === String(req.query.type));
    if (req.query.floor) rooms = rooms.filter((x) => String(x.floor_level) === String(req.query.floor));
    if (req.query.building) rooms = rooms.filter((x) => String(x.building_id) === String(req.query.building));
    if (req.query.code) rooms = rooms.filter((x) => x.code === req.query.code);
    if (req.query.q) rooms = rooms.filter((x) => x.number.includes(String(req.query.q)));
    res.json({ ...out, rooms });
  });

  r.get('/rooms/:id', perm('rooms.view'), (req, res) => {
    const room = scopedRow(db, req.user, 'rooms', int(req.params.id, { min: 1 }), 'Room');
    const prop = db.get('SELECT business_date, currency FROM properties WHERE id = ?', room.property_id);
    const status = roomsWithStatus(db, room.property_id).rooms.find((x) => x.id === room.id);
    const from = addDays(prop.business_date, -365);
    const stats = db.get(
      `SELECT COUNT(*) AS occupied_nights FROM reservation_nights n JOIN room_nights x ON x.reservation_id = n.reservation_id AND x.night = n.night
       JOIN reservations r ON r.id = n.reservation_id
       WHERE x.room_id = ? AND n.night >= ? AND n.night < ? AND r.status IN ('in_house','checked_out','closed')`,
      room.id,
      from,
      prop.business_date,
    );
    const available = db.value(
      `SELECT COUNT(*) FROM (WITH RECURSIVE d(n) AS (SELECT ? UNION ALL SELECT date(n, '+1 day') FROM d WHERE date(n, '+1 day') < ?) SELECT n FROM d)
       WHERE n >= ?`,
      from,
      prop.business_date,
      room.commissioned_on,
    );
    let revenue = null;
    if (can(req.user, 'dashboard.financial'))
      revenue = db.value(
        `SELECT COALESCE(SUM(fp.net_minor), 0) FROM folio_postings fp JOIN room_nights x ON x.reservation_id = fp.reservation_id
         AND x.night = fp.business_date WHERE x.room_id = ? AND fp.department = 'rooms' AND fp.business_date >= ?`,
        room.id,
        from,
      );
    res.json({
      room: effectiveRoom(db, room.id),
      status,
      images: db.all('SELECT * FROM room_images WHERE room_id = ? OR (room_id IS NULL AND room_type_id = ?) ORDER BY room_id IS NULL, sort, id', room.id, room.room_type_id),
      assets: db.all('SELECT * FROM room_assets WHERE room_id = ? ORDER BY category, name', room.id),
      blocks: db.all('SELECT b.*, u.name AS created_by_name FROM room_blocks b LEFT JOIN users u ON u.id = b.created_by WHERE b.room_id = ? ORDER BY b.start_date DESC LIMIT 50', room.id),
      statusLog: db.all('SELECT l.*, u.name AS user_name FROM room_status_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.room_id = ? ORDER BY l.id DESC LIMIT 50', room.id),
      upcoming: db.all(
        `SELECT r.id, r.conf_no, r.status, r.arrival, r.departure, g.first_name || ' ' || g.last_name AS guest, MIN(x.night) AS from_night, date(MAX(x.night), '+1 day') AS out_date
         FROM room_nights x JOIN reservations r ON r.id = x.reservation_id JOIN guests g ON g.id = r.guest_id
         WHERE x.room_id = ? AND x.night >= ? GROUP BY r.id ORDER BY from_night LIMIT 10`,
        room.id,
        prop.business_date,
      ),
      stats: {
        period: { from, to: addDays(prop.business_date, -1) },
        occupied_nights: stats.occupied_nights,
        available_nights: available,
        occupancy_pct: available ? Math.round((stats.occupied_nights / available) * 1000) / 10 : null,
        room_revenue_minor: revenue,
        adr_minor: revenue != null && stats.occupied_nights ? Math.round(revenue / stats.occupied_nights) : null,
        currency: prop.currency,
      },
    });
  });

  r.post('/rooms', perm('rooms.manage'), (req, res) =>
    res.status(201).json(saveRoom(db, req.user, propertyOf(db, req), roomInput(req.body || {}))),
  );
  r.put('/rooms/:id', perm('rooms.manage'), (req, res) => {
    const room = scopedRow(db, req.user, 'rooms', int(req.params.id, { min: 1 }), 'Room');
    res.json(saveRoom(db, req.user, room.property_id, roomInput(req.body || {}), room.id));
  });
  r.put('/rooms/:id/amenities', perm('rooms.manage'), (req, res) => {
    const room = scopedRow(db, req.user, 'rooms', int(req.params.id, { min: 1 }), 'Room');
    res.json(
      setAmenityOverride(db, req.user, room, {
        amenity: str(req.body?.amenity, { required: true, max: 40, name: 'Amenity' }),
        mode: oneOf(req.body?.mode, ['add', 'remove', 'inherit'], { required: true, name: 'Mode' }),
        reason: str(req.body?.reason, { max: 300 }),
      }),
    );
  });

  r.post('/rooms/:id/blocks', perm('rooms.block'), (req, res) => {
    const room = scopedRow(db, req.user, 'rooms', int(req.params.id, { min: 1 }), 'Room');
    res.status(201).json(
      createBlock(db, req.user, room.property_id, {
        roomId: room.id,
        kind: oneOf(req.body?.kind, ['ooo', 'oos'], { required: true, name: 'Kind' }),
        startDate: date(req.body?.startDate, { required: true, name: 'Start date' }),
        endDate: date(req.body?.endDate, { required: true, name: 'End date' }),
        reason: str(req.body?.reason, { required: true, max: 300, name: 'Reason' }),
      }),
    );
  });
  r.post('/blocks/:id/release', perm('rooms.block'), (req, res) => {
    const b = scopedRow(db, req.user, 'room_blocks', int(req.params.id, { min: 1 }), 'Block');
    res.json(releaseBlock(db, req.user, b.property_id, b.id));
  });

  // Room photos (JPEG/PNG/WebP), stored outside the web root and served to signed-in users.
  const images = upload('room-images', { maxMb: 8, exts: ['.jpg', '.jpeg', '.png', '.webp'] });
  r.post('/rooms/:id/images', perm('rooms.manage'), images.single('file'), (req, res) => {
    const room = scopedRow(db, req.user, 'rooms', int(req.params.id, { min: 1 }), 'Room');
    if (!req.file) fail(400, 'Choose an image');
    const forType = bool(req.body?.forType);
    const id = db.insert('room_images', {
      property_id: room.property_id,
      room_id: forType ? null : room.id,
      room_type_id: forType ? room.room_type_id : null,
      file: path.basename(req.file.filename),
      caption: str(req.body?.caption, { max: 200 }),
    });
    audit(db, req.user, 'room.image_added', { entity: 'room', entityId: room.id, propertyId: room.property_id });
    res.status(201).json(db.get('SELECT * FROM room_images WHERE id = ?', id));
  });
  r.get('/files/room-images/:file', (req, res) => {
    const img = db.get('SELECT * FROM room_images WHERE file = ?', path.basename(req.params.file));
    if (!img) notFound('Image');
    assertProperty(db, req.user, img.property_id);
    const file = path.join(uploads, 'room-images', img.file);
    if (!fs.existsSync(file)) notFound('Image');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file);
  });

}
