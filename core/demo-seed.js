// Sample data for the demo and for `npm run seed:demo`. All people, clients and
// projects are fictional. Dates are relative to "today" so the demo always looks current.
import { DEFAULT_TEMPLATES } from './schema.js';
import { addDays } from './util.js';

export const DEMO_PASSWORD = 'demo1234';

export const DEMO_PEOPLE = [
  { key: 'rajiv', name: 'Rajiv Malhotra', title: 'Chief Executive Officer', role: 'admin', color: '#1f2b7b', access: {} },
  { key: 'arvind', name: 'Arvind Menon', title: 'Business Head – BrainADZ Live', color: '#e31b3b', access: { Live: 'manager' } },
  { key: 'ishita', name: 'Ishita Roy', title: 'Event Manager', color: '#ef4778', access: { Live: 'manager' } },
  { key: 'sneha_i', name: 'Sneha Iyer', title: 'Event Coordinator', color: '#f2a600', access: { Live: 'member' } },
  { key: 'sameer', name: 'Sameer Khan', title: 'Client Servicing Manager', color: '#0f766e', access: { Live: 'member' } },
  { key: 'vikram', name: 'Vikram Patel', title: 'Sales Manager', color: '#b45309', access: { Live: 'viewer', Exhibits: 'viewer' } },
  { key: 'kavita', name: 'Kavita Rao', title: 'Head of Marketing', color: '#1fb2d6', access: { Marketing: 'manager' } },
  { key: 'nandini', name: 'Nandini Joshi', title: 'Marketing Manager', color: '#7c5cfc', access: { Marketing: 'manager' } },
  { key: 'aarav', name: 'Aarav Mehta', title: 'Marketing Executive', color: '#1a6df0', access: { Marketing: 'member' } },
  { key: 'siddharth', name: 'Siddharth Menon', title: 'Creative Director', color: '#e31b3b', access: { Marketing: 'member', Live: 'member' } },
  { key: 'kavya', name: 'Kavya Singh', title: 'Graphic Designer', color: '#ef4778', access: { Marketing: 'member' } },
  { key: 'suresh', name: 'Suresh Iyer', title: 'Business Head – BrainADZ Exhibits', color: '#3c9a3a', access: { Exhibits: 'manager' } },
  { key: 'rohan', name: 'Rohan Das', title: 'Operations Lead', color: '#1f2b7b', access: { Exhibits: 'member' } },
  { key: 'neha', name: 'Neha Iyer', title: 'Project Coordinator', color: '#7c5cfc', access: { Exhibits: 'member' } },
  { key: 'tanvi', name: 'Tanvi Desai', title: 'Design Lead', color: '#1fa855', access: { Exhibits: 'member' } },
  { key: 'sneha_k', name: 'Sneha Kapoor', title: 'Exhibition Designer', color: '#f2a600', access: { Exhibits: 'member' } },
  { key: 'kunal', name: 'Kunal Verma', title: 'Operations Executive', color: '#0f766e', access: { Exhibits: 'member' } },
];

// Shown in the demo's "switch person" menu.
export const DEMO_ACCOUNTS = [
  { key: 'rajiv', label: 'Admin · all verticals' },
  { key: 'suresh', label: 'Exhibits manager' },
  { key: 'rohan', label: 'Exhibits team member' },
  { key: 'kavita', label: 'Marketing manager' },
  { key: 'arvind', label: 'Live manager' },
  { key: 'siddharth', label: 'Live + Marketing member' },
  { key: 'vikram', label: 'Viewer · Live and Exhibits' },
];

const emailOf = (name) => name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.') + '@brainadz.com';

const STAGE_PEOPLE = {
  Exhibits: { Brief: ['neha', 'rohan'], Design: ['tanvi', 'sneha_k'], Approval: ['neha', 'rohan'], Fabrication: ['kunal', 'rohan'], Installation: ['kunal', 'rohan'], Show: ['neha'], Dismantle: ['kunal'] },
  Live: { _: ['ishita', 'sneha_i', 'sameer', 'siddharth'] },
  Marketing: { Creative: ['siddharth', 'kavya'], Calendar: ['aarav'], Production: ['kavya', 'aarav'], _: ['nandini', 'aarav', 'kavya'] },
};

