// Exhibitors: application and review, booth allocation, the setup checklist, team badges and
// lead capture. Everything here is scoped to one exhibitor company inside one event.
import { isUniqueViolation, json } from '../db.js';
import {
  addDays,
  audit,
  email as vEmail,
  eventSettings,
  fail,
  nowIso,
  num,
  oneOf,
  phone as vPhone,
  str,
  strList,
  touchGuide,
  url as vUrl,
  ymdIn,
} from '../core.js';
import { findOrCreateUser } from '../auth.js';
import { issuePass, passFromQr, revokePass } from './passes.js';
import { createOrder, orderView } from './payments.js';
import { mail } from './mail.js';

// ---------- application ----------
// Reads the application form. Company and contact are needed before it can be submitted.
export function readApplication(body, { strict }) {
  const links = (Array.isArray(body.catalogueLinks) ? body.catalogueLinks : [])
    .slice(0, 5)
    .map((l) => ({
      label: str(l?.label, { max: 80, name: 'Catalogue label' }) || 'Catalogue',
      url: vUrl(l?.url, { name: 'Catalogue link' }),
    }))
    .filter((l) => l.url);
  const pref = body.spacePref || {};
  return {
    company_name: str(body.companyName, { max: 160, required: true, name: 'Company name' }),
    industry: str(body.industry, { max: 120, required: strict, name: 'Industry' }),
    description: str(body.description, { max: 2000, name: 'Description' }),
    website: vUrl(body.website, { name: 'Website' }),
    catalogue_links: JSON.stringify(links),
    categories: JSON.stringify(strList(body.categories, { max: 8, itemMax: 40 })),
    contact_name: str(body.contactName, { max: 120, required: strict, name: 'Contact name' }),
    contact_email: vEmail(body.contactEmail, { required: strict, name: 'Contact email' }),
    contact_phone: vPhone(body.contactPhone, { required: strict, name: 'Contact phone' }),
    billing_name: str(body.billingName, { max: 160, required: strict, name: 'Billing name' }),
    gstin: str(body.gstin, { max: 15, name: 'GSTIN' })?.toUpperCase() ?? null,
    billing_address: str(body.billingAddress, { max: 400, required: strict, name: 'Billing address' }),
    space_pref: JSON.stringify({
      hall: str(pref.hall, { max: 40 }),
      kind: oneOf(pref.kind, ['shell', 'raw', 'premium']) || 'shell',
      sizeSqm: num(pref.sizeSqm, { min: 6, max: 500, int: true, name: 'Stand size' }) || 9,
      notes: str(pref.notes, { max: 300 }),
    }),
  };
}
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Creates an application owned by the signed-in user, who becomes the exhibitor admin.
export function createApplication(ctx, req, event, body) {
  const { db } = ctx;
  const submit = Boolean(body.submit);
  const row = readApplication(body, { strict: submit });
  if (row.gstin && !GSTIN_RE.test(row.gstin)) fail(400, 'GSTIN is not valid');
  return db.tx(() => {
    const id = db.insert('exhibitors', {
      event_id: event.id,
      ...row,
      status: submit ? 'submitted' : 'draft',
      badge_quota: eventSettings(event).defaultBadgeQuota,
      created_by: req.user.id,
      submitted_at: submit ? nowIso() : null,
      updated_at: nowIso(),
      created_at: nowIso(),
    });
    db.insert('memberships', {
      user_id: req.user.id,
      organiser_id: event.organiser_id,
      event_id: event.id,
      role: 'exhibitor_admin',
      exhibitor_id: id,
      created_at: nowIso(),
    });
    audit(db, req, submit ? 'exhibitor.submit' : 'exhibitor.draft', {
      event,
      entity: 'exhibitor',
      entityId: id,
      detail: { company: row.company_name },
    });
    return db.get('SELECT * FROM exhibitors WHERE id = ?', id);
  });
}

