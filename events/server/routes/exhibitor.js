// The exhibitor workspace. Every route loads the exhibitor through exhibitorAccess, which
// enforces the company boundary on the server.
import { Router } from 'express';
import path from 'node:path';
import { audit, exhibitorAccess, fail, id, inr, nowIso, num, oneOf, requireUser, sendCsv, str, strList } from '../core.js';
import {
  addTeamMember,
  captureLead,
  createApplication,
  exhibitorView,
  leadView,
  refreshChecklist,
  revokeTeamMember,
  updateApplication,
  workspace,
} from '../services/exhibitors.js';
import { createOrder, orderView, startCheckout } from '../services/payments.js';

export default function exhibitorRoutes(ctx) {
  const { db } = ctx;
  const r = Router();
  const eventOf = (exhibitor) => db.get('SELECT * FROM events WHERE id = ?', exhibitor.event_id);
  // Loads exhibitor + event and checks the permission in one step.
  const scope = (req, perm) => {
    const exhibitor = exhibitorAccess(db, req, id(req.params.id), perm);
    const event = eventOf(exhibitor);
    req.event = event;
    return { exhibitor, event };
  };

  // Start an application. The signed-in user becomes the company's exhibitor admin.
  r.post('/events/:slug/exhibitor-applications', (req, res) => {
    requireUser(req);
    const event = db.get("SELECT * FROM events WHERE slug = ? AND status = 'published'", req.params.slug);
    if (!event) fail(404, 'Event not found');
    res.status(201).json(exhibitorView(createApplication(ctx, req, event, req.body)));
  });

  r.get('/exhibitor/:id', (req, res) => {
    const { exhibitor, event } = scope(req, 'x.view');
    res.json(workspace(ctx, event, exhibitor, req.exhibitorRole));
  });

  r.put('/exhibitor/:id', (req, res) => {
    const { exhibitor, event } = scope(req, 'x.manage');
    res.json(exhibitorView(updateApplication(ctx, req, event, exhibitor, req.body)));
  });

  // ---------- team badges ----------
  r.post('/exhibitor/:id/team', (req, res) => {
    const { exhibitor, event } = scope(req, 'x.team');
    const b = addTeamMember(ctx, req, event, exhibitor, req.body);
    res.status(201).json({ id: b.id, name: b.name, email: b.email, role: b.role, status: b.status });
  });
  r.delete('/exhibitor/:id/team/:badgeId', (req, res) => {
    const { exhibitor, event } = scope(req, 'x.team');
    revokeTeamMember(ctx, req, event, exhibitor, id(req.params.badgeId));
    res.json({ ok: true });
  });

  // ---------- checklist ----------
  const item = (req, exhibitor) => {
    const row = db.get('SELECT * FROM checklist_items WHERE id = ? AND exhibitor_id = ?', id(req.params.itemId), exhibitor.id);
    if (!row) fail(404, 'Checklist item not found');
    return row;
  };
  // Upload for a checklist item (stand drawing). The file goes to private storage and the
  // item waits for the organiser's review.
  r.post(
    '/exhibitor/:id/checklist/:itemId/upload',
    ctx.upload('exhibitor', { maxMb: 15, exts: ['.pdf', '.png', '.jpg', '.jpeg'] }).single('file'),
    (req, res) => {
      const { exhibitor, event } = scope(req, 'x.manage');
      const row = item(req, exhibitor);
      if (row.kind !== 'upload') fail(400, 'This item does not take a file');
      if (!req.file) fail(400, 'Choose a PDF, PNG or JPG file');
      const uploadId = db.insert('uploads', {
        event_id: event.id,
        exhibitor_id: exhibitor.id,
        kind: row.key,
        filename: req.file.originalname.slice(0, 200),
        stored_name: req.file.filename,
        mime: req.file.mimetype,
        size: req.file.size,
        uploaded_by: req.user.id,
        created_at: nowIso(),
      });
      db.update('checklist_items', row.id, { status: 'awaiting_review', upload_id: uploadId, note: null, updated_at: nowIso() });
      res.json({ ok: true });
    },
  );
  r.post('/exhibitor/:id/checklist/:itemId/confirm', (req, res) => {
    const { exhibitor } = scope(req, 'x.manage');
    const row = item(req, exhibitor);
    if (row.kind !== 'confirm') fail(400, 'This item completes on its own');
    db.update('checklist_items', row.id, { status: 'complete', updated_at: nowIso() });
    res.json({ ok: true });
  });
  // Files are only ever served to the company that owns them (and organiser staff, elsewhere).
  r.get('/exhibitor/:id/checklist/:itemId/file', (req, res) => {
    const { exhibitor } = scope(req, 'x.view');
    const row = item(req, exhibitor);
    const up = row.upload_id ? db.get('SELECT * FROM uploads WHERE id = ? AND exhibitor_id = ?', row.upload_id, exhibitor.id) : null;
    if (!up) fail(404, 'No file uploaded');
    res.download(path.join(ctx.uploadsDir, 'exhibitor', path.basename(up.stored_name)), up.filename);
  });

  // ---------- orders and services ----------
  r.get('/exhibitor/:id/services', (req, res) => {
    const { event } = scope(req, 'x.view');
    res.json(
      db
        .all('SELECT * FROM service_items WHERE event_id = ? AND active = 1 ORDER BY category, name', event.id)
        .map((s) => ({ code: s.code, category: s.category, name: s.name, unit: s.unit, pricePaise: s.price_paise })),
    );
  });
  r.post('/exhibitor/:id/service-orders', (req, res) => {
    const { exhibitor, event } = scope(req, 'x.orders');
    if (exhibitor.status !== 'approved') fail(409, 'Services open once the application is approved');
    const items = (Array.isArray(req.body.items) ? req.body.items : [])
      .map((i) => {
        const s = db.get('SELECT * FROM service_items WHERE event_id = ? AND code = ? AND active = 1', event.id, String(i?.code || ''));
        const qty = num(i?.qty, { min: 1, max: 100, int: true, name: 'Quantity' });
        return s && qty ? { description: `${s.name} (${s.unit})`, qty, unitPaise: s.price_paise } : null;
      })
      .filter(Boolean);
    if (!items.length) fail(400, 'Choose at least one service');
    const order = createOrder(ctx, event, { kind: 'service', exhibitorId: exhibitor.id, items });
    refreshChecklist(db, event, exhibitor.id);
    audit(db, req, 'order.service', {
      event,
      entity: 'order',
      entityId: order.id,
      detail: { order: order.number, total: inr(order.total_paise) },
    });
    res.status(201).json(orderView(db, order));
  });
  // Hosted checkout for an order's balance, or a chosen part of it (the deposit).
  r.post('/exhibitor/:id/orders/:orderId/checkout', async (req, res) => {
    const { exhibitor, event } = scope(req, 'x.orders');
    const order = db.get('SELECT * FROM orders WHERE id = ? AND exhibitor_id = ?', id(req.params.orderId), exhibitor.id);
    if (!order) fail(404, 'Order not found');
    res.json(
      await startCheckout(ctx, event, order, {
        amountPaise: num(req.body.amountPaise, { min: 100, int: true, name: 'Amount' }) || undefined,
        customer: { name: exhibitor.contact_name, email: exhibitor.contact_email, phone: exhibitor.contact_phone },
        returnUrl: `${ctx.baseUrl}/x/${exhibitor.id}/booth`,
      }),
    );
  });

  // ---------- leads ----------
  r.post('/exhibitor/:id/leads/scan', (req, res) => {
    const { exhibitor, event } = scope(req, 'x.leads.capture');
    if (exhibitor.status !== 'approved') fail(409, 'Lead capture opens once the application is approved');
    const out = captureLead(ctx, req, event, exhibitor, req.body);
    res.status(out.duplicate ? 200 : 201).json({ lead: leadView(db, out.lead), duplicate: out.duplicate });
  });
  const leadRows = (req, exhibitor) => {
    const q = str(req.query.q, { max: 80 })?.toLowerCase();
    const rating = oneOf(req.query.rating, ['hot', 'warm', 'cold']);
    const tag = str(req.query.tag, { max: 40 });
    return db
      .all('SELECT * FROM leads WHERE exhibitor_id = ? ORDER BY last_scanned_at DESC', exhibitor.id)
      .map((l) => leadView(db, l))
      .filter(
        (l) =>
          (!rating || l.rating === rating) &&
          (!tag || l.tags.includes(tag)) &&
          (!q || [l.name, l.company, l.jobTitle, l.email, l.notes].some((v) => v && v.toLowerCase().includes(q))),
      );
  };
  r.get('/exhibitor/:id/leads', (req, res) => {
    const { exhibitor } = scope(req, 'x.leads.view');
    res.json(leadRows(req, exhibitor));
  });
  r.put('/exhibitor/:id/leads/:leadId', (req, res) => {
    const { exhibitor } = scope(req, 'x.leads.capture');
    const lead = db.get('SELECT * FROM leads WHERE id = ? AND exhibitor_id = ?', id(req.params.leadId), exhibitor.id);
    if (!lead) fail(404, 'Lead not found');
    db.update('leads', lead.id, {
      notes: str(req.body.notes, { max: 1000, name: 'Notes' }),
      tags: JSON.stringify(strList(req.body.tags, { max: 10, itemMax: 40 })),
      rating: oneOf(req.body.rating, ['hot', 'warm', 'cold']),
      updated_at: nowIso(),
    });
    res.json(leadView(db, db.get('SELECT * FROM leads WHERE id = ?', lead.id)));
  });
  // Export of this company's leads only. Every export is logged with who took it.
  r.get('/exhibitor/:id/leads/export.csv', (req, res) => {
    const { exhibitor, event } = scope(req, 'x.leads.export');
    const rows = leadRows(req, exhibitor);
    db.insert('lead_exports', {
      event_id: event.id,
      exhibitor_id: exhibitor.id,
      user_id: req.user.id,
      row_count: rows.length,
      ip: req.ip,
      created_at: nowIso(),
    });
    audit(db, req, 'leads.export', {
      event,
      entity: 'exhibitor',
      entityId: exhibitor.id,
      detail: { company: exhibitor.company_name, rows: rows.length },
    });
    sendCsv(
      res,
      `leads-${exhibitor.company_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`,
      [
        'Name',
        'Company',
        'Job title',
        'Email',
        'Phone',
        'Rating',
        'Interest tags',
        'Notes',
        'Scans',
        'First scanned',
        'Last scanned',
        'Captured by',
      ],
      rows.map((l) => [
        l.name,
        l.company,
        l.jobTitle,
        l.email,
        l.phone,
        l.rating,
        l.tags.join('; '),
        l.notes,
        l.scanCount,
        l.firstScannedAt,
        l.lastScannedAt,
        l.capturedBy,
      ]),
    );
  });

  return r;
}
