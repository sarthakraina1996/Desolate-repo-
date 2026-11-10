// Published event data: landing page, hall plan, exhibitor directory and agenda. This is the
// "event guide" the apps cache for offline use and the venue displays show. It never contains
// personal data about visitors.
import { json } from '../db.js';
import { eventSettings, hmIn, ymdIn } from '../core.js';
import { formFields, publicPassClasses } from './registrations.js';

export function eventSummary(event) {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    edition: event.edition,
    kind: event.kind,
    tagline: event.tagline,
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    city: event.city,
    timezone: event.timezone,
    startsOn: event.starts_on,
    endsOn: event.ends_on,
    openTime: event.open_time,
    closeTime: event.close_time,
    status: event.status,
  };
}

// Approved exhibitors with a published profile, with their booth if one is live.
export function directory(db, event) {
  return db
    .all(
      `SELECT e.*, b.code AS booth_code, b.id AS booth_id, z.name AS hall, z.id AS zone_id, a.status AS booth_status
       FROM exhibitors e
       LEFT JOIN booth_assignments a ON a.exhibitor_id = e.id AND a.status = 'confirmed'
       LEFT JOIN booths b ON b.id = a.booth_id
       LEFT JOIN zones z ON z.id = b.zone_id
       WHERE e.event_id = ? AND e.status = 'approved' AND e.profile_published = 1
       ORDER BY e.company_name COLLATE NOCASE`,
      event.id,
    )
    .map((e) => ({
      id: e.id,
      name: e.company_name,
      industry: e.industry,
      description: e.description,
      website: e.website,
      catalogueLinks: json(e.catalogue_links, []),
      categories: json(e.categories, []),
      boothCode: e.booth_code,
      boothId: e.booth_id,
      hall: e.hall,
      zoneId: e.zone_id,
    }));
}

// Halls with their booths, gates and amenities on a simple grid, for the 2D plan and its
// accessible list view.
export function mapData(db, event) {
  const exhibitors = new Map(
    directory(db, event)
      .filter((e) => e.boothId)
      .map((e) => [e.boothId, e]),
  );
  const booths = db.all('SELECT * FROM booths WHERE event_id = ? ORDER BY code', event.id);
  const gates = db.all('SELECT * FROM gates WHERE event_id = ? AND active = 1 ORDER BY code', event.id);
  const amenities = db.all('SELECT * FROM amenities WHERE event_id = ? ORDER BY id', event.id);
  return db.all('SELECT * FROM zones WHERE event_id = ? ORDER BY sort, id', event.id).map((z) => {
    const plan = json(z.plan, {});
    return {
      id: z.id,
      code: z.code,
      name: z.name,
      kind: z.kind,
      cols: plan.cols || 0,
      rows: plan.rows || 0,
      booths: booths
        .filter((b) => b.zone_id === z.id)
        .map((b) => {
          const ex = exhibitors.get(b.id);
          return {
            id: b.id,
            code: b.code,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            exhibitorId: ex?.id ?? null,
            exhibitor: ex?.name ?? null,
            categories: ex?.categories ?? [],
          };
        }),
      gates: gates.filter((g) => g.zone_id === z.id).map((g) => ({ id: g.id, code: g.code, name: g.name, x: g.x, y: g.y })),
      amenities: amenities
        .filter((a) => a.zone_id === z.id)
        .map((a) => ({ id: a.id, kind: a.kind, label: a.label, x: a.x, y: a.y, accessible: Boolean(a.accessible) })),
    };
  });
}

export function agenda(db, event) {
  const tracks = db.all('SELECT id, name, description FROM tracks WHERE event_id = ? ORDER BY sort, id', event.id);
  const rooms = db.all('SELECT id, name, capacity FROM rooms WHERE event_id = ? ORDER BY id', event.id);
  const sessions = db.all('SELECT * FROM agenda_sessions WHERE event_id = ? ORDER BY day, start_time, id', event.id).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    speakers: json(s.speakers, []),
    day: s.day,
    startTime: s.start_time,
    endTime: s.end_time,
    trackId: s.track_id,
    track: tracks.find((t) => t.id === s.track_id)?.name ?? null,
    roomId: s.room_id,
    room: rooms.find((r) => r.id === s.room_id)?.name ?? null,
    capacity: s.capacity,
    full: Boolean(s.capacity) && s.seats_taken >= s.capacity,
    status: s.status,
  }));
  return { tracks, rooms, sessions };
}

export function announcements(db, event, { displaysOnly = false } = {}) {
  return db
    .all(
      `SELECT id, kind, title, body, published_at FROM announcements
       WHERE event_id = ? AND published_at IS NOT NULL AND audience IN ('all','visitors') ${displaysOnly ? 'AND show_on_displays = 1' : ''}
       ORDER BY published_at DESC LIMIT 10`,
      event.id,
    )
    .map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, publishedAt: a.published_at }));
}

// Everything on the public landing page.
export function landing(db, event) {
  const settings = eventSettings(event);
  return {
    event: { ...eventSummary(event), description: event.description },
    accessibility: event.accessibility,
    faqs: json(event.faqs, []),
    passClasses: publicPassClasses(db, event),
    formFields: formFields(db, event.id),
    leadSharingNotice: settings.leadSharing.notice,
    features: settings.features,
    exhibitorCount: db.value(
      "SELECT COUNT(*) FROM exhibitors WHERE event_id = ? AND status = 'approved' AND profile_published = 1",
      event.id,
    ),
    sessionCount: db.value("SELECT COUNT(*) FROM agenda_sessions WHERE event_id = ? AND status = 'scheduled'", event.id),
    announcements: announcements(db, event),
  };
}

// The whole guide in one response, with a version the apps compare before re-downloading.
export function guide(db, event) {
  return {
    version: event.guide_version,
    updatedAt: event.updated_at,
    ...landing(db, event),
    exhibitors: directory(db, event),
    halls: mapData(db, event),
    agenda: agenda(db, event),
  };
}

// Read-only data for a venue display, with the kiosk's fixed "You are here" position.
export function displayData(db, event, kiosk) {
  const today = ymdIn(event.timezone);
  const now = hmIn(event.timezone);
  const all = agenda(db, event).sessions.filter((s) => s.status === 'scheduled');
  const todays = all.filter((s) => s.day === today);
  return {
    version: event.guide_version,
    updatedAt: event.updated_at,
    serverTime: new Date().toISOString(),
    event: eventSummary(event),
    kiosk: { code: kiosk.code, name: kiosk.name, mode: kiosk.mode, zoneId: kiosk.zone_id, x: kiosk.x, y: kiosk.y },
    halls: mapData(db, event),
    today,
    now: todays.filter((s) => s.startTime <= now && s.endTime > now),
    next: todays.filter((s) => s.startTime > now).slice(0, 6),
    announcements: announcements(db, event, { displaysOnly: true }),
  };
}
