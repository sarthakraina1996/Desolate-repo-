// Demo environment: a fictional portfolio and a year of operations replayed day by day through
// the real domain services (bookings, cancellations, check-ins, charges, payments, checkouts,
// housekeeping, night audits). Nothing is written behind the services' backs, so every figure
// reconciles across modules. The organisation is flagged is_demo and labelled in the UI.
import { addDays, diffDays, dow, nights as nightsOf, todayIn } from '../core/dates.js';
import { toMinor } from '../core/money.js';
import { createOrganization, createProperty } from '../modules/properties/service.js';
import { createBlock, saveRoom, saveRoomType } from '../modules/rooms/service.js';
import { saveRatePlan, setDailyRates, setRestrictions } from '../modules/rates/service.js';
import { saveCompany, saveGuest } from '../modules/guests/service.js';
import { autoAssign, cancelReservation, createBooking } from '../modules/reservations/service.js';
import { checkIn, checkOut, createRequest } from '../modules/frontdesk/service.js';
import { completeTask, inspectTask, startTask } from '../modules/housekeeping/service.js';
import { closeFolio, createHouseFolio, folioBalance, issueInvoice, postCharge, postPayment } from '../modules/folios/service.js';
import { runNightAudit } from '../modules/nightaudit/service.js';
import { hashPassword, loadUser } from '../modules/auth/service.js';
import { pad } from '../core/sequences.js';
import { rng } from './random.js';
import {
  COMPANIES,
  COUNTRIES_INTL,
  FIRST_IN,
  FIRST_INTL,
  LAST_IN,
  LAST_INTL,
  ORG,
  PREFERENCES,
  PROPERTIES,
  USERS,
} from './portfolio.js';

export const DEMO_PASSWORD = 'Hospitality@2026';

// Profiles: the full demo (12 months) and a compact one for automated tests.
export const PROFILES = {
  full: { months: 12, futureDays: 120, warmupDays: 21 },
  test: { months: 2, futureDays: 30, warmupDays: 10 },
};

