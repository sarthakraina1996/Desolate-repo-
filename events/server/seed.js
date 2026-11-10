// Demo data: FutureWorks Expo, a fictional trade show with a conference track, run by the
// fictional organiser BrainADZ Live. Dates are relative to today so the show is always on its
// second day. Every person, company and number here is made up.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addDays, nowIso, randomRef, randomToken, ymdIn } from './core.js';
import { hashPassword } from './auth.js';
import { issuePass, qrFor } from './services/passes.js';
import { createOrder, applyPaymentEvent } from './services/payments.js';
import { createPrintJob, recordScan } from './services/scans.js';
import { addTeamMember, captureLead, refreshChecklist, reviewApplication, allocateBooth } from './services/exhibitors.js';

export const DEMO_PASSWORD = 'Events@2026';

// Small deterministic generator so the demo looks the same on every fresh start.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const FIRST = [
  'Aditi',
  'Rohan',
  'Sneha',
  'Vivek',
  'Pooja',
  'Arjun',
  'Neha',
  'Sameer',
  'Divya',
  'Manish',
  'Kavya',
  'Nikhil',
  'Ishita',
  'Rahul',
  'Tanvi',
  'Harsh',
  'Meenal',
  'Gaurav',
  'Shreya',
  'Abhinav',
  'Lakshmi',
  'Yusuf',
  'Simran',
  'Deepak',
  'Anjali',
  'Faisal',
  'Ritika',
  'Sanjay',
  'Naina',
  'Tushar',
];
const LAST = [
  'Kulkarni',
  'Nair',
  'Chatterjee',
  'Reddy',
  'Saxena',
  'Fernandes',
  'Gill',
  'Pillai',
  'Bose',
  'Trivedi',
  'Menon',
  'Ahuja',
  'Shetty',
  'Dutta',
  'Bhatt',
  'Qureshi',
  'Rao',
  'Sinha',
  'Khanna',
  'Joshi',
];
const COMPANIES = [
  'Meridian Retail',
  'Rivermoor Hospitality',
  'Kaveri Foods',
  'Sahyadri Logistics',
  'Blue Lotus Hotels',
  'Chinar Pharmacies',
  'Malabar Mart',
  'Aravalli Properties',
  'Konkan Cafés',
  'Vindhya Bank',
  'Deccan Cinemas',
  'Sundarban Travel',
  'Nilgiri Fashion',
  'Thar Motors',
  'Ganga Healthcare',
];
const TITLES = [
  'Store Operations Manager',
  'Head of Facilities',
  'IT Manager',
  'Procurement Lead',
  'Marketing Manager',
  'Workplace Experience Lead',
  'Regional Manager',
  'Director, Customer Experience',
  'Project Engineer',
  'Founder',
];
const INTERESTS = ['Digital signage', 'Self-service kiosks', 'Smart workplace', 'Retail analytics', 'Event technology'];

