// Empty start: one organisation and an administrator. The password comes from
// ADMIN_PASSWORD, or a random one is printed once; the user must change it at first sign-in.
import crypto from 'node:crypto';
import { createOrganization } from '../modules/properties/service.js';
import { hashPassword } from '../modules/auth/service.js';

export function seedEmpty(db, { adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com', orgName = process.env.ORG_NAME || 'My Hotel Group' } = {}) {
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const orgId = createOrganization(db, { name: orgName, reportingCurrency: process.env.REPORTING_CURRENCY || 'INR' });
  db.insert('users', {
    org_id: orgId,
    email: adminEmail.toLowerCase(),
    name: 'Administrator',
    role: 'admin',
    all_properties: 1,
    password_hash: hashPassword(password),
    must_change_password: 1,
  });
  if (!process.env.ADMIN_PASSWORD) console.log(`\n  First administrator: ${adminEmail} / ${password}\n  (change it after signing in)\n`);
  return orgId;
}
