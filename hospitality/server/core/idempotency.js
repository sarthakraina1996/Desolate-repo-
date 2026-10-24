// Idempotency-Key support for state-changing requests: a retry with the same key replays the
// stored response instead of running again. This covers network retries and offline replays.
// Critical writes (bookings, folio postings) are also deduplicated by unique keys in the
// database, which holds even if the process stops between commit and storing the response.
import crypto from 'node:crypto';

export function idempotency(db) {
  return (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key || !req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (key.length > 200)
      return res.status(400).json({ error: 'Idempotency-Key is too long', code: 'validation' });
    const hash = crypto
      .createHash('sha256')
      .update(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`)
      .digest('hex');
    const prev = db.get(
      'SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = ? AND key = ?',
      req.user.id,
      key,
    );
    if (prev) {
      if (prev.request_hash !== hash)
        return res.status(422).json({
          error: 'This Idempotency-Key was already used for a different request',
          code: 'idempotency_mismatch',
        });
      res.setHeader('Idempotent-Replay', 'true');
      return res.status(prev.status_code).json(JSON.parse(prev.response));
    }
    req.idempotencyKey = key;
    const send = res.json.bind(res);
    res.json = (body) => {
      // Server errors are not stored, so the client can retry them.
      if (res.statusCode < 500) {
        db.run(
          `INSERT OR IGNORE INTO idempotency_keys (user_id, key, method, path, request_hash, status_code, response)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          req.user.id,
          key,
          req.method,
          req.originalUrl,
          hash,
          res.statusCode,
          JSON.stringify(body ?? null),
        );
      }
      return send(body);
    };
    next();
  };
}
