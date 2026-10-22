// Recognising devices: each browser or installed app gets a long-lived random cookie. It is used
// to warn people about sign-ins from a new device and to flag one phone checking in two people.
import crypto from 'node:crypto';
import { addCookie, cookieOptions, parseCookies, sha256 } from '../auth.js';
import { fullName, getSettings, hrUserIds, notifyUsers } from '../core.js';
import * as D from '../lib/dates.js';

const COOKIE = 'hrms_device';
const FIVE_YEARS_S = 5 * 365 * 86400;

// Gives every browser a device cookie and sets req.device to its hash (the raw id is never stored).
export function deviceMiddleware() {
  return (req, res, next) => {
    let id = parseCookies(req.headers.cookie)[COOKIE];
    if (!/^[a-f0-9]{32}$/.test(id || '')) {
      id = crypto.randomBytes(16).toString('hex');
      addCookie(res, `${COOKIE}=${id}; ${cookieOptions(req)}; Max-Age=${FIVE_YEARS_S}`);
    }
    req.device = sha256(id).slice(0, 32);
    next();
  };
}

// "Chrome on Android", "Safari on iPhone" and so on, from the browser's User-Agent.
export function deviceLabel(ua = '') {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'A browser';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  return os ? `${browser} on ${os}` : browser;
}

// Records that this user signed in on this device. Returns true when it's a device they haven't
// used before and they have used others (their very first device isn't news).
export function rememberDevice(db, req, userId) {
  const now = new Date().toISOString();
  const label = deviceLabel(req.get?.('user-agent') || req.headers['user-agent']);
  const known = db.get(
    'SELECT 1 FROM user_devices WHERE user_id = ? AND device = ?',
    userId,
    req.device,
  );
  if (known) {
    db.run(
      'UPDATE user_devices SET last_seen = ?, label = ? WHERE user_id = ? AND device = ?',
      now,
      label,
      userId,
      req.device,
    );
    return false;
  }
  const others = db.value('SELECT COUNT(*) FROM user_devices WHERE user_id = ?', userId);
  db.insert('user_devices', {
    user_id: userId,
    device: req.device,
    label,
    first_seen: now,
    last_seen: now,
  });
  return others > 0;
}

// Tells someone their account was just signed in to from a device it hasn't used before.
export function alertNewDevice(db, req, userId) {
  const s = getSettings(db);
  const when = new Intl.DateTimeFormat('en-IN', {
    timeZone: s.timezone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date());
  const label = deviceLabel(req.get?.('user-agent') || req.headers['user-agent']);
  notifyUsers(
    db,
    [userId],
    `New sign-in to your account: ${label}, ${when}. Not you? Change your password and tell HR.`,
    null,
  );
}

// Company-local date (YYYY-MM-DD) of an ISO timestamp.
const localDate = (iso, timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

// The UTC range covering one company-local calendar day.
function dayRange(date, timezone) {
  return [D.zonedIso(date, '00:00', timezone), D.zonedIso(D.addDays(date, 1), '00:00', timezone)];
}

// After a check-in: if this device already checked in someone else today, tell HR (once per
// person per device per day). Returns the other people's names.
export function flagSharedDevice(db, req, employeeId, date) {
  if (!req.device) return [];
  const [from, to] = dayRange(date, getSettings(db).timezone);
  const others = db.all(
    `SELECT DISTINCT e.id, e.first_name, e.last_name FROM location_log l JOIN employees e ON e.id = l.employee_id
     WHERE l.device = ? AND l.event = 'check-in' AND l.at >= ? AND l.at < ? AND l.employee_id != ?`,
    req.device,
    from,
    to,
    employeeId,
  );
  if (!others.length) return [];
  // Only on this person's first check-in from this device today, so resuming after lunch is quiet.
  const mine = db.value(
    `SELECT COUNT(*) FROM location_log WHERE device = ? AND event = 'check-in' AND at >= ? AND at < ? AND employee_id = ?`,
    req.device,
    from,
    to,
    employeeId,
  );
  const names = others.map(fullName);
  if (mine <= 1) {
    const me = db.get('SELECT first_name, last_name FROM employees WHERE id = ?', employeeId);
    notifyUsers(
      db,
      hrUserIds(db),
      `Shared device: ${fullName(me)} checked in from the same ${deviceLabel(req.get?.('user-agent') || req.headers['user-agent'])} as ${names.join(', ')} today.`,
      '/attendance?tab=locations',
    );
  }
  return names;
}

// For the location log: marks each check-in made from a device that checked in more than one
// person that day, with the other people's names. Looks at the whole log, not just these rows.
export function markSharedDevices(db, rows, timezone) {
  const checkIns = rows.filter((r) => r.device && r.event === 'check-in');
  if (!checkIns.length) return rows.map((r) => ({ ...r, shared: false, sharedWith: [] }));
  const devices = [...new Set(checkIns.map((r) => r.device))];
  const days = checkIns.map((r) => localDate(r.at, timezone)).sort();
  const all = db.all(
    `SELECT l.device, l.employee_id, l.at, e.first_name, e.last_name FROM location_log l
     JOIN employees e ON e.id = l.employee_id
     WHERE l.event = 'check-in' AND l.device IN (${devices.map(() => '?').join(',')}) AND l.at >= ? AND l.at < ?`,
    ...devices,
    D.zonedIso(days[0], '00:00', timezone),
    D.zonedIso(D.addDays(days[days.length - 1], 1), '00:00', timezone),
  );
  // "device|date" -> Map of employee id -> name
  const people = new Map();
  for (const r of all) {
    const k = `${r.device}|${localDate(r.at, timezone)}`;
    if (!people.has(k)) people.set(k, new Map());
    people.get(k).set(r.employee_id, fullName(r));
  }
  return rows.map((r) => {
    const who =
      r.device && r.event === 'check-in'
        ? people.get(`${r.device}|${localDate(r.at, timezone)}`)
        : null;
    const others = who ? [...who].filter(([eid]) => eid !== r.employee_id).map(([, n]) => n) : [];
    return { ...r, shared: others.length > 0, sharedWith: others };
  });
}