// Runs the whole seed synchronously (tests, CLI reset).
export function seedDemo(db, options = {}) {
  const steps = seedDemoSteps(db, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

// Runs the seed in slices so a server can keep answering (with a progress screen) meanwhile.
export async function seedDemoInBackground(db, options = {}, onProgress = () => {}) {
  for (const p of seedDemoSteps(db, options)) {
    onProgress(p);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// The seed as a generator: yields { done, total } after each simulated day.
export function* seedDemoSteps(db, options = {}) {
  const profile = PROFILES[options.profile || 'full'];
  const today = options.today || todayIn('Asia/Kolkata');
  const months = options.months ?? profile.months;
  const futureDays = options.futureDays ?? profile.futureDays;
  const historyDays = Math.round(months * 30.44);
  const start = addDays(today, -(historyDays + profile.warmupDays));
  const R = rng(options.seed || 20261024);
  const log = options.log ? (...a) => console.log('[seed]', ...a) : () => {};
  const t0 = Date.now();
  db.bulkImport = true;

  // ---------- organisation, people, companies ----------
  const orgId = createOrganization(db, { ...ORG, isDemo: true });
  const pw = hashPassword(DEMO_PASSWORD);
  for (const u of USERS)
    db.insert('users', { org_id: orgId, email: u.email, name: u.name, title: u.title, role: u.role, all_properties: u.all ? 1 : 0, password_hash: pw });
  let clockValue = `${start}T03:30:00.000Z`;
  const clock = () => clockValue;
  const setClock = (date, hhmm) => {
    clockValue = `${date}T${hhmm}:00.000Z`;
  };
  const actorFor = (email) => {
    const id = db.value('SELECT id FROM users WHERE email = ?', email);
    return { ...loadUser(db, id), system: true, clock };
  };
  const system = { id: null, orgId, system: true, clock, permissions: [] };
  const admin = actorFor('neha.kulkarni@lumora.demo');
  const companies = {};
  for (const c of COMPANIES) {
    const row = saveCompany(db, admin, orgId, {
      kind: c.kind,
      name: c.name,
      city: c.city ?? null,
      country: c.country ?? null,
      tax_id: c.tax_id ?? null,
      ar_enabled: c.ar ? 1 : 0,
      credit_limit_minor: c.limit ? toMinor(c.limit, 'INR') : 0,
      credit_days: c.days ?? 30,
      commission_bp: c.commission ?? 0,
      email: c.kind === 'ota' ? null : `accounts@${c.name.toLowerCase().replace(/[^a-z]+/g, '')}.demo`,
    });
    companies[c.name] = row;
  }

  // Demo FX: EUR→INR monthly rates (fixed, labelled demo; not market data).
  for (let m = -26; m <= Math.ceil(historyDays / 30) + Math.ceil(futureDays / 30) + 2; m++) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + m);
    const date = d.toISOString().slice(0, 10);
    const rate = 98 + 3 * Math.sin(m / 3) + m * 0.15;
    db.run('INSERT OR REPLACE INTO fx_rates (rate_date, from_currency, to_currency, rate_micros, source) VALUES (?, ?, ?, ?, ?)', date, 'EUR', 'INR', Math.round(rate * 1e6), 'demo');
  }

  // ---------- properties, buildings, rooms, rates ----------
  const sim = [];
  for (const P of PROPERTIES) {
    const leId = db.insert('legal_entities', {
      org_id: orgId,
      name: P.legal.name,
      country: P.country,
      tax_id_type: P.legal.tax_id_type,
      tax_id: P.legal.tax_id,
      registered_address: `${P.address}, ${P.city}`,
      base_currency: P.currency,
    });
    const prop = createProperty(
      db,
      admin,
      orgId,
      {
        code: P.code,
        name: P.name,
        brand: P.brand,
        category: P.category,
        star_rating: P.star_rating,
        address: P.address,
        city: P.city,
        state: P.state,
        state_code: P.state_code,
        postal_code: P.postal_code,
        country: P.country,
        phone: P.country === 'IN' ? '+91 11 4000 0000' : '+351 21 000 0000',
        email: `frontdesk.${P.code.toLowerCase()}@lumora.demo`,
        timezone: P.timezone,
        currency: P.currency,
        locale: P.locale,
        tax_regime: P.tax_regime,
        prices_include_tax: P.prices_include_tax ?? 0,
        business_date: start,
        invoice_prefix: P.invoice_prefix,
        legal_entity_id: leId,
        opened_on: addDays(start, -900),
        description: `${P.category} — fictional demo property.`,
        overbooking_pct: 0,
      },
      { specifiedPremises: P.specifiedPremises },
    );
    for (const u of USERS.filter((x) => x.props?.includes(P.code)))
      db.run('INSERT INTO user_properties (user_id, property_id) VALUES ((SELECT id FROM users WHERE email = ?), ?)', u.email, prop.id);

    const floorIds = {};
    const buildingIds = {};
    P.buildings.forEach((b, i) => {
      const bid = db.insert('buildings', { property_id: prop.id, code: b.code, name: b.name, sort: i });
      buildingIds[b.code] = bid;
      for (const level of b.floors)
        floorIds[`${b.code}:${level}`] = db.insert('floors', { property_id: prop.id, building_id: bid, level, name: level === 0 ? 'Ground floor' : `Floor ${level}` });
    });
    const types = [];
    const seqByFloor = {};
    P.types.forEach((T, ti) => {
      const type = saveRoomType(db, admin, prop.id, {
        code: T.code,
        name: T.name,
        category: T.category,
        description: `${T.name} — ${T.area} sq ft, ${T.view.toLowerCase()} view, ${T.bed[0].toLowerCase()} bed.`,
        base_adults: 2,
        max_adults: T.adults,
        max_children: T.children,
        max_occupancy: T.adults + Math.min(T.children, 1),
        extra_beds: T.extraBeds ?? 0,
        area_sqft: T.area,
        bedrooms: T.bedrooms ?? 1,
        bed_type: T.bed[0],
        bed_size: T.bed[1],
        view_type: T.view,
        smoking: 0,
        balcony: T.balcony ?? 0,
        bathroom: T.amenities.includes('BATHTUB') ? 'Bathtub and walk-in shower' : 'Walk-in shower',
        ac_type: 'Central, individually controlled',
        color: T.color,
        sort: ti,
        amenities: T.amenities,
      });
      const building = T.building || P.buildings[0].code;
      const bdef = P.buildings.find((b) => b.code === building);
      const rooms = [];
      for (let i = 0; i < T.rooms; i++) {
        const level = T.floors[i % T.floors.length];
        const key = `${building}:${level}`;
        seqByFloor[key] = (seqByFloor[key] || 0) + 1;
        const prefix = bdef.prefix || '';
        const number = level === 0 ? `${prefix || 'G'}${pad(seqByFloor[key], 2)}` : `${prefix}${level}${pad(seqByFloor[key], 2)}`;
        const room = saveRoom(db, admin, prop.id, {
          number,
          building_id: buildingIds[building],
          floor_id: floorIds[key],
          room_type_id: type.id,
          commissioned_on: addDays(start, -900),
          last_refurbished_on: addDays(start, -R.int(120, 1400)),
          accessible: i === 0 && T.category !== 'Suite' ? 1 : 0,
          accessibility_features: i === 0 && T.category !== 'Suite' ? ['Roll-in shower', 'Grab bars', 'Lowered peephole', 'Visual fire alarm'] : [],
          cost_centre_id: db.value("SELECT id FROM cost_centres WHERE property_id = ? AND department = 'rooms'", prop.id),
          sort: seqByFloor[key],
        });
        rooms.push(room);
      }
      types.push({ ...T, id: type.id, rooms: rooms.map((r) => r.id) });
    });
    // Connecting pairs on the first floor of the first type, with a room-level exception.
    const firstType = types[0];
    if (firstType.rooms.length >= 2) {
      db.run('UPDATE rooms SET connecting_room_id = ? WHERE id = ?', firstType.rooms[1], firstType.rooms[0]);
      db.run('UPDATE rooms SET connecting_room_id = ? WHERE id = ?', firstType.rooms[0], firstType.rooms[1]);
    }

    // Rate plans: BAR (room only) with seasonal prices, derived BB / NRF / Corporate / Long stay.
    const policies = Object.fromEntries(db.all('SELECT code, id FROM cancellation_policies WHERE property_id = ?', prop.id).map((p) => [p.code, p.id]));
    const ccy = P.currency;
    const bfast = P.currency === 'EUR' ? toMinor(18, ccy) : toMinor(P.fnbFactor >= 1.2 ? 1400 : 950, ccy);
    const bar = saveRatePlan(db, admin, prop.id, {
      code: 'BAR',
      name: 'Best Available Rate — Room only',
      meal_plan: 'RO',
      cancellation_policy_id: policies.FLEX24,
      sort: 0,
      roomTypes: types.map((t) => ({
        room_type_id: t.id,
        base_minor: toMinor(t.rate[0], ccy),
        weekend_minor: toMinor(t.rate[1], ccy),
        extra_adult_minor: toMinor(P.currency === 'EUR' ? 35 : 2500, ccy),
        extra_child_minor: toMinor(P.currency === 'EUR' ? 20 : 1200, ccy),
      })),
    });
    const plans = { BAR: bar.id };
    plans.BB = saveRatePlan(db, admin, prop.id, { code: 'BB', name: 'Bed & Breakfast', meal_plan: 'BB', parent_id: bar.id, derive_kind: 'amount', derive_value: bfast * 2, fnb_component_minor: bfast, cancellation_policy_id: policies.FLEX24, sort: 1 }).id;
    plans.NRF = saveRatePlan(db, admin, prop.id, { code: 'NRF', name: 'Non-refundable — save 10%', meal_plan: 'RO', parent_id: bar.id, derive_kind: 'percent', derive_value: -1000, cancellation_policy_id: policies.NONREF, sort: 2 }).id;
    plans.CORP = saveRatePlan(db, admin, prop.id, { code: 'CORP', name: 'Corporate negotiated (BB)', meal_plan: 'BB', parent_id: plans.BB, derive_kind: 'percent', derive_value: -1500, fnb_component_minor: bfast, is_public: 0, commissionable: 0, cancellation_policy_id: policies.FLEX24, sort: 3 }).id;
    plans.LONG = saveRatePlan(db, admin, prop.id, { code: 'LONG', name: 'Long stay 7+ nights', meal_plan: 'RO', parent_id: bar.id, derive_kind: 'percent', derive_value: -1200, min_los: 7, cancellation_policy_id: policies.FLEX24, sort: 4 }).id;
    // Seasonal BAR overrides for every night of the simulation and the forward horizon.
    const horizon = addDays(today, futureDays + 60);
    for (const t of types)
      for (let m0 = start; m0 < horizon; ) {
        const month = Number(m0.slice(5, 7));
        const next = addDays(`${m0.slice(0, 7)}-01`, 32).slice(0, 7) + '-01';
        const end = next < horizon ? next : horizon;
        const season = P.priceSeason[month] ?? 1;
        for (const [days, price] of [
          [[0, 1, 2, 3, 4, 5, 6].filter((d) => !P.weekend.includes(d)), t.rate[0]],
          [P.weekend, t.rate[1]],
        ]) {
          const amount = P.currency === 'EUR' ? Math.round(price * season) : Math.round((price * season) / 100) * 100;
          setDailyRates(db, admin, prop.id, { ratePlanId: bar.id, roomTypeId: t.id, from: m0, to: end, amountMinor: toMinor(amount, ccy), weekdays: days });
        }
        m0 = end;
      }
    sim.push({ P, prop, types, plans, roomCount: types.reduce((a, t) => a + t.rooms.length, 0) });
  }

  // Maintenance history: a few out-of-order periods, one running today and one upcoming.
  for (const s of sim) {
    const roomsAll = s.types.flatMap((t) => t.rooms);
    for (let i = 0; i < 4; i++) {
      const from = addDays(start, R.int(5, historyDays));
      createBlock(db, admin, s.prop.id, { roomId: R.pick(roomsAll), kind: 'ooo', startDate: from, endDate: addDays(from, R.int(2, 6)), reason: R.pick(['Bathroom re-grouting', 'AC compressor replacement', 'Carpet replacement', 'Water leak repair', 'Soft-furnishing refresh']) });
    }
  }
  const lgd = sim[0];
  createBlock(db, admin, lgd.prop.id, { roomId: lgd.types[1].rooms[3], kind: 'ooo', startDate: addDays(today, -1), endDate: addDays(today, 3), reason: 'Bathroom renovation — tiling' });
  createBlock(db, admin, lgd.prop.id, { roomId: lgd.types[0].rooms[7], kind: 'oos', startDate: addDays(today, 8), endDate: addDays(today, 10), reason: 'Deep cleaning and mattress rotation' });
  // A forward restriction: New Year at the Goa resort needs 3 nights minimum.
  const goa = sim.find((s) => s.P.code === 'LSG');
  const ny = `${today.slice(0, 4)}-12-30`;
  if (ny > today) setRestrictions(db, admin, goa.prop.id, { from: ny, to: addDays(ny, 2), values: { min_los: 3 } });
  log(`masters ready in ${Date.now() - t0} ms`);

  // ---------- demand plan ----------
  const guestPool = [];
  const plan = new Map(); // bookingDate -> [stay]
  const cancelPlan = new Map(); // date -> [stay]
  const end = addDays(today, futureDays);
  const add = (map, k, v) => (map.get(k) || map.set(k, []).get(k)).push(v);
  let stayId = 0;
  for (const s of sim) {
    const P = s.P;
    const meanLos = P.los.reduce((a, b) => a + b, 0) / P.los.length;
    const typeWeights = s.types.map((t) => [t, t.rooms.length * (t.category === 'Suite' || t.category === 'Villa' ? 0.75 : 1)]);
    for (const A of nightsOf(start, end)) {
      const month = Number(A.slice(5, 7));
      const weekend = P.weekend.includes(dow(A));
      let occ = (P.demand.base || 0) + (P.demand.month[month] || 0) + (weekend ? P.demand.weekend : P.demand.weekday);
      occ = Math.min(0.97, Math.max(0.12, occ + R.normal() * 0.05));
      const arrivals = R.poisson((occ * s.roomCount) / meanLos / 0.88);
      for (let i = 0; i < arrivals; i++) {
        const source = R.weighted(P.sources);
        let los = R.pick(P.los);
        if (source === 'Corporate') los = Math.min(los, R.int(1, 3));
        if (A >= `${A.slice(0, 4)}-12-29` && A <= `${A.slice(0, 4)}-12-31` && P.code === 'LSG') los = Math.max(los, 3);
        const type = R.weighted(typeWeights);
        const leadMean = source === 'Walk-in' ? 0 : source === 'Corporate' ? P.leadMean * 0.6 : source === 'Group' ? P.leadMean * 2 : source === 'OTA' ? P.leadMean * 0.8 : P.leadMean;
        const lead = source === 'Walk-in' ? 0 : Math.min(240, R.exp(leadMean));
        const bookingDate = addDays(A, -lead) < start ? start : addDays(A, -lead);
        if (bookingDate > today) continue;
        let ratePlan = 'BAR';
        if (source === 'Corporate') ratePlan = 'CORP';
        else if (los >= 7 && R.chance(0.5)) ratePlan = 'LONG';
        else if (source === 'OTA') ratePlan = R.chance(0.3) ? 'NRF' : 'BAR';
        else if (source === 'Website') ratePlan = R.weighted({ BAR: 5, BB: 3, NRF: 2 });
        else if (['Direct', 'Phone', 'Travel Agent', 'Group'].includes(source)) ratePlan = R.chance(0.55) ? 'BB' : 'BAR';
        const cancelP = ratePlan === 'NRF' ? 0.02 : source === 'OTA' ? 0.18 : source === 'Walk-in' ? 0 : 0.09;
        const willCancel = R.chance(cancelP) && diffDays(bookingDate, A) >= 1;
        const cancelDate = willCancel ? addDays(bookingDate, R.int(0, Math.max(0, diffDays(bookingDate, A) - 1))) : null;
        const intl = P.country === 'PT' ? R.chance(0.85) : R.chance(source === 'OTA' ? 0.3 : 0.15);
        let guest = null;
        if (guestPool.length > 50 && R.chance(0.18)) guest = R.pick(guestPool);
        const adults = source === 'Corporate' ? (R.chance(0.85) ? 1 : 2) : Math.min(type.adults, R.weighted({ 1: 2, 2: 7, 3: 1 }) * 1);
        const children = source !== 'Corporate' && R.chance(0.18) ? Math.min(type.children, 1) : 0;
        let channel = null;
        let company = null;
        if (source === 'OTA') {
          channel = P.country === 'PT' ? R.weighted({ 'Booking.com': 6, Expedia: 3, Agoda: 1 }) : R.weighted({ 'Booking.com': 4, MakeMyTrip: 3, Expedia: 2, Agoda: 1 });
          company = companies[channel];
        } else if (source === 'Corporate') company = P.country === 'PT' ? companies['Riverstone Advisory Lda'] : companies[R.pick(['Kestrel Analytics Pvt Ltd', 'Bluepeak Engineering Ltd', 'Orchid Life Sciences', 'Meridian Freight & Logistics', 'Saffron Software Labs', 'Atlas Infra Projects'])];
        else if (source === 'Travel Agent') company = P.country === 'PT' ? companies['Tagus Travel Co.'] : companies[R.pick(['Wanderlane Tours', 'Monsoon Trails Travel'])];
        const stay = {
          id: ++stayId,
          s,
          arrival: A,
          departure: addDays(A, los),
          source,
          channel,
          company,
          type,
          ratePlan,
          adults: Math.max(1, Number(adults) || 1),
          children,
          bookingDate,
          cancelDate,
          noShow: !willCancel && source !== 'Walk-in' && R.chance(source === 'OTA' ? 0.03 : 0.012),
          comp: source === 'Direct' && R.chance(0.012),
          intl,
          guest,
          eta: R.pick(['10:00', '13:00', '14:00', '15:00', '16:30', '18:00', '20:00', '22:30']),
          rooms: 1,
        };
        if (source === 'Group') stay.rooms = R.int(3, Math.max(3, Math.min(12, Math.floor(type.rooms.length / 2))));
        add(plan, bookingDate, stay);
        if (cancelDate) add(cancelPlan, cancelDate, stay);
      }
    }
  }
  log(`planned ${stayId} stays in ${Date.now() - t0} ms`);

  // ---------- helpers for the simulation ----------
  const deskOf = (s) => actorFor(USERS.find((u) => u.role === 'front_desk' && u.props.includes(s.P.code)).email);
  const hkOf = (s) => {
    const sup = USERS.find((u) => u.role === 'housekeeping_manager' && u.props.includes(s.P.code));
    const att = USERS.filter((u) => u.role === 'housekeeping_attendant' && u.props.includes(s.P.code));
    return { supervisor: actorFor(sup.email), attendants: att.map((a) => actorFor(a.email)) };
  };
  for (const s of sim) {
    s.desk = deskOf(s);
    s.hk = hkOf(s);
    s.auditor = actorFor(USERS.find((u) => (u.role === 'front_office_manager' || u.role === 'gm') && u.props.includes(s.P.code)).email);
  }

  const newGuest = (stay) => {
    const intl = stay.intl;
    const first = R.pick(intl ? FIRST_INTL : FIRST_IN);
    const last = R.pick(intl ? LAST_INTL : LAST_IN);
    const country = intl ? R.pick(COUNTRIES_INTL) : 'IN';
    const g = {
      first_name: first,
      last_name: last,
      email: `${first}.${last}.${R.int(10, 9999)}`.toLowerCase().normalize('NFD').replace(/[^a-z0-9.]/g, '') + '@guest.demo',
      phone: country === 'IN' ? `+91 9${R.int(100000000, 999999999)}` : `+${R.int(30, 49)} ${R.int(100000000, 999999999)}`,
      country,
      nationality: country,
      city: country === 'IN' ? R.pick(['Mumbai', 'New Delhi', 'Bengaluru', 'Chennai', 'Kolkata', 'Pune', 'Hyderabad', 'Ahmedabad']) : null,
      vip: R.chance(0.03) ? R.pick(['VIP1', 'VIP2']) : '',
      preferences: R.chance(0.3) ? [R.pick(PREFERENCES)] : [],
      marketing_consent: R.chance(0.4) ? 1 : 0,
      company_id: stay.source === 'Corporate' ? stay.company?.id : null,
    };
    return g;
  };

  const methodFor = (s) => (s.P.country === 'IN' ? R.weighted({ CARD: 55, UPI: 25, CASH: 10, BANK: 10 }) : R.weighted({ CARD: 85, CASH: 7, BANK: 8 }));
  const pay = (actor, folioId, method, amount, tag) =>
    postPayment(db, actor, {
      folioId,
      method,
      amountMinor: amount,
      reference: method === 'CARD' ? `DEMO-AUTH-${R.int(100000, 999999)}` : method === 'UPI' ? `DEMO-UPI-${R.int(10000000, 99999999)}` : null,
      cardLast4: method === 'CARD' ? String(R.int(1000, 9999)) : null,
      source: 'seed',
      dedupeKey: `seed:${tag}`,
    });

  const settleAndClose = (actor, resId, tag) => {
    for (const f of db.all("SELECT * FROM folios WHERE reservation_id = ? AND status = 'open'", resId)) {
      const bal = folioBalance(db, f.id);
      if (bal > 0) pay(actor, f.id, 'CARD', bal, `${tag}:${f.id}`);
      else if (bal < 0) postPayment(db, actor, { folioId: f.id, kind: 'refund', method: 'CARD', amountMinor: -bal, source: 'seed', dedupeKey: `seed:refund:${tag}:${f.id}` });
      if (db.value('SELECT COUNT(*) FROM folio_postings WHERE folio_id = ? AND invoice_id IS NULL AND (net_minor <> 0 OR tax_minor <> 0)', f.id)) issueInvoice(db, actor, f.id);
      closeFolio(db, actor, f.id);
    }
  };

  const currencyRange = (s, inr, eur) => (s.P.currency === 'EUR' ? toMinor(R.int(eur[0], eur[1]), 'EUR') : toMinor(Math.round((R.int(inr[0], inr[1]) * s.P.fnbFactor) / 50) * 50, 'INR'));

  const ancillaries = (s, actor, res, D) => {
    const k = `${res.id}:${D}`;
    const post = (code, amount, desc, tag) => postCharge(db, actor, { reservationId: res.id, chargeCode: code, unitMinor: amount, description: desc, source: 'seed', dedupeKey: `seed:${tag}:${k}` });
    if (R.chance(0.33)) post('REST', currencyRange(s, [1400, 4800], [28, 95]), 'Dinner — all-day dining', 'rest');
    if (R.chance(0.14)) post('BEV', currencyRange(s, [600, 2600], [10, 45]), 'Bar — beverages', 'bev');
    if (R.chance(0.09)) post('IRD', currencyRange(s, [700, 2300], [18, 48]), 'In-room dining', 'ird');
    if (R.chance(0.07)) post('MINIBAR', currencyRange(s, [250, 900], [6, 24]), 'Minibar', 'mini');
    if (R.chance(s.P.code === 'LSG' ? 0.08 : 0.035)) post('SPA', currencyRange(s, [3500, 8500], [70, 160]), 'Spa treatment', 'spa');
    if (R.chance(0.05)) post('LAUNDRY', currencyRange(s, [400, 1600], [10, 35]), 'Laundry & pressing', 'laun');
    if (res.arrival === D && R.chance(0.12)) post('TRANSFER', currencyRange(s, [1800, 3600], [35, 70]), 'Airport transfer', 'trf');
  };

  const eventDays = new Map();
  for (const s of sim)
    for (let m = 0; m < Math.ceil((historyDays + profile.warmupDays) / 30); m++)
      for (let e = 0; e < s.P.events; e++) add(eventDays, addDays(start, m * 30 + R.int(1, 29)), s);

  const runEvent = (s, D) => {
    const actor = s.auditor;
    const fid = createHouseFolio(db, actor, s.prop.id, { name: `Event — ${R.pick(['Product launch', 'Wedding reception', 'Annual sales meet', 'Board offsite', 'Sangeet evening', 'Gala dinner'])}` }).id;
    const covers = R.int(60, 320);
    const perCover = s.P.currency === 'EUR' ? toMinor(R.int(45, 85), 'EUR') : toMinor(R.int(1800, 3800), 'INR');
    postCharge(db, actor, { folioId: fid, chargeCode: 'BANQ', unitMinor: perCover, quantity: covers, description: `Banquet package × ${covers} covers`, source: 'seed', dedupeKey: `seed:banq:${fid}` });
    postCharge(db, actor, { folioId: fid, chargeCode: 'BANQ', unitMinor: s.P.currency === 'EUR' ? toMinor(R.int(800, 2400), 'EUR') : toMinor(R.int(60000, 180000), 'INR'), description: 'Hall rental and AV', source: 'seed', dedupeKey: `seed:hall:${fid}` });
    pay(actor, fid, 'BANK', folioBalance(db, fid), `event:${fid}`);
    issueInvoice(db, actor, fid, { name: R.pick(['Atlas Infra Projects', 'Kestrel Analytics Pvt Ltd', 'Private client', 'Orchid Life Sciences']) });
    closeFolio(db, actor, fid);
  };

  // ---------- day-by-day simulation ----------
  const byRes = new Map(); // reservation id -> planned stay
  const book = (stay) => {
    const s = stay.s;
    const actor = ['Direct', 'Phone', 'Walk-in', 'Corporate', 'Group'].includes(stay.source) ? s.desk : system;
    let guestId = stay.guest?.id;
    if (!guestId) {
      guestId = saveGuest(db, actor, orgId, newGuest(stay)).id;
      guestPool.push({ id: guestId });
    }
    const line = {
      roomTypeId: stay.type.id,
      ratePlanId: s.plans[stay.ratePlan],
      arrival: stay.arrival,
      departure: stay.departure,
      adults: Math.min(stay.adults, stay.type.adults),
      children: stay.children,
      isComplimentary: stay.comp,
      eta: stay.eta,
      specialRequests: R.chance(0.15) ? R.pick(['Early check-in requested', 'Anniversary — cake in room', 'Extra pillows', 'Ground floor preferred', 'Late arrival, please hold']) : null,
    };
    try {
      const out = createBooking(
        db,
        actor,
        {
          propertyId: s.prop.id,
          guestId,
          companyId: stay.company?.id ?? null,
          source: stay.source,
          channel: stay.channel,
          channelRef: stay.channel ? `DEMO-${stay.channel.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()}-${stay.id}` : null,
          segment: stay.source === 'Corporate' ? 'Corporate' : stay.source === 'Group' ? (s.P.code === 'LHJ' || s.P.code === 'LSG' ? 'Group' : 'MICE') : stay.arrival && diffDays(stay.arrival, stay.departure) >= 7 ? 'Long stay' : 'Leisure',
          groupName: stay.rooms > 1 ? `${R.pick(['Sharma', 'Kapoor', 'Iyer', 'Fernandes', 'Rathore', 'Bluepeak', 'Kestrel'])} ${R.pick(['wedding', 'offsite', 'conference', 'family reunion'])}` : null,
          guarantee: stay.ratePlan === 'NRF' ? 'deposit' : stay.source === 'OTA' ? 'ota_prepaid' : stay.source === 'Corporate' ? 'company' : R.chance(0.6) ? 'card' : 'none',
          rooms: Array.from({ length: stay.rooms }, () => ({ ...line })),
        },
        {},
      );
      stay.reservationIds = out.reservations.map((r) => r.id);
      for (const id of stay.reservationIds) byRes.set(id, stay);
      // Non-refundable and some website bookings are prepaid at booking.
      if (stay.ratePlan === 'NRF' || (stay.source === 'Website' && R.chance(0.35)))
        for (const r of out.reservations) {
          const f = db.get('SELECT id FROM folios WHERE reservation_id = ? AND folio_window = 1', r.id);
          if (r.total_minor > 0) pay(actor, f.id, 'CARD', stay.ratePlan === 'NRF' ? r.total_minor : r.nights[0].rate_minor, `prepay:${r.id}`);
        }
      return true;
    } catch (e) {
      if (e.status === 409) return false; // sold out or restricted: a turn-away
      throw e;
    }
  };

  let processed = 0;
  const days = nightsOf(start, addDays(today, 1));
  yield { done: 0, total: days.length, phase: 'Simulating operations' };
  for (const D of days) {
    const last = D === today;
    for (const s of sim) {
      db.tx(() => {
        const actor = s.desk;
        setClock(D, '04:00');
        // 1. New bookings and cancellations made today.
        for (const stay of (plan.get(D) || []).filter((x) => x.s === s)) book(stay);
        // Yesterday's no-show fees are charged to the card on file.
        for (const r of db.all("SELECT r.id FROM reservations r WHERE r.property_id = ? AND r.status IN ('no_show','cancelled') AND EXISTS (SELECT 1 FROM folios f WHERE f.reservation_id = r.id AND f.status = 'open')", s.prop.id))
          settleAndClose(actor, r.id, `noshow:${r.id}`);
        for (const stay of (cancelPlan.get(D) || []).filter((x) => x.s === s && x.reservationIds)) {
          for (const rid of stay.reservationIds) {
            const r = db.get('SELECT status FROM reservations WHERE id = ?', rid);
            if (r?.status !== 'confirmed') continue;
            setClock(D, '06:30');
            cancelReservation(db, stay.source === 'OTA' ? system : actor, rid, { reason: R.pick(['Change of plans', 'Found another hotel', 'Trip postponed', 'Flight cancelled', 'Duplicate booking']), nowLocal: { date: D, time: '12:00' } });
            settleAndClose(actor, rid, `cancel:${rid}`);
          }
        }
        // 2. Departures (morning). On the last day only part of them have left.
        const deps = db.all("SELECT * FROM reservations WHERE property_id = ? AND status = 'in_house' AND departure <= ? ORDER BY id", s.prop.id, D);
        deps.forEach((r, i) => {
          if (last && i % 5 >= 3) return;
          setClock(D, `0${5 + (i % 4)}:${String((i * 7) % 60).padStart(2, '0')}`);
          const corporate = r.source === 'Corporate' && r.company_id && db.value('SELECT ar_enabled FROM companies WHERE id = ?', r.company_id);
          let toCompany = corporate && R.chance(0.7);
          if (toCompany) {
            try {
              checkOut(db, actor, r.id, { billTo: 'company', companyId: r.company_id, nowTime: '10:45' });
            } catch (e) {
              if (e.status !== 409) throw e; // over the credit limit: the guest pays instead
              toCompany = false;
            }
          }
          if (!toCompany) {
            for (const f of db.all("SELECT id FROM folios WHERE reservation_id = ? AND status = 'open'", r.id)) {
              const bal = folioBalance(db, f.id);
              if (bal > 0) pay(actor, f.id, r.source === 'OTA' && r.guarantee === 'ota_prepaid' ? 'CARD' : methodFor(s), bal, `checkout:${f.id}`);
              else if (bal < 0) postPayment(db, actor, { folioId: f.id, kind: 'refund', method: 'CARD', amountMinor: -bal, source: 'seed', dedupeKey: `seed:refund:${f.id}` });
            }
            checkOut(db, actor, r.id, { nowTime: '10:30' });
          }
        });
        // 3. Housekeeping: departure cleans, then supervisor inspection.
        const tasks = db.all("SELECT * FROM hk_tasks WHERE property_id = ? AND business_date = ? AND status = 'open' ORDER BY priority DESC, id", s.prop.id, D);
        tasks.forEach((t, i) => {
          if (last && i % 3 === 2) return;
          const att = s.hk.attendants[i % s.hk.attendants.length];
          const startMin = 9 * 60 + 30 + Math.floor(i / s.hk.attendants.length) * 42 + R.int(0, 10);
          const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          setClock(D, hhmm(startMin));
          db.run('UPDATE hk_tasks SET attendant_id = ? WHERE id = ?', att.id, t.id);
          startTask(db, att, t.id);
          if (last && i % 3 === 1) return;
          const dur = R.int(24, 48);
          setClock(D, hhmm(startMin + dur));
          completeTask(db, att, t.id, { exception: R.chance(0.02) ? 'Shower drain slow — maintenance requested' : null });
          if (last && i % 5 === 0) return;
          setClock(D, hhmm(startMin + dur + R.int(5, 25)));
          if (R.chance(0.05)) {
            inspectTask(db, s.hk.supervisor, t.id, { pass: false, notes: R.pick(['Dust under bed', 'Bathroom mirror streaks', 'Minibar not restocked']) });
            startTask(db, att, t.id);
            setClock(D, hhmm(startMin + dur + 40));
            completeTask(db, att, t.id, {});
          }
          inspectTask(db, s.hk.supervisor, t.id, { pass: true });
        });
        // 4. Arrivals: assign rooms and check in (not the planned no-shows).
        setClock(D, '12:00');
        autoAssign(db, actor, s.prop.id, D);
        const arrivals = db.all("SELECT * FROM reservations WHERE property_id = ? AND arrival = ? AND status = 'confirmed' ORDER BY eta, id", s.prop.id, D);
        for (const r of arrivals) {
          if (byRes.get(r.id)?.noShow) continue;
          if (last && r.eta >= '14:00') continue;
          setClock(D, r.eta && r.eta > '12:00' ? r.eta : '14:00');
          const g = db.get('SELECT id_verified_at FROM guests WHERE id = ?', r.guest_id);
          try {
            checkIn(db, actor, r.id, g.id_verified_at ? { nowTime: r.eta || '15:00' } : { idType: s.P.country === 'IN' && !R.chance(0.2) ? 'aadhaar' : 'passport', idNumber: String(R.int(100000000000, 999999999999)), idCountry: s.P.country, nowTime: r.eta || '15:00' });
          } catch (e) {
            if (e.status !== 409) throw e; // room not ready / unassigned: stays an arrival for the night audit
          }
        }
        // 5. Spending by in-house guests.
        setClock(D, '20:30');
        for (const r of db.all("SELECT * FROM reservations WHERE property_id = ? AND status = 'in_house'", s.prop.id)) ancillaries(s, actor, r, D);
        // 6. Banquets and events.
        for (const es of eventDays.get(D) || []) if (es === s && !last) runEvent(s, D);
        // 7. Company accounts pay their invoices after the credit period.
        if (!last && (D.endsWith('-05') || D.endsWith('-20')))
          for (const f of db.all("SELECT f.*, c.credit_days FROM folios f JOIN companies c ON c.id = f.company_id WHERE f.property_id = ? AND f.kind = 'company' AND f.status = 'open'", s.prop.id)) {
            const bal = folioBalance(db, f.id);
            const oldest = db.value('SELECT MIN(business_date) FROM folio_postings WHERE folio_id = ? AND amount_minor > 0', f.id);
            if (bal > 0 && oldest && diffDays(oldest, D) >= f.credit_days) pay(s.auditor, f.id, 'BANK', bal, `ar:${f.id}:${D}`);
          }
        // 8. Night audit closes the day (today stays open).
        if (!last) {
          setClock(D, '23:45');
          runNightAudit(db, s.auditor, s.prop.id);
        }
      });
    }
    processed++;
    if (options.log && processed % 30 === 0) log(`simulated ${processed} days (${Math.round((Date.now() - t0) / 1000)} s)`);
    yield { done: processed, total: days.length, phase: 'Simulating operations' };
  }

  // ---------- today's open items ----------
  setClock(today, '09:15');
  for (const s of sim.slice(0, 3)) {
    const inHouse = db.all("SELECT id FROM reservations WHERE property_id = ? AND status = 'in_house' LIMIT 6", s.prop.id);
    const kinds = [
      ['wake_up', 'Wake-up call 06:00 tomorrow'],
      ['request', 'Extra towels and a second bathrobe'],
      ['transport', 'Airport drop at 17:30, sedan'],
      ['complaint', 'Air conditioning is noisy at night'],
      ['maintenance', 'Bedside lamp not working'],
      ['luggage', 'Store two bags until evening'],
    ];
    inHouse.forEach((r, i) => createRequest(db, s.desk, s.prop.id, { kind: kinds[i][0], description: kinds[i][1], reservationId: r.id }));
  }
  db.bulkImport = false;
  log(`demo ready in ${Math.round((Date.now() - t0) / 1000)} s`);
  return { orgId, today, start };
}