export function seedDemo(ctx) {
  const { db } = ctx;
  const rand = rng(20261110);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const req = { user: null, ip: null };
  const today = ymdIn('Asia/Kolkata');
  const day1 = addDays(today, -1);
  const day3 = addDays(today, 1);
  const password = hashPassword(DEMO_PASSWORD);
  const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

  db.tx(() => {
    // ---------- organiser, event and people ----------
    const org = db.insert('organisers', {
      name: 'BrainADZ Live',
      slug: 'brainadz-live',
      invoice_profile: JSON.stringify({
        legalName: 'BrainADZ Live Private Limited',
        gstin: '07AABCB1234M1Z5',
        stateCode: '07',
        address: 'Okhla Industrial Estate, Phase II, New Delhi 110020',
        sac: '998596',
        invoicePrefix: 'BAL/26-27',
        notes: 'Demo invoice profile. Replace with the profile agreed with finance.',
      }),
      created_at: nowIso(),
    });
    const user = (email, name, withPassword = true) =>
      db.insert('users', { email, name, password_hash: withPassword ? password : null, created_at: nowIso() });
    const eid = db.insert('events', {
      organiser_id: org,
      slug: 'futureworks-expo',
      name: 'FutureWorks Expo',
      edition: String(today.slice(0, 4)),
      kind: 'combined',
      tagline: "India's show for workplace, retail and visitor experience technology",
      description:
        'Three days of digital signage, self-service, smart workplace and retail technology, with the Future of Work Summit conference track running alongside the trade halls.',
      venue_name: 'Meridian Convention Centre',
      venue_address: 'Sector 25, Dwarka, New Delhi 110061',
      city: 'New Delhi',
      timezone: 'Asia/Kolkata',
      starts_on: day1,
      ends_on: day3,
      open_time: '10:00',
      close_time: '18:00',
      status: 'published',
      accessibility:
        'Step-free access through Gates 1 and 2. Accessible toilets in both halls. Wheelchairs can be borrowed at the Hall A help desk. The Conference Theatre has a hearing loop and reserved front-row seating. Assistance dogs are welcome. Quiet room beside the first-aid post in Hall A.',
      faqs: JSON.stringify([
        { q: 'Is entry free?', a: 'Trade visitor passes are free. The Future of Work Summit needs a paid conference delegate pass.' },
        { q: 'Do I need to print my pass?', a: 'No. Show the QR in the app or in your browser. Badges are printed at the gate.' },
        { q: 'Can I come back in after leaving?', a: 'Yes. Visitor and delegate passes allow re-entry on any show day.' },
        { q: 'What ID should I carry?', a: 'A government photo ID. Entry is for trade and business visitors aged 18 and over.' },
        {
          q: 'Who sees my contact details?',
          a: 'Only exhibitors whose staff you let scan your badge, and only the fields listed in the privacy notice.',
        },
      ]),
      settings: JSON.stringify({
        refPrefix: 'FW',
        orderPrefix: 'FW26',
        interestTags: ['Digital signage', 'Self-service kiosks', 'Smart workplace', 'Retail analytics', 'Pricing sent', 'Demo booked'],
      }),
      qr_secret: randomToken(32),
      published_at: nowIso(),
      updated_at: nowIso(),
      created_at: nowIso(),
    });
    const event = () => db.get('SELECT * FROM events WHERE id = ?', eid);

    // ---------- halls, gates, amenities, displays ----------
    const zone = (code, name, kind, plan, restricted = 0, sort = 0) =>
      db.insert('zones', { event_id: eid, code, name, kind, restricted, plan: JSON.stringify(plan), sort });
    const hallA = zone('HALL-A', 'Hall A', 'hall', { cols: 10, rows: 7 }, 0, 1);
    const hallB = zone('HALL-B', 'Hall B', 'hall', { cols: 10, rows: 7 }, 0, 2);
    const conf = zone('CONF', 'Conference Theatre', 'conference', {}, 0, 3);
    const vip = zone('VIP', 'VIP Lounge', 'restricted', {}, 1, 4);
    const gate = (code, name, zoneId, x, y) => db.insert('gates', { event_id: eid, zone_id: zoneId, code, name, x, y });
    const g1 = gate('G1', 'Gate 1', hallA, 5, 7);
    const g2 = gate('G2', 'Gate 2', hallB, 5, 7);
    const g3 = gate('G3', 'Gate 3', conf, null, null);
    const amenity = (zoneId, kind, label, x, y, accessible = 0) =>
      db.insert('amenities', { event_id: eid, zone_id: zoneId, kind, label, x, y, accessible });
    amenity(hallA, 'help', 'Help desk', 1, 6.5);
    amenity(hallA, 'toilets', 'Toilets (accessible)', 9.3, 0.4, 1);
    amenity(hallA, 'first_aid', 'First aid and quiet room', 0.7, 0.4, 1);
    amenity(hallA, 'cafe', 'Café', 9.3, 6.5);
    amenity(hallB, 'stage', 'Expo Stage', 5, 5.6);
    amenity(hallB, 'toilets', 'Toilets (accessible)', 9.3, 0.4, 1);
    amenity(hallB, 'charging', 'Charging point', 0.7, 6.5);
    amenity(hallB, 'prayer', 'Prayer room', 0.7, 0.4);
    db.insert('kiosks', { event_id: eid, zone_id: hallA, code: 'K1', name: 'Hall A entrance display', mode: 'both', x: 5, y: 6.4 });
    db.insert('kiosks', { event_id: eid, zone_id: hallB, code: 'K2', name: 'Hall B stage display', mode: 'both', x: 5, y: 3 });

    // ---------- booths ----------
    const booths = {};
    const booth = (code, zoneId, x, y, kind = 'shell', blocked = 0, note = null) => {
      booths[code] = db.insert('booths', {
        event_id: eid,
        zone_id: zoneId,
        code,
        kind,
        size_sqm: kind === 'premium' ? 18 : 9,
        price_paise: kind === 'premium' ? 9600000 : 4800000,
        x,
        y,
        w: 2,
        h: 1,
        blocked,
        note,
      });
    };
    let n = 0;
    for (const y of [1, 2, 4, 5])
      for (const x of [1, 3, 5, 7]) {
        n++;
        const code = `A${String(n).padStart(2, '0')}`;
        booth(
          code,
          hallA,
          x,
          y,
          n <= 4 ? 'premium' : 'shell',
          code === 'A16' ? 1 : 0,
          code === 'A16' ? 'Kept clear for the fire exit' : null,
        );
      }
    n = 0;
    for (const y of [1, 2, 4])
      for (const x of [1, 3, 5, 7]) {
        n++;
        booth(`B${String(n).padStart(2, '0')}`, hallB, x, y);
      }

    // ---------- pass types, form questions, services, printers ----------
    const cls = (code, name, kind, mode, zones, extra = {}) =>
      db.insert('pass_classes', {
        event_id: eid,
        code,
        name,
        kind,
        mode,
        zone_ids: JSON.stringify(zones),
        valid_from: day1,
        valid_to: day3,
        sort: extra.sort ?? 0,
        ...extra,
      });
    const cVisitor = cls('VISITOR', 'Trade visitor', 'visitor', 'free', [hallA, hallB], {
      description: 'Free entry to both trade halls on all three days.',
      sort: 1,
    });
    const cDelegate = cls('DELEGATE', 'Conference delegate', 'delegate', 'paid', [hallA, hallB, conf], {
      description: 'Trade halls plus every Future of Work Summit session.',
      price_paise: 250000,
      sort: 2,
    });
    const cVip = cls('VIP', 'VIP guest', 'vip', 'invited', [hallA, hallB, conf, vip], {
      description: 'By invitation. Includes the VIP Lounge.',
      lead_scannable: 0,
      sort: 3,
    });
    const cMedia = cls('MEDIA', 'Media', 'media', 'approval', [hallA, hallB, conf], {
      description: 'For accredited press. Reviewed by the organiser.',
      lead_scannable: 0,
      sort: 4,
    });
    const cDay1 = cls('DAY1', 'Day 1 visitor', 'visitor', 'free', [hallA, hallB], { valid_to: day1, active: 0, sort: 5 });
    const cExhibitor = cls('EXHIBITOR', 'Exhibitor', 'exhibitor', 'internal', [hallA, hallB], { lead_scannable: 0, sort: 6 });
    cls('STAFF', 'Event staff', 'staff', 'internal', [hallA, hallB, conf, vip], { lead_scannable: 0, sort: 7 });
    db.insert('form_fields', {
      event_id: eid,
      key: 'interest',
      label: 'What are you most interested in?',
      type: 'select',
      options: JSON.stringify(INTERESTS),
      required: 1,
      sort: 1,
    });
    db.insert('form_fields', { event_id: eid, key: 'firstVisit', label: 'This is my first FutureWorks Expo', type: 'checkbox', sort: 2 });
    for (const [code, category, name, unit, price] of [
      ['POWER-5A', 'Power', 'Power connection, 5 A single phase', 'per stand', 350000],
      ['POWER-15A', 'Power', 'Power connection, 15 A single phase', 'per stand', 750000],
      ['WIFI-10', 'Internet', 'Dedicated Wi-Fi, 10 Mbps', 'per stand', 600000],
      ['TABLE', 'Furniture', 'Extra table', 'each', 90000],
      ['CHAIR', 'Furniture', 'Extra chair', 'each', 35000],
      ['SPOT', 'Lighting', 'Spotlight', 'each', 65000],
      ['CLEAN', 'Services', 'Daily stand cleaning', 'per day', 120000],
    ])
      db.insert('service_items', { event_id: eid, code, category, name, unit, price_paise: price });
    db.insert('printers', { event_id: eid, gate_id: g1, name: 'Gate 1 badge printer', model: 'Demo label printer' });
    db.insert('printers', {
      event_id: eid,
      gate_id: g2,
      name: 'Gate 2 badge printer',
      model: 'Demo label printer',
      status: 'error',
      last_error: 'Out of labels',
    });
    db.insert('printers', { event_id: eid, gate_id: g3, name: 'Conference desk printer', model: 'Demo label printer' });
    db.insert('printers', { event_id: eid, name: 'Spare printer (help desk)', model: 'Demo label printer', is_spare: 1 });

    // ---------- staff accounts ----------
    const member = (userId, role, extra = {}) =>
      db.insert('memberships', { user_id: userId, organiser_id: org, event_id: eid, role, created_at: nowIso(), ...extra });
    const admin = user('organiser@futureworks.example', 'Ananya Rao');
    member(admin, 'organiser_admin', { event_id: null });
    member(user('ops@futureworks.example', 'Kabir Sethi'), 'organiser_staff');
    member(user('finance@futureworks.example', 'Meera Iyer'), 'finance');
    const supervisor = user('supervisor@futureworks.example', 'Joseph Mathew');
    member(supervisor, 'gate_supervisor');
    const gateUsers = [
      [user('gate1@futureworks.example', 'Imran Shaikh'), g1],
      [user('gate2@futureworks.example', 'Sunita Verma'), g2],
      [user('gate3@futureworks.example', 'Prakash Naidu'), g3],
    ];
    for (const [u, g] of gateUsers) member(u, 'gate_staff', { gate_id: g });
    req.user = { id: admin, name: 'Ananya Rao', email: 'organiser@futureworks.example' };

    // ---------- exhibitors ----------
    const exhibitor = (name, industry, categories, description, status, owner) =>
      db.insert('exhibitors', {
        event_id: eid,
        company_name: name,
        industry,
        description,
        categories: JSON.stringify(categories),
        website: `https://www.${name.toLowerCase().replace(/[^a-z]/g, '')}.example`,
        catalogue_links: JSON.stringify([
          { label: 'Product catalogue', url: `https://www.${name.toLowerCase().replace(/[^a-z]/g, '')}.example/catalogue` },
        ]),
        contact_name: owner.name,
        contact_email: owner.email,
        contact_phone: '+91 98100 00000',
        billing_name: `${name} Private Limited`,
        gstin: '07AAACN0000A1Z5',
        billing_address: 'Business Park, New Delhi 110001',
        space_pref: JSON.stringify({ hall: 'Hall A', kind: 'shell', sizeSqm: 9 }),
        status,
        badge_quota: 4,
        profile_published: 1,
        created_by: owner.id,
        submitted_at: nowIso(),
        updated_at: nowIso(),
        created_at: nowIso(),
      });
    const company = (
      name,
      industry,
      categories,
      description,
      ownerEmail,
      ownerName,
      { boothCode, confirm = true, status = 'approved', note } = {},
    ) => {
      const owner = { id: user(ownerEmail, ownerName), name: ownerName, email: ownerEmail };
      const xid = exhibitor(name, industry, categories, description, 'submitted', owner);
      member(owner.id, 'exhibitor_admin', { exhibitor_id: xid });
      const row = () => db.get('SELECT * FROM exhibitors WHERE id = ?', xid);
      if (status === 'approved') {
        reviewApplication(ctx, req, event(), row(), 'approve');
        if (boothCode) allocateBooth(ctx, req, event(), row(), db.get('SELECT * FROM booths WHERE id = ?', booths[boothCode]), { confirm });
      } else if (status === 'changes_requested') reviewApplication(ctx, req, event(), row(), 'changes', note);
      return xid;
    };
    const nova = company(
      'Nova Displays',
      'Digital signage',
      ['Digital signage', 'Video walls'],
      'Indoor and outdoor LED displays, video walls and the software that runs them, built and serviced in India.',
      'ritu@novadisplays.example',
      'Ritu Bansal',
      { boothCode: 'A12', confirm: false },
    );
    const lumen = company(
      'Lumen Workspace',
      'Smart workplace',
      ['Smart workplace', 'Room booking'],
      'Desk and room booking, visitor management and occupancy sensors for hybrid offices.',
      'farah@lumenworkspace.example',
      'Farah Siddiqui',
      { boothCode: 'B03', confirm: false },
    );
    company(
      'Kestrel Kiosks',
      'Self-service',
      ['Self-service kiosks', 'Payments'],
      'Ordering, check-in and ticketing kiosks for restaurants, hotels and transport.',
      'hello@kestrelkiosks.example',
      'Dhruv Malhotra',
      { boothCode: 'A10' },
    );
    company(
      'Tarang Audio Visual',
      'Audio visual',
      ['Event technology', 'Digital signage'],
      'Sound, projection and stage systems for venues and corporate campuses.',
      'hello@tarangav.example',
      'Leela Krishnan',
      { boothCode: 'A11' },
    );
    company(
      'Indus Retail Analytics',
      'Retail analytics',
      ['Retail analytics', 'Footfall counting'],
      'Footfall counters and store dashboards that show what shoppers do before they buy.',
      'hello@indusretail.example',
      'Omar Farooqui',
      { boothCode: 'A13' },
    );
    company(
      'Quillon Access Control',
      'Security',
      ['Smart workplace', 'Access control'],
      'Turnstiles, door controllers and mobile credentials for offices and venues.',
      'hello@quillon.example',
      'Rhea Kapoor',
      { boothCode: 'A01' },
    );
    company(
      'Saffron Print Labs',
      'Print',
      ['Event technology', 'Badges and lanyards'],
      'On-demand badge, lanyard and signage printing for events.',
      'hello@saffronprint.example',
      'Nitin Agarwal',
      { boothCode: 'B01' },
    );
    company(
      'Peepal Furniture Systems',
      'Furniture',
      ['Smart workplace', 'Furniture'],
      'Modular desks, pods and sit-stand furniture made in Pune.',
      'hello@peepalfurniture.example',
      'Shalini Deshpande',
      { boothCode: 'B02' },
    );
    company(
      'Marigold Event Tech',
      'Event technology',
      ['Event technology'],
      'Registration counters, turnstile hire and on-site crew for exhibitions.',
      'hello@marigoldevents.example',
      'Varun Chawla',
      { boothCode: 'B05', confirm: false },
    );
    company(
      'Orbit Wayfinding',
      'Wayfinding',
      ['Digital signage', 'Wayfinding'],
      'Interactive maps and wayfinding totems for malls, airports and hospitals.',
      'hello@orbitwayfinding.example',
      'Zoya Hussain',
      { status: 'submitted' },
    );
    company(
      'Zephyr Lighting',
      'Lighting',
      ['Smart workplace', 'Lighting'],
      'Human-centric office lighting with daylight sensors.',
      'hello@zephyrlighting.example',
      'Mohit Arora',
      { status: 'submitted' },
    );
    company(
      'Banyan Cloud POS',
      'Retail software',
      ['Retail analytics', 'Payments'],
      'Billing and inventory for multi-store retailers.',
      'hello@banyanpos.example',
      'Preeti Nambiar',
      { status: 'changes_requested', note: 'Please add your GST registration certificate number and confirm the stand size you need.' },
    );

    // Pays an order through the same state machine a gateway callback uses.
    let payN = 0;
    const pay = (order, amountPaise, { status = 'captured', method = 'upi', minutes = 600 } = {}) => {
      const intent = `pi_demo_${++payN}`;
      db.insert('payments', {
        event_id: eid,
        order_id: order.id,
        provider: 'local',
        intent_id: intent,
        amount_paise: amountPaise,
        status: 'created',
        status_at: minutesAgo(minutes + 1),
        created_at: minutesAgo(minutes + 1),
        updated_at: minutesAgo(minutes + 1),
      });
      if (status !== 'created')
        applyPaymentEvent(ctx, 'local', {
          eventId: `evt_demo_${payN}`,
          type: `payment.${status}`,
          intentId: intent,
          amountPaise,
          method,
          occurredAt: minutesAgo(minutes),
        });
    };
    const boothOrder = (xid) => db.get("SELECT * FROM orders WHERE exhibitor_id = ? AND kind = 'booth'", xid);
    // Confirmed booths were paid in full by bank transfer; Nova has paid its 50% deposit.
    for (const o of db.all(
      "SELECT o.* FROM orders o JOIN booth_assignments a ON a.id = o.booth_assignment_id WHERE o.event_id = ? AND a.status = 'confirmed'",
      eid,
    ))
      pay(o, o.total_paise, { method: 'netbanking', minutes: 60 * 24 * 12 });
    pay(boothOrder(nova), boothOrder(nova).total_paise / 2, { method: 'upi', minutes: 60 * 24 * 9 });

    // Nova Displays: second team member, services ordered, stand drawing awaiting review, leads.
    const novaRow = () => db.get('SELECT * FROM exhibitors WHERE id = ?', nova);
    addTeamMember(
      ctx,
      req,
      event(),
      novaRow(),
      { name: 'Karan Bhatia', email: 'karan@novadisplays.example', role: 'booth_staff' },
      { quiet: true },
    );
    db.run('UPDATE users SET password_hash = ? WHERE email = ?', password, 'karan@novadisplays.example');
    const service = createOrder(ctx, event(), {
      kind: 'service',
      exhibitorId: nova,
      items: [
        { description: 'Power connection, 5 A single phase (per stand)', qty: 1, unitPaise: 350000 },
        { description: 'Dedicated Wi-Fi, 10 Mbps (per stand)', qty: 1, unitPaise: 600000 },
      ],
    });
    pay(service, service.total_paise, { minutes: 60 * 24 * 5 });
    const drawing = `${crypto.randomBytes(12).toString('hex')}.pdf`;
    fs.mkdirSync(path.join(ctx.uploadsDir, 'exhibitor'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.uploadsDir, 'exhibitor', drawing),
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 74>>stream\nBT /F1 16 Tf 40 160 Td (Nova Displays - stand drawing, booth A12 (demo)) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    );
    const uploadId = db.insert('uploads', {
      event_id: eid,
      exhibitor_id: nova,
      kind: 'stand_drawing',
      filename: 'nova-stand-a12.pdf',
      stored_name: drawing,
      mime: 'application/pdf',
      size: 600,
      created_at: nowIso(),
    });
    db.run(
      "UPDATE checklist_items SET status = 'awaiting_review', upload_id = ? WHERE exhibitor_id = ? AND key = 'stand_drawing'",
      uploadId,
      nova,
    );
    db.run("UPDATE checklist_items SET status = 'complete' WHERE exhibitor_id = ? AND key = 'safety'", nova);
    refreshChecklist(db, event(), nova);

    // ---------- visitors ----------
    let seq = 0;
    const visitors = [];
    const register = (
      classId,
      {
        name,
        company,
        title,
        status = 'confirmed',
        payment = 'not_required',
        source = 'web',
        email,
        account = false,
        minutes = 60 * 24 * 6,
      } = {},
    ) => {
      seq++;
      const nm = name || `${pick(FIRST)} ${pick(LAST)}`;
      const co = company || pick(COMPANIES);
      const em = email || `${nm.toLowerCase().replace(/[^a-z]+/g, '.')}${seq}@${co.toLowerCase().replace(/[^a-z]/g, '')}.example`;
      const uid = account ? user(em, nm, false) : null;
      const id = db.insert('registrations', {
        event_id: eid,
        pass_class_id: classId,
        user_id: uid,
        ref: randomRef('FW'),
        name: nm,
        email: em,
        phone: `+91 9${String(800000000 + Math.floor(rand() * 99999999)).slice(0, 9)}`,
        company: co,
        job_title: title || pick(TITLES),
        answers: JSON.stringify({ interest: pick(INTERESTS) }),
        source,
        consent_at: minutesAgo(minutes),
        contact_verified_at: status === 'unverified' ? null : minutesAgo(minutes),
        status,
        payment_status: payment,
        updated_at: minutesAgo(minutes),
        created_at: minutesAgo(minutes),
      });
      const reg = db.get('SELECT * FROM registrations WHERE id = ?', id);
      let pass = null;
      if (status === 'confirmed' && (payment === 'not_required' || payment === 'paid'))
        pass = issuePass(db, { event: event(), passClassId: classId, registrationId: id, name: nm, company: co });
      visitors.push({ reg, pass, classId });
      return { reg, pass };
    };
    const aarav = register(cVisitor, {
      name: 'Aarav Mehta',
      company: 'Meridian Retail',
      title: 'Head of Store Experience',
      email: 'aarav.mehta@meridianretail.example',
      account: true,
    });
    for (let i = 0; i < 46; i++) register(cVisitor, { source: i % 4 === 0 ? 'android' : i % 4 === 1 ? 'ios' : 'web' });
    // Conference delegates: paid, pending and failed payments.
    const delegate = (opts, payStatus) => {
      const out = register(cDelegate, { ...opts, payment: 'pending' });
      const order = createOrder(ctx, event(), {
        kind: 'registration',
        registrationId: out.reg.id,
        items: [{ description: 'Conference delegate pass, FutureWorks Expo', qty: 1, unitPaise: 250000 }],
      });
      if (payStatus) pay(order, order.total_paise, { status: payStatus, minutes: payStatus === 'pending' ? 50 : 60 * 24 * 3 });
      const reg = db.get('SELECT * FROM registrations WHERE id = ?', out.reg.id);
      const pass = db.get('SELECT * FROM passes WHERE registration_id = ?', reg.id) || null;
      visitors[visitors.length - 1] = { reg, pass, classId: cDelegate };
      return { reg, pass };
    };
    const elena = delegate(
      {
        name: 'Elena Park',
        company: 'Rivermoor Hospitality',
        title: 'Director, Guest Technology',
        email: 'elena.park@rivermoor.example',
        account: true,
      },
      'captured',
    );
    for (let i = 0; i < 5; i++) delegate({}, 'captured');
    delegate({}, 'pending');
    delegate({}, 'failed');
    delegate({}, null);
    // Cancelled after paying: appears in finance as a refund that is due.
    const refundDue = delegate({}, 'captured');
    db.run("UPDATE registrations SET status = 'cancelled', cancelled_at = ? WHERE id = ?", nowIso(), refundDue.reg.id);
    db.run(
      "UPDATE passes SET status = 'revoked', revoked_at = ?, revoked_reason = 'Registration cancelled' WHERE id = ?",
      nowIso(),
      refundDue.pass.id,
    );
    register(cMedia, { status: 'pending_review', company: 'Retail Technology Weekly', title: 'Correspondent' });
    register(cMedia, { status: 'pending_review', company: 'Workplace India', title: 'Editor' });
    register(cMedia, { company: 'The Signage Journal', title: 'Reporter' });
    register(cMedia, { status: 'rejected', company: 'Freelance', title: 'Blogger' });
    register(cVip, { company: 'Ministry of Commerce (fictional)', title: 'Joint Secretary', source: 'invite' });
    register(cVip, { company: 'Meridian Retail', title: 'Chief Executive', source: 'invite' });
    const dayOne = [register(cDay1, {}), register(cDay1, {}), register(cDay1, {})];
    register(cVisitor, { status: 'cancelled' });
    register(cVisitor, { status: 'unverified' });
    register(cVisitor, { status: 'unverified' });
    for (const code of ['INV-FWVIP001', 'INV-FWVIP002', 'INV-FWVIP003'])
      db.insert('invites', { event_id: eid, pass_class_id: cVip, code, note: 'Demo invitation', max_uses: 1, created_at: nowIso() });

    // ---------- devices, scans, printing ----------
    const device = (userId, gateId, name, platform, { seenMinutes = 0, queued = 0 } = {}) =>
      db.get(
        'SELECT * FROM devices WHERE id = ?',
        db.insert('devices', {
          event_id: eid,
          user_id: userId,
          gate_id: gateId,
          name,
          platform,
          app_version: '1.0.0',
          key: randomToken(32),
          queued_count: queued,
          last_seen_at: minutesAgo(seenMinutes),
          last_sync_at: minutesAgo(seenMinutes),
          enrolled_at: minutesAgo(60 * 30),
        }),
      );
    const d1 = device(gateUsers[0][0], g1, 'Gate 1 phone', 'android');
    const d1b = device(supervisor, g1, 'Gate 1 second phone', 'ios');
    const d2 = device(gateUsers[1][0], g2, 'Gate 2 phone', 'ios');
    // Gate 3 lost its connection: 12 scans are still queued on the phone.
    const d3 = device(gateUsers[2][0], g3, 'Gate 3 phone', 'android', { seenMinutes: 9, queued: 12 });
    const gateRow = (gid) => db.get('SELECT * FROM gates WHERE id = ?', gid);
    const scan = (pass, gid, dev, minutes, extra = {}) =>
      recordScan(db, {
        event: event(),
        gate: gateRow(gid),
        device: dev,
        user: { id: dev.user_id },
        id: crypto.randomUUID(),
        qr: qrFor(event(), pass.token_id),
        scannedAt: minutesAgo(minutes),
        ...extra,
      });
    const withPass = visitors.filter((v) => v.pass && v.reg.status === 'confirmed');
    const tradeToday = withPass.filter((v) => v.classId === cVisitor).slice(0, 31);
    tradeToday.forEach((v, i) => scan(v.pass, i % 2 ? g2 : g1, i % 2 ? d2 : d1, 20 + Math.floor(rand() * 200)));
    // Some visitors walked into the second hall; a few came back in later.
    tradeToday.slice(0, 9).forEach((v, i) => scan(v.pass, i % 2 ? g1 : g2, i % 2 ? d1 : d2, 6 + Math.floor(rand() * 12)));
    for (const v of withPass.filter((x) => x.classId === cDelegate).slice(0, 4)) {
      scan(v.pass, g1, d1, 150 + Math.floor(rand() * 60));
      scan(v.pass, g3, d3, 70 + Math.floor(rand() * 60));
    }
    for (const d of dayOne) scan(d.pass, g1, d1, 60 * 26);
    // Exceptions to review: an expired pass, a wrong-area pass, a double scan, a forged code.
    scan(dayOne[0].pass, g1, d1, 44);
    scan(tradeToday[12].pass, g3, d3, 38);
    const twice = withPass.filter((v) => v.classId === cVisitor)[41];
    scan(twice.pass, g1, d1, 19);
    scan(twice.pass, g1, d1, 18.6);
    recordScan(db, {
      event: event(),
      gate: gateRow(g2),
      device: d2,
      user: { id: d2.user_id },
      id: crypto.randomUUID(),
      qr: 'BAE1.notARealPassToken000.notARealSignature00',
      scannedAt: minutesAgo(31),
    });
    // Two phones at Gate 1 both accepted the same pass while offline: flagged, counted once.
    const clash = withPass.filter((v) => v.classId === cVisitor)[40];
    scan(clash.pass, g1, d1, 58, { mode: 'offline', deviceResult: 'admitted' });
    scan(clash.pass, g1, d1b, 55, { mode: 'offline', deviceResult: 'admitted' });
    // Badges: most printed; Gate 2's printer is out of labels, so its job failed.
    const adapters = ctx.adapters;
    const printFor = (v, gid, userId) =>
      createPrintJob(db, adapters, { event: event(), pass: v.pass, gate: gateRow(gid), user: { id: userId } });
    tradeToday
      .filter((_v, i) => i % 2 === 0)
      .slice(0, 10)
      .forEach((v) => printFor(v, g1, gateUsers[0][0]));
    printFor(tradeToday[1], g2, gateUsers[1][0]);
    printFor(tradeToday[5], g2, gateUsers[1][0]);

    // ---------- leads ----------
    const leadReq = {
      user: { id: db.value("SELECT id FROM users WHERE email = 'karan@novadisplays.example'"), name: 'Karan Bhatia' },
      ip: null,
    };
    const lead = (xid, v, tags, notes, rating) =>
      captureLead(ctx, leadReq, event(), db.get('SELECT * FROM exhibitors WHERE id = ?', xid), {
        qr: qrFor(event(), v.pass.token_id),
        tags,
        notes,
        rating,
      });
    lead(nova, aarav, ['Digital signage'], 'Wants a quote for 40 store-window screens across 12 stores. Decision by next quarter.', 'hot');
    lead(nova, elena, ['Self-service kiosks'], 'Looking at lobby check-in kiosks for three hotels.', 'warm');
    lead(nova, tradeToday[2], ['Digital signage', 'Pricing sent'], 'Sent the price list. Follow up in two weeks.', 'warm');
    lead(nova, tradeToday[4], ['Video walls'], null, 'cold');
    lead(nova, tradeToday[6], ['Digital signage', 'Demo booked'], 'Demo at their Gurugram office on the 24th.', 'hot');
    lead(lumen, tradeToday[2], ['Smart workplace'], 'Room booking for a 400-seat office.', 'warm');

    // ---------- agenda ----------
    const summit = db.insert('tracks', {
      event_id: eid,
      name: 'Future of Work Summit',
      description: 'Conference track. Needs a conference delegate pass.',
      sort: 1,
    });
    const stage = db.insert('tracks', { event_id: eid, name: 'Expo Stage', description: 'Free talks and demos in Hall B.', sort: 2 });
    const theatre = db.insert('rooms', { event_id: eid, zone_id: conf, name: 'Conference Theatre', capacity: 180 });
    const stageRoom = db.insert('rooms', { event_id: eid, zone_id: hallB, name: 'Expo Stage, Hall B', capacity: 80 });
    const session = (day, start, end, track, room, title, speakers, description, extra = {}) =>
      db.insert('agenda_sessions', {
        event_id: eid,
        track_id: track,
        room_id: room,
        title,
        description,
        speakers: JSON.stringify(speakers),
        day,
        start_time: start,
        end_time: end,
        updated_at: nowIso(),
        ...extra,
      });
    session(
      day1,
      '10:30',
      '11:15',
      summit,
      theatre,
      'Opening keynote: the office after hybrid',
      [{ name: 'Dr Kamala Venkataraman', title: 'Workplace researcher' }],
      'What five years of hybrid working data says about how offices should change.',
    );
    session(
      day1,
      '14:00',
      '14:45',
      stage,
      stageRoom,
      'Live demo: a store window that sells',
      [{ name: 'Ritu Bansal', title: 'Nova Displays' }],
      'Content, brightness and scheduling for window displays.',
    );
    session(
      today,
      '10:30',
      '11:15',
      summit,
      theatre,
      'Retail without queues',
      [
        { name: 'Aarav Mehta', title: 'Meridian Retail' },
        { name: 'Dhruv Malhotra', title: 'Kestrel Kiosks' },
      ],
      'Self-checkout, kiosks and staff-assisted payment: what actually reduced waiting time.',
    );
    session(
      today,
      '11:30',
      '12:15',
      summit,
      theatre,
      'Panel: measuring the workplace',
      [
        { name: 'Farah Siddiqui', title: 'Lumen Workspace' },
        { name: 'Shalini Deshpande', title: 'Peepal Furniture Systems' },
      ],
      'Occupancy data, privacy and the decisions it should and should not drive.',
    );
    session(
      today,
      '12:00',
      '12:30',
      stage,
      stageRoom,
      'Wayfinding for large venues',
      [{ name: 'Zoya Hussain', title: 'Orbit Wayfinding' }],
      'Design rules for maps people can use in ten seconds.',
    );
    session(
      today,
      '14:00',
      '15:30',
      summit,
      theatre,
      'Workshop: designing self-service journeys',
      [{ name: 'Elena Park', title: 'Rivermoor Hospitality' }],
      'Hands-on session. Places are limited.',
      { capacity: 40, seats_taken: 40 },
    );
    session(
      today,
      '15:00',
      '15:30',
      stage,
      stageRoom,
      'Badges, lanyards and the last 100 metres',
      [{ name: 'Nitin Agarwal', title: 'Saffron Print Labs' }],
      'What goes wrong at registration desks and how to fix it.',
    );
    session(
      today,
      '16:00',
      '16:45',
      summit,
      theatre,
      'Accessible by default',
      [{ name: 'Dr Kamala Venkataraman', title: 'Workplace researcher' }],
      'Building screens, kiosks and spaces that work for everyone.',
    );
    session(
      day3,
      '10:30',
      '11:15',
      summit,
      theatre,
      'Footfall to forecast',
      [{ name: 'Omar Farooqui', title: 'Indus Retail Analytics' }],
      'Using store data to plan staffing and stock.',
    );
    session(
      day3,
      '12:00',
      '12:45',
      summit,
      theatre,
      'Closing panel: what to buy this year',
      [
        { name: 'Rhea Kapoor', title: 'Quillon Access Control' },
        { name: 'Leela Krishnan', title: 'Tarang Audio Visual' },
      ],
      'A practical buying guide from this year’s exhibitors.',
    );
    session(day3, '14:00', '14:30', stage, stageRoom, 'Awards and prize draw', [], 'Best stand awards and the visitor prize draw.');

    db.insert('announcements', {
      event_id: eid,
      kind: 'schedule',
      audience: 'all',
      title: 'Workshop is full',
      body: 'The 2 pm workshop "Designing self-service journeys" has no places left. The 4 pm session "Accessible by default" still has seats.',
      published_at: minutesAgo(95),
      created_by: admin,
      created_at: minutesAgo(95),
    });
    db.insert('announcements', {
      event_id: eid,
      kind: 'gate',
      audience: 'all',
      title: 'Use Gate 1 for quicker badge printing',
      body: 'The Gate 2 badge printer is being refilled. Gate 1 and the help desk are printing as normal.',
      published_at: minutesAgo(25),
      created_by: admin,
      created_at: minutesAgo(25),
    });

    // ---------- a second organiser, to show tenants cannot see each other ----------
    const org2 = db.insert('organisers', { name: 'Northfield Events', slug: 'northfield-events', created_at: nowIso() });
    const e2 = db.insert('events', {
      organiser_id: org2,
      slug: 'northfield-build-summit',
      name: 'Northfield Build Summit',
      edition: today.slice(0, 4),
      kind: 'conference',
      venue_name: 'Harbour Hall',
      city: 'Mumbai',
      starts_on: addDays(today, 40),
      ends_on: addDays(today, 41),
      status: 'draft',
      qr_secret: randomToken(32),
      updated_at: nowIso(),
      created_at: nowIso(),
    });
    const z2 = db.insert('zones', {
      event_id: e2,
      code: 'MAIN',
      name: 'Main Hall',
      kind: 'hall',
      plan: JSON.stringify({ cols: 6, rows: 4 }),
    });
    db.insert('gates', { event_id: e2, zone_id: z2, code: 'G1', name: 'Main entrance' });
    db.insert('pass_classes', {
      event_id: e2,
      code: 'DELEGATE',
      name: 'Delegate',
      kind: 'delegate',
      mode: 'free',
      zone_ids: JSON.stringify([z2]),
      valid_from: addDays(today, 40),
      valid_to: addDays(today, 41),
    });
    db.insert('memberships', {
      user_id: user('owner@northfield.example', 'Tara Northfield'),
      organiser_id: org2,
      event_id: null,
      role: 'organiser_admin',
      created_at: nowIso(),
    });

    // The demo starts with a clean outbox and audit trail.
    db.run('DELETE FROM outbox');
    db.run('DELETE FROM audit_log');
    db.run('DELETE FROM otp_codes');
    db.run("INSERT INTO app_settings (key, value) VALUES ('demo', '1')");
  });
}

// A production start: one organiser and its first administrator, no events.
export function seedEmpty(ctx, env) {
  const { db } = ctx;
  const email = (env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const pw = env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url') + '9a';
  db.tx(() => {
    const org = db.insert('organisers', { name: env.ORGANISER_NAME || 'My organisation', slug: 'organiser', created_at: nowIso() });
    const uid = db.insert('users', { email, name: 'Administrator', password_hash: hashPassword(pw), created_at: nowIso() });
    db.insert('memberships', { user_id: uid, organiser_id: org, event_id: null, role: 'organiser_admin', created_at: nowIso() });
  });
  if (!env.ADMIN_PASSWORD) console.log(`\n  First administrator: ${email} / ${pw}\n`);
}