const FILES = {
  Exhibits: [
    ['Client brief – {client}.pdf', 'Brief', 'application/pdf', 820],
    ['Hall plan and stall location.pdf', 'Brief', 'application/pdf', 2400],
    ['Stall 3D render – front view v3.jpg', 'Design', 'image/jpeg', 3100],
    ['Stall 3D render – aerial v3.jpg', 'Design', 'image/jpeg', 2900],
    ['Backwall graphics artwork.ai', 'Design', 'application/postscript', 48000],
    ['BOQ and costing.xlsx', 'Quotes & Invoices', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 96],
    ['Signed purchase order.pdf', 'Contract & PO', 'application/pdf', 310],
    ['Fabrication drawings.dwg', 'Production', 'application/acad', 5200],
  ],
  ExhibitsFinal: [
    ['Final stall photos – day 1.jpg', 'Photos & Videos', 'image/jpeg', 4200],
    ['Final stall photos – night.jpg', 'Photos & Videos', 'image/jpeg', 3900],
    ['Show report and footfall.pdf', 'Reports', 'application/pdf', 1200],
  ],
  Live: [
    ['Event brief – {client}.pdf', 'Brief', 'application/pdf', 640],
    ['Concept deck v2.pptx', 'Design', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 18500],
    ['Stage design render.jpg', 'Design', 'image/jpeg', 2700],
    ['Costing sheet.xlsx', 'Quotes & Invoices', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 120],
    ['Venue agreement.pdf', 'Contract & PO', 'application/pdf', 540],
    ['Run of show and cue sheet.xlsx', 'Production', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 85],
  ],
  LiveFinal: [
    ['Event highlights – stage.jpg', 'Photos & Videos', 'image/jpeg', 3600],
    ['Aftermovie final.mp4', 'Final deliverables', 'video/mp4', 412000],
    ['Post-event report.pdf', 'Reports', 'application/pdf', 2200],
  ],
  Marketing: [
    ['Campaign brief – {client}.docx', 'Brief', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 210],
    ['Media plan.xlsx', 'Quotes & Invoices', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 140],
    ['Key visual – route A.jpg', 'Design', 'image/jpeg', 2300],
    ['Key visual – route B.jpg', 'Design', 'image/jpeg', 2100],
    ['Client approval email.pdf', 'Contract & PO', 'application/pdf', 180],
  ],
  MarketingFinal: [
    ['Key visual – final.jpg', 'Final deliverables', 'image/jpeg', 2600],
    ['Social adaptations pack.zip', 'Final deliverables', 'application/zip', 64000],
    ['Campaign performance report.pdf', 'Reports', 'application/pdf', 1700],
  ],
};

