// Gapless numbering per property: the counter row is read and advanced inside the caller's
// transaction, so two documents can never get the same number and no number is skipped.
export function nextNumber(db, propertyId, name, scope = '') {
  return db.value(
    `INSERT INTO sequences (property_id, name, scope, next_value) VALUES (?, ?, ?, 2)
     ON CONFLICT(property_id, name, scope) DO UPDATE SET next_value = next_value + 1
     RETURNING next_value - 1`,
    propertyId,
    name,
    scope,
  );
}

export const pad = (n, width = 6) => String(n).padStart(width, '0');