// Saves changes. The application itself can only change while it is a draft or was sent back;
// the public profile (description, links, categories) stays editable after approval.
export function updateApplication(ctx, req, event, exhibitor, body) {
  const { db } = ctx;
  const editable = ['draft', 'changes_requested'].includes(exhibitor.status);
  const submit = Boolean(body.submit);
  if (!editable && submit) fail(409, 'This application has already been submitted');
  const row = readApplication({ ...body, companyName: body.companyName ?? exhibitor.company_name }, { strict: submit });
  if (row.gstin && !GSTIN_RE.test(row.gstin)) fail(400, 'GSTIN is not valid');
  const patch = editable
    ? { ...row }
    : {
        description: row.description,
        website: row.website,
        catalogue_links: row.catalogue_links,
        categories: row.categories,
      };
  if (body.profilePublished != null && exhibitor.status === 'approved')
    patch.profile_published = body.profilePublished ? 1 : 0;
  if (submit) {
    patch.status = 'submitted';
    patch.submitted_at = nowIso();
  }
  db.update('exhibitors', exhibitor.id, { ...patch, updated_at: nowIso() });
  if (submit)
    audit(db, req, 'exhibitor.submit', { event, entity: 'exhibitor', entityId: exhibitor.id });
  refreshChecklist(db, event, exhibitor.id);
  if (exhibitor.status === 'approved') touchGuide(db, event.id);
  return db.get('SELECT * FROM exhibitors WHERE id = ?', exhibitor.id);
}

// ---------- review ----------
const CHECKLIST = [
  { key: 'profile', title: 'Complete company profile', kind: 'profile', dueDays: -21, help: 'Add a description and product categories, then publish your profile.' },
  { key: 'stand_drawing', title: 'Submit stand drawing', kind: 'upload', dueDays: -14, help: 'Upload the stand design (PDF or image) for the organiser to review.' },
  { key: 'power_wifi', title: 'Order power & Wi-Fi', kind: 'order', dueDays: -10, help: 'Order electrical connections and internet for your stand.' },
  { key: 'team', title: 'Add booth staff', kind: 'team', dueDays: -7, help: 'Add the people who need exhibitor badges.' },
  { key: 'balance', title: 'Pay stand balance', kind: 'order', dueDays: -7, help: 'Clear the balance on your stand order.' },
  { key: 'safety', title: 'Confirm fire & safety declaration', kind: 'confirm', dueDays: -3, help: 'Confirm your stand follows the venue fire and safety rules.' },
];

