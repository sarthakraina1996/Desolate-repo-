// Fingerprint check-in: set it up on your own phone, confirm it's you, and HR's list and reset.
import { audit, fail, fullName, getSettings, id, notifyUsers, requireHR } from '../core.js';
import { geofencePolicy } from '../services/geofence.js';
import {
  authenticationOptions,
  finishAuthentication,
  finishRegistration,
  passkeysOf,
  registrationOptions,
} from '../services/passkeys.js';

export default function passkeyRoutes(r, { db }) {
  // Is fingerprint check-in required, and is it set up for me (and on which device)?
  r.get('/passkeys/me', (req, res) => {
    const key = passkeysOf(db, req.user.id)[0] || null;
    res.json({
      required:
        Boolean(geofencePolicy(getSettings(db)).verifyCheckIn) && Boolean(req.user.employeeId),
      registered: Boolean(key),
      label: key?.label || null,
      createdAt: key?.created_at || null,
      lastUsedAt: key?.last_used_at || null,
    });
  });

  // Starts setting up fingerprint check-in on this device.
  r.post('/passkeys/register/options', async (req, res) => {
    res.json(await registrationOptions(db, req, getSettings(db).companyName));
  });

  // Finishes the setup; the person is told, so a setup they didn't make doesn't go unnoticed.
  r.post('/passkeys/register', async (req, res) => {
    const { label } = await finishRegistration(db, req, req.body);
    notifyUsers(
      db,
      [req.user.id],
      `Fingerprint check-in was set up on ${label}. If this wasn't you, tell HR straight away.`,
      null,
    );
    audit(db, req.user, 'passkey.register', 'user', req.user.id, { device: label });
    res.json({ ok: true, label });
  });

  // Starts a "confirm it's you" fingerprint prompt.
  r.post('/passkeys/verify/options', async (req, res) => {
    res.json(await authenticationOptions(db, req));
  });

  // Checks the fingerprint; the next check-in in the following two minutes is allowed.
  r.post('/passkeys/verify', async (req, res) => {
    await finishAuthentication(db, req, req.body);
    res.json({ ok: true });
  });

  // HR: who has set up fingerprint check-in, on which device, and when it was last used.
  r.get('/passkeys', (req, res) => {
    requireHR(req);
    const items = db
      .all(
        `SELECT u.id AS user_id, u.email, e.id AS employee_id, e.first_name, e.last_name, e.code,
                e.designation, e.photo IS NOT NULL AS has_photo,
                p.label, p.created_at, p.last_used_at
         FROM users u JOIN employees e ON e.id = u.employee_id
         LEFT JOIN passkeys p ON p.user_id = u.id
         WHERE u.active = 1 AND e.status != 'Exited'
         ORDER BY p.created_at IS NULL DESC, e.first_name, e.last_name`,
      )
      .map((x) => ({ ...x, name: fullName(x), registered: Boolean(x.created_at) }));
    res.json({
      required: Boolean(geofencePolicy(getSettings(db)).verifyCheckIn),
      items,
      registered: items.filter((x) => x.registered).length,
    });
  });

  // HR: removes someone's passkey so they can set it up again (new phone, or a setup they didn't make).
  r.delete('/passkeys/user/:id', (req, res) => {
    requireHR(req);
    const userId = id(req.params.id);
    const user = db.get('SELECT id, email FROM users WHERE id = ?', userId);
    if (!user) fail(404, 'Login not found');
    const removed = db.run('DELETE FROM passkeys WHERE user_id = ?', userId).changes;
    if (removed) {
      notifyUsers(
        db,
        [userId],
        'HR reset your fingerprint check-in. Set it up again on your own phone before your next check-in.',
        null,
      );
      audit(db, req.user, 'passkey.reset', 'user', userId);
    }
    res.json({ ok: true, removed });
  });
}