// [vertical, name, client, template index | null, key offset, status, health, owner, venue, city, budget, tags, extra]
const PROJECTS = [
  ['Exhibits', 'Pharma Expo stall, 72 sqm', 'Zenith Pharma', 0, 18, 'active', 'on_track', 'rohan', 'Bharat Mandapam, Hall 5', 'New Delhi', 1850000, 'pharma, island stall, repeat client'],
  ['Exhibits', 'Auto show pavilion', 'Northwind Motors', 1, 46, 'active', 'at_risk', 'neha', 'India Expo Mart', 'Greater Noida', 6500000, 'automotive, pavilion, double-decker'],
  ['Exhibits', 'Textile fair booth', 'Kaveri Textiles', 0, 9, 'active', 'off_track', 'rohan', 'Jio World Convention Centre', 'Mumbai', 950000, 'textiles, shell scheme upgrade'],
  ['Exhibits', 'Property show stall', 'Aurum Realty', 0, 75, 'planning', 'on_track', 'neha', 'HITEX Exhibition Centre', 'Hyderabad', 1200000, 'real estate'],
  ['Exhibits', 'Hospitality expo stall', 'Lotus Hotels', 0, 3, 'ready', 'on_track', 'neha', 'Bombay Exhibition Centre, Hall 1', 'Mumbai', 1350000, 'hospitality, cross-vertical client'],
  ['Exhibits', 'Pharma Expo stall, 72 sqm', 'Zenith Pharma', 0, -347, 'completed', 'on_track', 'rohan', 'Bharat Mandapam, Hall 5', 'New Delhi', 1720000, 'pharma, island stall'],
  ['Exhibits', 'Mobile congress booth', 'Bluepeak Telecom', 0, -205, 'completed', 'on_track', 'neha', 'Yashobhoomi (IICC)', 'New Delhi', 2400000, 'telecom, tech demo zones'],
  ['Exhibits', 'Food expo stall', 'Sahyadri Foods', 0, -118, 'completed', 'on_track', 'rohan', 'Bombay Exhibition Centre', 'Mumbai', 780000, 'fmcg, sampling counter'],

  ['Live', 'Annual dealer meet', 'Bluepeak Telecom', 0, 24, 'active', 'on_track', 'ishita', 'Coral Bay Resort', 'South Goa', 4200000, 'dealer meet, awards, 400 pax'],
  ['Live', '25th anniversary gala', 'Lotus Hotels', 0, 5, 'active', 'at_risk', 'ishita', 'Grand ballroom, Lotus Bandra', 'Mumbai', 3100000, 'gala, celebrity act'],
  ['Live', 'College fest tour, 5 cities', 'Monsoon Beverages', 1, 38, 'planning', 'on_track', 'sameer', 'Campus venues', 'Pune', 5600000, 'youth, sampling, tour'],
  ['Live', 'Leadership offsite', 'Indus Fintech', 0, 62, 'on_hold', 'on_track', 'sameer', 'Hill resort', 'Lonavala', 1500000, 'offsite, team building'],
  ['Live', 'New Year’s Eve gala', 'Lotus Hotels', 0, -287, 'completed', 'on_track', 'ishita', 'Grand ballroom, Lotus Bandra', 'Mumbai', 2800000, 'gala, countdown'],
  ['Live', 'SUV launch event', 'Northwind Motors', 0, -160, 'completed', 'on_track', 'arvind', 'NSCI Dome', 'Mumbai', 7800000, 'launch, media, projection mapping'],
  ['Live', 'Summer music night', 'Monsoon Beverages', 1, -96, 'cancelled', 'on_track', 'sameer', 'Palace Grounds', 'Bengaluru', 0, 'concert'],

  ['Marketing', 'Festive campaign (Diwali)', 'Sahyadri Foods', 0, 12, 'active', 'at_risk', 'nandini', 'TV, digital, OOH', 'Pan India', 2800000, 'festive, 360 campaign'],
  ['Marketing', 'App launch digital campaign', 'Indus Fintech', 0, 30, 'active', 'on_track', 'kavita', 'Meta, Google, YouTube', 'Pan India', 3500000, 'performance, app installs'],
  ['Marketing', 'Social media retainer – next month', 'Aurum Realty', 1, 19, 'active', 'on_track', 'aarav', 'Instagram, LinkedIn', 'Hyderabad', 180000, 'retainer, social'],
  ['Marketing', 'Brand refresh and website', 'Kaveri Textiles', null, 55, 'planning', 'on_track', 'siddharth', 'Brand identity', 'Mumbai', 1600000, 'branding, website'],
  ['Marketing', 'Festive campaign (Diwali)', 'Sahyadri Foods', 0, -353, 'completed', 'on_track', 'nandini', 'TV, digital, OOH', 'Pan India', 2500000, 'festive, 360 campaign'],
  ['Marketing', 'Doctor engagement webinar series', 'Zenith Pharma', 0, -140, 'completed', 'on_track', 'kavita', 'Webinars + email', 'Pan India', 900000, 'pharma, b2b'],
];

