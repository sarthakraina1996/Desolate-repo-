// Office geofence: sign-in and office check-in only from an office.
//
// An office is a point with a radius plus optional network addresses (the
// office's public IP, or LAN ranges when the server runs on the office
// network). Being on an office network counts as being in the office, which
// covers desktops whose browser location is rough. Administrators, people
// HR allows to work from anywhere (field staff), and anyone on approved work
// from home or leave today are exempt.
import { getSettings } from '../core.js';
import { dayStatuses } from './calendar.js';

export const GEOFENCE_MODES = ['off', 'login', 'strict'];

export function geofencePolicy(settings) {
  return { mode: 'off', exemptEmployeeIds: [], allowWfhAndLeave: true, maxAccuracyM: 1500, ...(settings.geofence || {}) };
}

const toRad = (d) => (d * Math.PI) / 180;
export function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export const fmtDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

function ipToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m || m.slice(1).some((x) => Number(x) > 255)) return null;
  return ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
}

// True if `ip` is one of the comma/space separated addresses or IPv4 CIDR
// ranges (e.g. "203.0.113.7, 192.168.1.0/24").
export function ipMatches(ip, ranges) {
  const clean = String(ip || '').replace(/^::ffff:/, '');
  for (const r of String(ranges || '').split(/[\s,]+/).filter(Boolean)) {
    if (r === clean) return true;
    const [base, bits] = r.split('/');
    if (bits === undefined) continue;
    const b = ipToInt(base);
    const c = ipToInt(clean);
    const n = Number(bits);
    if (b == null || c == null || !Number.isInteger(n) || n < 0 || n > 32) continue;
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    if ((b & mask) === (c & mask)) return true;
  }
  return false;
}

export function readCoords(v) {
  if (!v || typeof v !== 'object') return null;
  const lat = Number(v.lat);
  const lng = Number(v.lng);
  const accuracy = Number(v.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : 99999 };
}

// Why this user may skip the check today, or null. `dayOnly` exemptions
// (approved WFH or leave) last only for today.
export function exemption(db, user, settings, today) {
  const p = geofencePolicy(settings);
  if (p.mode === 'off') return { reason: 'Location check is off' };
  if (user.role === 'admin') return { reason: 'Administrator' };
  if (user.employeeId && p.exemptEmployeeIds.includes(user.employeeId)) return { reason: 'Allowed to work from anywhere' };
  if (p.allowWfhAndLeave && user.employeeId) {
    const e = db.get('SELECT * FROM employees WHERE id = ?', user.employeeId);
    const st = e && dayStatuses(db, [e], today, today, today, settings).get(e.id).get(today);
    if (st?.code === 'WFH' && st.leave) return { reason: 'Approved work from home today', dayOnly: true };
    if (st?.code === 'L') return { reason: `On ${st.leave?.name || 'leave'} today`, dayOnly: true };
  }
  return null;
}

// Decides whether the user may sign in (or check in at the office) from
// where they are. Returns { ok, method, code?, message?, site?, distance? }.
export function checkLocation(db, { user, coords, ip, today, settings = getSettings(db) }) {
  const ex = exemption(db, user, settings, today);
  if (ex) return { ok: true, method: 'exempt', exempt: ex.reason, dayBound: Boolean(ex.dayOnly) };
  const sites = db.all('SELECT * FROM office_sites WHERE active = 1');
  if (!sites.length) return { ok: true, method: 'exempt', exempt: 'No office locations set up' };
  const net = sites.find((s) => ipMatches(ip, s.ip_ranges));
  if (net) return { ok: true, method: 'network', site: net, dayBound: true };
  if (!coords) return { ok: false, code: 'location_required', message: 'Share your location to continue. Sign-in is only allowed from the office.' };
  let best = null;
  for (const s of sites) {
    const d = distanceM(coords, s);
    if (!best || d < best.distance) best = { site: s, distance: d };
  }
  const distance = Math.round(best.distance);
  if (best.distance <= best.site.radius_m + Math.min(coords.accuracy, best.site.radius_m)) {
    return { ok: true, method: 'gps', site: best.site, distance, accuracy: coords.accuracy, dayBound: true };
  }
  if (coords.accuracy > geofencePolicy(settings).maxAccuracyM) {
    return { ok: false, code: 'location_imprecise', site: best.site, distance, accuracy: coords.accuracy, message: `Your location is too rough to confirm (within ${fmtDistance(coords.accuracy)}). Turn on Wi-Fi or location services and try again, or connect to the office network.` };
  }
  return { ok: false, code: 'outside_office', site: best.site, distance, accuracy: coords.accuracy, message: `You are ${fmtDistance(distance)} from the nearest office (${best.site.name}). You can only sign in from the office.` };
}

const RESULT = { gps: 'in-office', network: 'office-network', exempt: 'exempt', outside_office: 'outside', location_required: 'no-location', location_imprecise: 'imprecise' };

export function logLocation(db, { user, event, coords, ip, check }) {
  return db.insert('location_log', {
    user_id: user?.id ?? null,
    employee_id: user?.employeeId ?? null,
    at: new Date().toISOString(),
    event,
    result: RESULT[check.ok ? check.method : check.code] || 'unknown',
    site_id: check.site?.id ?? null,
    site_name: check.site?.name ?? null,
    distance_m: check.distance ?? null,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    accuracy_m: coords ? coords.accuracy : null,
    ip: String(ip || '').replace(/^::ffff:/, '').slice(0, 64) || null,
    note: check.exempt || null,
  });
}