// Organiser decision on an application: approve, reject or send back with a note.
export function reviewApplication(ctx, req, event, exhibitor, decision, note) {
  const { db } = ctx;
  if (exhibitor.status !== 'submitted') fail(409, 'This application is not waiting for review');
  if (decision !== 'approve' && !note) fail(400, 'Add a note so the exhibitor knows why');
  const status = { approve: 'approved', reject: 'rejected', changes: 'changes_requested' }[decision];
  if (!status) fail(400, 'Unknown decision');
  return db.tx(() => {
    db.update('exhibitors', exhibitor.id, {
      status,
      review_note: note || null,
      decided_by: req.user.id,
      decided_at: nowIso(),
      updated_at: nowIso(),
    });
    if (status === 'approved') {
      CHECKLIST.forEach((c, i) =>
        db.run(
          `INSERT OR IGNORE INTO checklist_items (event_id, exhibitor_id, key, title, help, kind, due_on, sort, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          event.id,
          exhibitor.id,
          c.key,
          c.title,
          c.help,
          c.kind,
          addDays(event.starts_on, c.dueDays),
          i,
          nowIso(),
        ),
      );
      // The applicant gets the first exhibitor badge.
      const owner = db.get('SELECT * FROM users WHERE id = ?', exhibitor.created_by);
      if (owner)
        addTeamMember(ctx, req, event, { ...exhibitor, status }, {
          name: exhibitor.contact_name || owner.name || owner.email,
          email: owner.email,
          role: 'exhibitor_admin',
        }, { quiet: true });
    }
    audit(db, req, `exhibitor.${decision}`, {
      event,
      entity: 'exhibitor',
      entityId: exhibitor.id,
      detail: { company: exhibitor.company_name, note: note || undefined },
    });
    const fresh = db.get('SELECT * FROM exhibitors WHERE id = ?', exhibitor.id);
    mail.exhibitorStatus(
      ctx,
      event,
      fresh,
      { approved: 'Application approved', rejected: 'Application not approved', changes_requested: 'Changes requested' }[status],
      status === 'approved'
        ? 'Your application is approved. The organiser will allocate your booth next; you can start on your setup checklist now.'
        : `Note from the organiser: ${note}`,
    );
    return fresh;
  });
}

// ---------- booth allocation ----------
// Lapses holds that passed their expiry so the booths become available again.
export function lapseHolds(db, eventId) {
  db.run(
    "UPDATE booth_assignments SET status = 'released', released_at = ? WHERE event_id = ? AND status = 'held' AND hold_expires_at < ?",
    nowIso(),
    eventId,
    nowIso(),
  );
}

// Gives a booth to an exhibitor, as a hold (pending the deposit) or confirmed outright.
// The partial UNIQUE index on booth_assignments(booth_id) guarantees one live assignment per
// booth: if two requests race, the second insert fails and is reported as a conflict.
export function allocateBooth(ctx, req, event, exhibitor, booth, { confirm = false } = {}) {
  const { db } = ctx;
  if (exhibitor.status !== 'approved') fail(409, 'Approve the application before allocating a booth');
  if (booth.event_id !== event.id) fail(404, 'Booth not found');
  if (booth.blocked) fail(409, `Booth ${booth.code} is blocked`);
  const settings = eventSettings(event);
  return db.tx(() => {
    lapseHolds(db, event.id);
    let id;
    try {
      id = db.insert('booth_assignments', {
        event_id: event.id,
        booth_id: booth.id,
        exhibitor_id: exhibitor.id,
        status: confirm ? 'confirmed' : 'held',
        hold_expires_at: confirm ? null : new Date(Date.now() + settings.boothHoldHours * 3600000).toISOString(),
        created_by: req.user.id,
        confirmed_at: confirm ? nowIso() : null,
        created_at: nowIso(),
      });
    } catch (e) {
      if (isUniqueViolation(e)) fail(409, `Booth ${booth.code} is already assigned`, 'booth_taken');
      throw e;
    }
    const zone = db.get('SELECT name FROM zones WHERE id = ?', booth.zone_id);
    createOrder(ctx, event, {
      kind: 'booth',
      exhibitorId: exhibitor.id,
      boothAssignmentId: id,
      dueOn: addDays(event.starts_on, -7),
      items: [
        {
          description: `Stand package: booth ${booth.code}, ${zone.name} (${booth.size_sqm} sq m, ${booth.kind})`,
          qty: 1,
          unitPaise: booth.price_paise,
        },
      ],
    });
    audit(db, req, confirm ? 'booth.confirm' : 'booth.hold', {
      event,
      entity: 'booth',
      entityId: booth.id,
      detail: { booth: booth.code, company: exhibitor.company_name },
    });
    touchGuide(db, event.id);
    mail.exhibitorStatus(
      ctx,
      event,
      exhibitor,
      confirm ? 'Booth confirmed' : 'Booth held for you',
      confirm
        ? `Booth ${booth.code} in ${zone.name} is confirmed for you.`
        : `Booth ${booth.code} in ${zone.name} is held for you for ${settings.boothHoldHours} hours. Pay the deposit in your workspace to confirm it.`,
    );
    return db.get('SELECT * FROM booth_assignments WHERE id = ?', id);
  });
}

// Confirms a held booth. Confirming twice is harmless; a released hold cannot be confirmed.
export function confirmAssignment(ctx, req, event, assignmentId, { quiet = false } = {}) {
  const { db } = ctx;
  return db.tx(() => {
    const a = db.get('SELECT * FROM booth_assignments WHERE id = ? AND event_id = ?', assignmentId, event.id);
    if (!a) fail(404, 'Assignment not found');
    if (a.status === 'confirmed') return a;
    if (a.status !== 'held') {
      if (quiet) return a;
      fail(409, 'This hold has lapsed or was released');
    }
    db.update('booth_assignments', a.id, { status: 'confirmed', confirmed_at: nowIso(), hold_expires_at: null });
    audit(db, req, 'booth.confirm', { event, entity: 'booth', entityId: a.booth_id });
    touchGuide(db, event.id);
    return db.get('SELECT * FROM booth_assignments WHERE id = ?', a.id);
  });
}

export function releaseAssignment(ctx, req, event, assignmentId) {
  const { db } = ctx;
  const a = db.get(
    "SELECT * FROM booth_assignments WHERE id = ? AND event_id = ? AND status IN ('held','confirmed')",
    assignmentId,
    event.id,
  );
  if (!a) fail(404, 'Assignment not found');
  db.tx(() => {
    db.update('booth_assignments', a.id, { status: 'released', released_at: nowIso() });
    db.run(
      "UPDATE orders SET status = 'cancelled', updated_at = ? WHERE booth_assignment_id = ? AND status = 'open'",
      nowIso(),
      a.id,
    );
    audit(db, req, 'booth.release', { event, entity: 'booth', entityId: a.booth_id });
    touchGuide(db, event.id);
  });
}

// ---------- checklist ----------
// Completes the items that follow from other records (profile, team, orders).
export function refreshChecklist(db, event, exhibitorId) {
  const ex = db.get('SELECT * FROM exhibitors WHERE id = ?', exhibitorId);
  if (!ex || ex.status !== 'approved') return;
  const set = (key, done) =>
    db.run(
      "UPDATE checklist_items SET status = ?, updated_at = ? WHERE exhibitor_id = ? AND key = ? AND status IN ('todo','complete') AND status != ?",
      done ? 'complete' : 'todo',
      nowIso(),
      exhibitorId,
      key,
      done ? 'complete' : 'todo',
    );
  set('profile', Boolean(ex.description && json(ex.categories, []).length && ex.profile_published));
  set(
    'team',
    db.value("SELECT COUNT(*) FROM team_badges WHERE exhibitor_id = ? AND status != 'revoked' AND role = 'booth_staff'", exhibitorId) > 0,
  );
  set(
    'power_wifi',
    db.value("SELECT COUNT(*) FROM orders WHERE exhibitor_id = ? AND kind = 'service' AND status != 'cancelled'", exhibitorId) > 0,
  );
  const booth = db.get(
    "SELECT status FROM orders WHERE exhibitor_id = ? AND kind = 'booth' AND status != 'cancelled' ORDER BY id DESC LIMIT 1",
    exhibitorId,
  );
  set('balance', booth?.status === 'paid');
}

// ---------- team badges ----------
// Adds a person to the exhibitor's team: a badge (pass), plus app access for their role.
// The badge quota is checked inside the transaction so two admins cannot both take the last one.
export function addTeamMember(ctx, req, event, exhibitor, body, { quiet = false } = {}) {
  const { db } = ctx;
  if (exhibitor.status !== 'approved') fail(409, 'Team badges open once the application is approved');
  const name = str(body.name, { max: 120, required: true, name: 'Name' });
  const email = vEmail(body.email, { required: true });
  const role = oneOf(body.role, ['exhibitor_admin', 'booth_staff']) || 'booth_staff';
  const cls = db.get(
    "SELECT * FROM pass_classes WHERE event_id = ? AND kind = 'exhibitor' AND active = 1 ORDER BY id LIMIT 1",
    event.id,
  );
  if (!cls) fail(409, 'This event has no exhibitor pass type set up');
  return db.tx(() => {
    const used = db.value(
      "SELECT COUNT(*) FROM team_badges WHERE exhibitor_id = ? AND status != 'revoked'",
      exhibitor.id,
    );
    if (used >= exhibitor.badge_quota)
      fail(409, `All ${exhibitor.badge_quota} badges are in use. Ask the organiser for a larger quota.`, 'quota_full');
    const userId = findOrCreateUser(db, { email, name });
    let id;
    try {
      id = db.insert('team_badges', {
        event_id: event.id,
        exhibitor_id: exhibitor.id,
        user_id: userId,
        name,
        email,
        role,
        status: userId === req?.user?.id || quiet ? 'accepted' : 'invited',
        invited_at: nowIso(),
        accepted_at: userId === req?.user?.id || quiet ? nowIso() : null,
      });
    } catch (e) {
      if (isUniqueViolation(e)) fail(409, `${email} already has a badge on this team`);
      throw e;
    }
    db.run(
      `INSERT INTO memberships (user_id, organiser_id, event_id, role, exhibitor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, COALESCE(event_id, 0), role, COALESCE(exhibitor_id, 0)) DO UPDATE SET status = 'active'`,
      userId,
      event.organiser_id,
      event.id,
      role,
      exhibitor.id,
      nowIso(),
    );
    issuePass(db, { event, passClassId: cls.id, teamBadgeId: id, name, company: exhibitor.company_name });
    refreshChecklist(db, event, exhibitor.id);
    const badge = db.get('SELECT * FROM team_badges WHERE id = ?', id);
    if (!quiet) {
      audit(db, req, 'team.add', { event, entity: 'exhibitor', entityId: exhibitor.id, detail: { email, role } });
      mail.teamInvite(ctx, event, exhibitor, badge);
    }
    return badge;
  });
}

export function revokeTeamMember(ctx, req, event, exhibitor, badgeId) {
  const { db } = ctx;
  const badge = db.get('SELECT * FROM team_badges WHERE id = ? AND exhibitor_id = ?', badgeId, exhibitor.id);
  if (!badge || badge.status === 'revoked') fail(404, 'Team member not found');
  if (badge.user_id === req.user.id) fail(409, 'You cannot remove your own badge');
  db.tx(() => {
    db.update('team_badges', badge.id, { status: 'revoked', revoked_at: nowIso() });
    const pass = db.get('SELECT id FROM passes WHERE team_badge_id = ?', badge.id);
    if (pass) revokePass(db, pass.id, 'Removed from exhibitor team');
    db.run(
      "UPDATE memberships SET status = 'revoked' WHERE user_id = ? AND exhibitor_id = ?",
      badge.user_id,
      exhibitor.id,
    );
    refreshChecklist(db, event, exhibitor.id);
    audit(db, req, 'team.revoke', { event, entity: 'exhibitor', entityId: exhibitor.id, detail: { email: badge.email } });
  });
}

// ---------- leads ----------
// Captures a lead from a scanned visitor badge. Only badges whose pass type allows lead
// scanning can be captured, and only the fields in the event's disclosed lead-sharing policy
// are copied. A second scan of the same visitor by the same exhibitor updates the one lead.
export function captureLead(ctx, req, event, exhibitor, { qr, notes, tags, rating }) {
  const { db } = ctx;
  const pass = passFromQr(db, event, qr);
  if (!pass) fail(404, 'That is not a badge for this event', 'unknown_badge');
  if (pass.status !== 'active') fail(409, 'That badge has been cancelled', 'badge_cancelled');
  const cls = db.get('SELECT * FROM pass_classes WHERE id = ?', pass.pass_class_id);
  const reg = pass.registration_id
    ? db.get('SELECT * FROM registrations WHERE id = ?', pass.registration_id)
    : null;
  if (!cls.lead_scannable || !reg)
    fail(403, `${cls.name} badges cannot be scanned for leads`, 'not_scannable');
  if (reg.lead_opt_out)
    fail(403, 'This visitor has chosen not to share contact details with exhibitors', 'opted_out');
  const policy = eventSettings(event).leadSharing.fields;
  const all = { name: reg.name, company: reg.company, jobTitle: reg.job_title, email: reg.email, phone: reg.phone };
  const shared = Object.fromEntries(policy.filter((f) => all[f]).map((f) => [f, all[f]]));
  const cleanTags = strList(tags, { max: 10, itemMax: 40 });
  const cleanNotes = str(notes, { max: 1000, name: 'Notes' });
  const cleanRating = oneOf(rating, ['hot', 'warm', 'cold']);
  return db.tx(() => {
    const existing = db.get(
      'SELECT * FROM leads WHERE event_id = ? AND exhibitor_id = ? AND pass_id = ?',
      event.id,
      exhibitor.id,
      pass.id,
    );
    if (existing) {
      const merged = [...new Set([...json(existing.tags, []), ...cleanTags])];
      db.update('leads', existing.id, {
        scan_count: existing.scan_count + 1,
        last_scanned_at: nowIso(),
        tags: JSON.stringify(merged),
        notes: cleanNotes ?? existing.notes,
        rating: cleanRating ?? existing.rating,
        updated_at: nowIso(),
      });
      return { lead: db.get('SELECT * FROM leads WHERE id = ?', existing.id), duplicate: true };
    }
    const id = db.insert('leads', {
      event_id: event.id,
      exhibitor_id: exhibitor.id,
      pass_id: pass.id,
      captured_by: req.user.id,
      shared: JSON.stringify(shared),
      rating: cleanRating,
      tags: JSON.stringify(cleanTags),
      notes: cleanNotes,
      first_scanned_at: nowIso(),
      last_scanned_at: nowIso(),
      updated_at: nowIso(),
    });
    return { lead: db.get('SELECT * FROM leads WHERE id = ?', id), duplicate: false };
  });
}

export function leadView(db, lead) {
  return {
    id: lead.id,
    ...json(lead.shared, {}),
    rating: lead.rating,
    tags: json(lead.tags, []),
    notes: lead.notes,
    scanCount: lead.scan_count,
    capturedBy: lead.captured_by ? db.value('SELECT name FROM users WHERE id = ?', lead.captured_by) : null,
    firstScannedAt: lead.first_scanned_at,
    lastScannedAt: lead.last_scanned_at,
  };
}

// ---------- workspace ----------
// The exhibitor home: booth, the next required action, checklist, order totals, team and leads.
export function workspace(ctx, event, exhibitor, role) {
  const { db } = ctx;
  lapseHolds(db, event.id);
  refreshChecklist(db, event, exhibitor.id);
  const ex = db.get('SELECT * FROM exhibitors WHERE id = ?', exhibitor.id);
  const assignment = db.get(
    `SELECT a.*, b.code, b.size_sqm, b.kind, z.name AS zone_name FROM booth_assignments a
     JOIN booths b ON b.id = a.booth_id JOIN zones z ON z.id = b.zone_id
     WHERE a.exhibitor_id = ? AND a.status IN ('held','confirmed') ORDER BY a.id DESC LIMIT 1`,
    ex.id,
  );
  const orders = db
    .all("SELECT * FROM orders WHERE exhibitor_id = ? AND status != 'cancelled' ORDER BY id", ex.id)
    .map((o) => orderView(db, o));
  const checklist = db
    .all('SELECT * FROM checklist_items WHERE exhibitor_id = ? ORDER BY sort', ex.id)
    .map((c) => ({
      id: c.id,
      key: c.key,
      title: c.title,
      help: c.help,
      kind: c.kind,
      dueOn: c.due_on,
      status: c.status,
      note: c.note,
      hasUpload: Boolean(c.upload_id),
    }));
  const team = db
    .all("SELECT * FROM team_badges WHERE exhibitor_id = ? AND status != 'revoked' ORDER BY id", ex.id)
    .map((t) => ({ id: t.id, name: t.name, email: t.email, role: t.role, status: t.status }));
  const today = ymdIn(event.timezone);
  const open = checklist.filter((c) => c.status === 'todo' || c.status === 'changes_requested');
  const balance = orders.reduce((a, o) => a + o.balancePaise, 0);
  let next;
  if (ex.status === 'draft') next = { key: 'submit', text: 'Finish and submit your application' };
  else if (ex.status === 'changes_requested') next = { key: 'submit', text: 'Make the requested changes and resubmit' };
  else if (ex.status === 'submitted') next = { key: 'wait', text: 'The organiser is reviewing your application' };
  else if (ex.status === 'rejected') next = { key: 'none', text: 'This application was not approved' };
  else if (!assignment) next = { key: 'wait', text: 'The organiser is allocating your booth' };
  else if (assignment.status === 'held') next = { key: 'pay', text: 'Pay the deposit to confirm your booth' };
  else if (open.length) next = { key: `checklist:${open[0].key}`, text: open[0].title };
  else if (balance > 0) next = { key: 'pay', text: 'Pay the balance on your order' };
  else next = { key: 'none', text: 'You are all set for the show' };
  return {
    role,
    exhibitor: exhibitorView(ex),
    booth: assignment
      ? {
          assignmentId: assignment.id,
          code: assignment.code,
          hall: assignment.zone_name,
          sizeSqm: assignment.size_sqm,
          kind: assignment.kind,
          status: assignment.status,
          holdExpiresAt: assignment.hold_expires_at,
        }
      : null,
    next,
    checklist: checklist.map((c) => ({ ...c, overdue: c.status !== 'complete' && c.dueOn && c.dueOn < today })),
    orders,
    totals: {
      totalPaise: orders.reduce((a, o) => a + o.totalPaise, 0),
      paidPaise: orders.reduce((a, o) => a + o.paidPaise, 0),
      balancePaise: balance,
    },
    team,
    badgeQuota: ex.badge_quota,
    leadCount: db.value('SELECT COUNT(*) FROM leads WHERE exhibitor_id = ?', ex.id),
    recentLeads: db
      .all('SELECT * FROM leads WHERE exhibitor_id = ? ORDER BY last_scanned_at DESC LIMIT 5', ex.id)
      .map((l) => leadView(db, l)),
    interestTags: eventSettings(event).interestTags,
    event: { id: event.id, slug: event.slug, name: event.name, startsOn: event.starts_on, endsOn: event.ends_on },
  };
}

export function exhibitorView(ex) {
  return {
    id: ex.id,
    companyName: ex.company_name,
    industry: ex.industry,
    description: ex.description,
    website: ex.website,
    catalogueLinks: json(ex.catalogue_links, []),
    categories: json(ex.categories, []),
    contactName: ex.contact_name,
    contactEmail: ex.contact_email,
    contactPhone: ex.contact_phone,
    billingName: ex.billing_name,
    gstin: ex.gstin,
    billingAddress: ex.billing_address,
    spacePref: json(ex.space_pref, {}),
    status: ex.status,
    reviewNote: ex.review_note,
    badgeQuota: ex.badge_quota,
    profilePublished: Boolean(ex.profile_published),
    submittedAt: ex.submitted_at,
  };
}