const DESCRIPTIONS = {
  'Pharma Expo stall, 72 sqm': 'Island stall with a product display wall, two meeting pods and a 12-seat presentation corner. Client wants the same footprint as last year with a fresher look and better storage.',
  'Auto show pavilion': '1,200 sqm double-decker pavilion with a turntable for the new EV, an experience zone and a lounge on the upper deck. Organiser structural approval is on the critical path.',
  'Textile fair booth': 'Upgraded shell-scheme booth with fabric draping wall, sample racks and a buyer meeting table.',
  'Property show stall': 'Stall with a scale model of the new township, two sales desks and a VR walkthrough station.',
  'Hospitality expo stall': '54 sqm stall with a live chef counter, a suite mock-up and a lounge for buyer meetings. Built, checked and handed over; waiting for the show to open.',
  'Mobile congress booth': '5G demo zones, an IoT wall and a partner theatre.',
  'Food expo stall': 'Live sampling counter and retail shelf mock-up.',
  'Annual dealer meet': 'Two-day dealer meet for 400 guests: business sessions on day 1, awards night with a live band, and a beach party on day 2.',
  '25th anniversary gala': 'Black-tie gala for 600 guests with a celebrity performance, heritage film and a 25-year retrospective installation in the foyer.',
  'College fest tour, 5 cities': 'Sampling and stage activation at five college fests: Pune, Indore, Jaipur, Chandigarh and Kochi.',
  'Leadership offsite': 'Three-day offsite for 60 leaders. Paused while the client finalises its budget for next quarter.',
  'Festive campaign (Diwali)': '360 campaign for the festive sweets range: 30s TVC, digital video, social, and OOH in eight metros.',
  'App launch digital campaign': 'Performance campaign for the new investing app. Target: 2 lakh installs in the first 30 days at under ₹90 CPI.',
  'Social media retainer – next month': 'Monthly calendar of 16 posts and 4 reels for the township launch.',
  'Brand refresh and website': 'New logo, brand guidelines and a six-page website for the textiles brand.',
};

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ts = (date, h = 10, m = 0) => `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

export function seedDemo(db, { today, passwordHash }) {
  if (db.get('SELECT COUNT(*) AS n FROM projects').n > 0) return false;
  const rand = rng(20261013);
  const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];
  const vByShort = Object.fromEntries(db.all('SELECT * FROM verticals').map((v) => [v.short, v]));
  const tplByV = {};
  for (const t of db.all('SELECT * FROM templates ORDER BY id')) (tplByV[t.vertical_id] ||= []).push(t);

  db.tx(() => {
    // People
    const ids = {};
    db.run("UPDATE settings SET value = 'BrainADZ' WHERE key = 'company_name'");
    for (const p of DEMO_PEOPLE) {
      const existing = db.get('SELECT id FROM users WHERE email = ?', emailOf(p.name));
      const { id } = existing
        ? { id: existing.id }
        : db.run(
          'INSERT INTO users (name, email, password_hash, role, title, color, active, created_at) VALUES (?,?,?,?,?,?,1,?)',
          p.name, emailOf(p.name), passwordHash, p.role || 'member', p.title, p.color, ts(addDays(today, -400)),
        );
      ids[p.key] = id;
      for (const [short, level] of Object.entries(p.access)) {
        if (vByShort[short]) db.run('INSERT OR REPLACE INTO user_verticals (user_id, vertical_id, level) VALUES (?,?,?)', id, vByShort[short].id, level);
      }
    }

    const counters = {};
    const commentsFor = [];
    PROJECTS.forEach((row, idx) => {
      const [short, name, client, tplIndex, keyOffset, status, health, ownerKey, venue, city, budget, tags] = row;
      const v = vByShort[short];
      if (!v) return;
      const keyDate = addDays(today, keyOffset);
      const tpl = tplIndex === null ? null : (tplByV[v.id] || [])[tplIndex];
      const tplData = tpl
        ? { stages: JSON.parse(tpl.stages), tasks: JSON.parse(tpl.tasks), milestones: JSON.parse(tpl.milestones) }
        : {
          stages: ['Discovery', 'Identity', 'Website', 'Handover'],
          tasks: [
            { title: 'Discovery workshop with founders', stage: 'Discovery', offset: -48, priority: 'high' },
            { title: 'Competitor and category audit', stage: 'Discovery', offset: -44 },
            { title: 'Logo routes (3 options)', stage: 'Identity', offset: -34, priority: 'high' },
            { title: 'Brand guidelines document', stage: 'Identity', offset: -24 },
            { title: 'Sitemap and wireframes', stage: 'Website', offset: -20 },
            { title: 'Website design and build', stage: 'Website', offset: -8 },
            { title: 'Handover and training', stage: 'Handover', offset: 0 },
          ],
          milestones: [{ title: 'Logo approved', offset: -30 }, { title: 'Website live', offset: 0 }],
        };
      const anchorTasks = tplData.tasks;
      const firstOffset = Math.min(...anchorTasks.map((t) => t.offset), -30);
      const startDate = addDays(keyDate, firstOffset - 3);
      const lastOffset = Math.max(...anchorTasks.map((t) => t.offset), 0);
      const dueDate = addDays(keyDate, Math.max(lastOffset, 1));
      const yy = startDate.slice(2, 4);
      const prefix = `${v.code}-${yy}`;
      counters[prefix] = (counters[prefix] || 0) + 1;
      const code = `${prefix}-${String(counters[prefix] + 3).padStart(3, '0')}`;
      const closed = status === 'completed' || status === 'cancelled';
      // Planned projects can start in the future, but they were set up in the past.
      const createdDay = addDays(startDate, -2) < addDays(today, -3) ? addDays(startDate, -2) : addDays(today, -6 - (idx % 5));
      const createdAt = ts(createdDay, 11, 15);
      const completedAt = status === 'completed' ? ts(addDays(dueDate, 2), 18, 0) : null;

      // Tasks
      const people = STAGE_PEOPLE[short];
      const team = new Set([ids[ownerKey]]);
      const taskRows = anchorTasks.map((t, i) => {
        const due = addDays(keyDate, t.offset);
        let st = 'todo';
        if (status === 'completed') st = 'done';
        else if (status === 'cancelled') st = due < today ? 'done' : 'todo';
        else if (status === 'ready') st = t.offset < 0 ? 'done' : 'todo';
        else if (due < addDays(today, -1)) st = 'done';
        else if (due <= addDays(today, 4)) st = rand() < 0.6 ? 'in_progress' : 'review';
        if (status === 'on_hold' && st !== 'done') st = 'todo';
        const pool = people[t.stage] || people._ || [ownerKey];
        const assignee = ids[pool[(i + idx) % pool.length]];
        team.add(assignee);
        return { ...t, due, status: st, assignee, sort: i + 1 };
      });
      // Problem projects keep a few late tasks open.
      if (!closed && health !== 'on_track') {
        const late = taskRows.filter((t) => t.status === 'done' && t.due >= addDays(today, -12)).slice(-2);
        late.forEach((t, i) => { t.status = i === 0 ? 'blocked' : 'in_progress'; });
      }
      const firstOpen = taskRows.find((t) => t.status !== 'done');
      const stage = closed ? tplData.stages[tplData.stages.length - 1] : firstOpen?.stage || tplData.stages[0];

      const { id: pid } = db.run(
        `INSERT INTO projects (code, vertical_id, name, client, description, status, health, priority, stages, stage, owner_id, start_date, due_date, key_date,
          venue, city, budget, tags, template_id, completed_at, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        code, v.id, name, client, DESCRIPTIONS[name] || '', status, health,
        keyOffset >= 0 && keyOffset < 15 ? 'high' : health === 'at_risk' ? 'high' : 'medium',
        JSON.stringify(tplData.stages), stage, ids[ownerKey], startDate, dueDate, keyDate, venue, city, budget || null, tags,
        tpl?.id ?? null, completedAt, ids[short === 'Exhibits' ? 'suresh' : short === 'Live' ? 'arvind' : 'kavita'], createdAt, createdAt,
      );
      db.run(
        'INSERT INTO activity (project_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)',
        pid, ids[short === 'Exhibits' ? 'suresh' : short === 'Live' ? 'arvind' : 'kavita'], 'created', tpl ? `From template “${tpl.name}”` : '', createdAt,
      );

      for (const t of taskRows) {
        const completed = t.status === 'done' ? ts(t.due < today ? addDays(t.due, rand() < 0.7 ? 0 : -1) : today, 12 + Math.floor(rand() * 6), Math.floor(rand() * 59)) : null;
        const checklist = /render|design|artwork|key visual/i.test(t.title)
          ? [{ text: 'Share draft internally', done: t.status !== 'todo' }, { text: 'Client feedback incorporated', done: t.status === 'done' }, { text: 'Upload final files', done: t.status === 'done' }]
          : [];
        const { id: tid } = db.run(
          `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, assigned_at, assigned_by, stage, start_date, due_date, checklist, sort, created_by, created_at, updated_at, completed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          pid, t.title, '', t.status, t.priority || 'medium', t.assignee, createdAt, ids[ownerKey], t.stage, null, t.due, JSON.stringify(checklist), t.sort,
          ids[ownerKey], createdAt, completed || createdAt, completed,
        );
        if (completed) db.run('INSERT INTO activity (project_id, task_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?,?)', pid, tid, t.assignee, 'task_done', `${t.title} → Done`, completed);
        if (t.status === 'blocked') commentsFor.push({ pid, tid, short, title: t.title, ownerKey, assignee: t.assignee, kind: 'blocked' });
        else if (t.status === 'in_progress' && t.due < today) commentsFor.push({ pid, tid, short, title: t.title, ownerKey, assignee: t.assignee, kind: 'late' });
      }
      for (const [i, m] of tplData.milestones.entries()) {
        const due = addDays(keyDate, m.offset);
        const done = closed ? status === 'completed' : status === 'ready' ? m.offset < 0 : due < today;
        db.run('INSERT INTO milestones (project_id, title, due_date, done, done_at, sort) VALUES (?,?,?,?,?,?)', pid, m.title, due, done ? 1 : 0, done ? ts(due, 17) : null, i + 1);
      }
      for (const uid of team) db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', pid, uid);

      // Files
      const fileSet = [...FILES[short]];
      if (status === 'completed') fileSet.push(...FILES[short + 'Final']);
      const keep = closed ? fileSet.length : Math.max(3, Math.round(fileSet.length * (taskRows.filter((t) => t.status === 'done').length / taskRows.length + 0.25)));
      fileSet.slice(0, keep).forEach(([fname, category, mime, kb], i) => {
        const uploader = pickOne([...team]);
        const planned = closed ? addDays(startDate, Math.round(((i + 1) / fileSet.length) * (daysBetweenSafe(startDate, dueDate)))) : addDays(startDate, i * 4 + 1);
        const at = planned < addDays(today, -3) ? planned : addDays(today, -3 - (i % 3));
        const isFinal = closed && /Final|report|photos|highlights|Aftermovie/i.test(fname) ? 1 : 0;
        db.run(
          `INSERT INTO files (project_id, kind, name, mime, size, category, storage_key, is_final, note, uploaded_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          pid, 'file', fname.replace('{client}', client), mime, Math.round(kb * 1024 * (0.8 + rand() * 0.4)), category, `sample:${pid}-${i}`,
          isFinal, '', uploader, ts(at < today ? at : today, 10 + (i % 7), (i * 13) % 60),
        );
        if (!closed) db.run('INSERT INTO activity (project_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)', pid, uploader, 'file_added', fname.replace('{client}', client), ts(at < today ? at : today, 10 + (i % 7), (i * 13) % 60));
      });
      db.run(
        `INSERT INTO files (project_id, kind, name, url, category, is_final, note, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        pid, 'link', `Shared drive folder – ${code}`, `https://drive.google.com/drive/folders/${code.toLowerCase()}`, 'Other', 0,
        'All working files, raw photos and vendor quotes', ids[ownerKey], createdAt,
      );
      if (!closed) commentsFor.push({ pid, short, ownerKey, client, name, kind: 'project', keyOffset });
    });

    // Conversations
    const say = (pid, who, body, date, tid = null) => {
      db.run('INSERT INTO comments (project_id, task_id, user_id, body, created_at) VALUES (?,?,?,?,?)', pid, tid, ids[who] || who, body, date);
    };
    for (const c of commentsFor) {
      const head = { Exhibits: 'suresh', Live: 'arvind', Marketing: 'kavita' }[c.short];
      if (c.kind === 'blocked' || c.kind === 'late') {
        const asker = ids[c.ownerKey] === c.assignee ? head : c.ownerKey;
        say(c.pid, asker, c.kind === 'blocked'
          ? `This is holding up the next stage. What do we need from the client to unblock “${c.title}”?`
          : `“${c.title}” is past its date. Can we still make the next milestone?`, ts(addDays(today, -2), 11, 20), c.tid);
        say(c.pid, c.assignee, c.kind === 'blocked'
          ? 'Waiting on their final sign-off. I have followed up by email and will call them tomorrow morning.'
          : 'Yes, two more days. The vendor delivered late but we are back on it.', ts(addDays(today, -1), 16, 5), c.tid);
        continue;
      }
      if (c.short === 'Exhibits') {
        say(c.pid, 'neha', `Organiser confirmed our stall number and power load for ${c.client}. Hall plan is in Files.`, ts(addDays(today, -6), 10, 40));
        const day = c.client === 'Zenith Pharma' ? -1 : -4; // only the Pharma Expo chat is from yesterday
        say(c.pid, 'tanvi', '@Rohan render v3 is uploaded. Client asked for a bigger logo on the backwall, updating today.', ts(addDays(today, day), 15, 10));
        say(c.pid, 'rohan', 'Thanks Tanvi. Workshop needs final drawings by Friday to hold the fabrication slot.', ts(addDays(today, day), 17, 45));
      } else if (c.short === 'Live') {
        say(c.pid, 'ishita', 'Venue walkthrough done. Ballroom height allows the LED wall we planned, rigging points marked on the layout.', ts(addDays(today, -5), 12, 0));
        say(c.pid, 'sameer', `${c.client} wants the guest list frozen a week before. Shared the RSVP tracker with their admin team.`, ts(addDays(today, -2), 16, 20));
      } else if (/campaign/i.test(c.name)) {
        say(c.pid, 'kavita', 'Route B tested better in the quick poll. Let’s take it forward and keep route A as backup.', ts(addDays(today, -4), 11, 30));
        say(c.pid, 'aarav', 'Media plan v2 uploaded with the revised OOH split.', ts(addDays(today, -1), 14, 50));
      } else if (/retainer/i.test(c.name)) {
        say(c.pid, 'aarav', `${c.client} approved 12 of the 16 posts. Four need new photos from the site visit.`, ts(addDays(today, -3), 12, 10));
        say(c.pid, 'kavya', 'I can shoot those on Thursday when we are at the site for the reels.', ts(addDays(today, -2), 10, 45));
      } else {
        say(c.pid, 'siddharth', `Kick-off with ${c.client} is booked. I will share the discovery questionnaire before the workshop.`, ts(addDays(today, -2), 15, 0));
      }
    }

    // One comment waiting for a head to approve its deletion.
    const zenith = db.get("SELECT id, code FROM projects WHERE client = 'Zenith Pharma' AND status = 'active' LIMIT 1");
    if (zenith) {
      const at = ts(addDays(today, -1), 12, 5);
      db.run(
        "INSERT INTO comments (project_id, user_id, body, created_at, delete_status, delete_requested_at) VALUES (?,?,?,?, 'requested', ?)",
        zenith.id, ids.rohan, 'Flooring quote from the vendor is ₹4,80,000 including the raised platform.', at, ts(addDays(today, -1), 12, 9),
      );
      db.run('INSERT INTO comments (project_id, user_id, body, created_at) VALUES (?,?,?,?)', zenith.id, ids.rohan,
        'Correction: that flooring quote was for the Kaveri stall, not this one. I have asked to delete it.', ts(addDays(today, -1), 12, 8));
      for (const head of ['suresh', 'rajiv']) {
        db.run('INSERT INTO notifications (user_id, project_id, text, read, created_at) VALUES (?,?,?,0,?)', ids[head], zenith.id,
          `Rohan Das asks to delete a comment in ${zenith.code}: “Flooring quote from the vendor is ₹4,80,000…”`, ts(addDays(today, -1), 12, 9));
      }
    }

    // Everyone last looked two days ago, so the last two days of activity shows as new.
    const lastLook = ts(addDays(today, -2), 18, 0);
    const projectIds = db.all('SELECT id FROM projects').map((r) => r.id);
    for (const uid of Object.values(ids)) {
      db.run('INSERT OR REPLACE INTO seen (user_id, scope, seen_at) VALUES (?,?,?)', uid, 'mywork', lastLook);
      for (const pid of projectIds) {
        for (const tab of ['tasks', 'files', 'discussion']) db.run('INSERT OR REPLACE INTO seen (user_id, scope, seen_at) VALUES (?,?,?)', uid, `project:${pid}:${tab}`, lastLook);
      }
    }
    // A handful of tasks were handed over yesterday, so My Work has something new.
    const handover = db.all(
      `SELECT t.id, t.project_id, t.title, p.owner_id, p.code FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.status = 'todo' AND p.status IN ('active','planning') AND t.assignee_id IS NOT NULL AND t.assignee_id != p.owner_id ORDER BY t.due_date LIMIT 8`,
    );
    for (const t of handover) db.run('UPDATE tasks SET assigned_at = ?, assigned_by = ? WHERE id = ?', ts(addDays(today, -1), 15, 30), t.owner_id, t.id);
    // New tasks added yesterday on two live projects, so their Tasks tabs show red.
    for (const client of ['Zenith Pharma', 'Sahyadri Foods', 'Lotus Hotels']) {
      const p = db.get("SELECT id, owner_id, stage, vertical_id FROM projects WHERE client = ? AND status IN ('active','ready') ORDER BY id LIMIT 1", client);
      if (!p) continue;
      const short = db.get('SELECT short FROM verticals WHERE id = ?', p.vertical_id)?.short;
      const head = { Exhibits: ids.suresh, Marketing: ids.kavita, Live: ids.arvind }[short] || ids.rajiv;
      const added = ts(addDays(today, -1), 11, 40);
      db.run(
        `INSERT INTO tasks (project_id, title, status, priority, assignee_id, assigned_at, assigned_by, stage, due_date, sort, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p.id, 'Client asked for a revised quote with GST breakup', 'todo', 'high', p.owner_id, added, head, p.stage, addDays(today, 3), 99, head, added, added,
      );
      db.run('INSERT INTO activity (project_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)', p.id, head, 'task_added', 'Client asked for a revised quote with GST breakup', added);
    }

    // Tanvi uploaded a revised render yesterday, so the Files tab shows something new.
    const zen = db.get("SELECT id FROM projects WHERE client = 'Zenith Pharma' AND status IN ('active','ready') LIMIT 1");
    if (zen) {
      const at = ts(addDays(today, -1), 15, 5);
      db.run(
        `INSERT INTO files (project_id, kind, name, mime, size, category, storage_key, is_final, note, uploaded_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        zen.id, 'file', 'Stall 3D render – bigger logo v4.jpg', 'image/jpeg', 3300000, 'Design', `sample:${zen.id}-v4`, 0, 'Logo enlarged as the client asked', ids.tanvi, at,
      );
      db.run('INSERT INTO activity (project_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)', zen.id, ids.tanvi, 'file_added', 'Stall 3D render – bigger logo v4.jpg', at);
    }

    // A few unread notifications per demo account
    const notes = db.all(
      `SELECT t.id, t.title, t.project_id, t.assignee_id, p.code FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.status != 'done' AND p.status IN ('planning','active','on_hold') AND t.assignee_id IS NOT NULL ORDER BY t.due_date LIMIT 40`,
    );
    for (const n of notes.slice(0, 30)) {
      db.run('INSERT INTO notifications (user_id, project_id, task_id, text, read, created_at) VALUES (?,?,?,?,?,?)',
        n.assignee_id, n.project_id, n.id, `Due soon: “${n.title}” in ${n.code}`, 0, ts(addDays(today, -1), 9, 0));
    }
    for (const mgr of ['rajiv', 'suresh', 'kavita', 'arvind']) {
      const p = db.get(
        `SELECT p.id, p.code, p.name FROM projects p WHERE p.health != 'on_track' AND p.status IN ('active','planning') ${mgr === 'rajiv' ? '' : 'AND p.vertical_id IN (SELECT vertical_id FROM user_verticals WHERE user_id = ?)'} ORDER BY p.id LIMIT 1`,
        ...(mgr === 'rajiv' ? [] : [ids[mgr]]),
      );
      if (p) db.run('INSERT INTO notifications (user_id, project_id, text, read, created_at) VALUES (?,?,?,?,?)', ids[mgr], p.id, `${p.code} · ${p.name} is flagged as needing attention`, 0, ts(today, 9, 30));
    }
  });
  return true;
}

function daysBetweenSafe(a, b) {
  return Math.max(1, Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000));
}

export function demoEmail(key) {
  const p = DEMO_PEOPLE.find((x) => x.key === key);
  return p ? emailOf(p.name) : null;
}

export { DEFAULT_TEMPLATES };
