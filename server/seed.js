// Demo data for BrainADZ HRMS. Deterministic (seeded PRNG) but anchored to
// "today", so dashboards always look current. All people are fictional.
import { hashPassword } from './auth.js';
import { setSetting, DEFAULT_SETTINGS, fullName } from './core.js';
import * as D from './lib/dates.js';
import { estimateMonthlyTds } from './lib/payroll.js';
import { countLeaveDays } from './lib/leave.js';
import { calendarCtx } from './services/calendar.js';
import { processRun } from './services/payroll.js';
import { heuristicScreen } from './lib/screener.js';
import { syncAttendance, generateShortfalls, approverUserIds, fmtMinutes, dayLabel } from './services/workday.js';
import { textPdf } from './lib/pdf.js';
import { distanceM } from './services/geofence.js';

export const DEMO_PASSWORD = 'Brainadz@2026';
export const DEMO_ACCOUNTS = [
  { email: 'priya.sharma@brainadz.com', role: 'hr', label: 'HR Manager' },
  { email: 'rajiv.malhotra@brainadz.com', role: 'admin', label: 'CEO · Admin' },
  { email: 'vikram.patel@brainadz.com', role: 'manager', label: 'Sales Manager' },
  { email: 'aarav.mehta@brainadz.com', role: 'employee', label: 'Employee' },
];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERTICALS = [
  { name: 'BrainADZ Live', short: 'Live', tagline: 'From Vision to Visibility', color: '#E5243B' },
  { name: 'BrainADZ Marketing', short: 'Marketing', tagline: 'Ideas That Spark Momentum', color: '#1FB2D6' },
  { name: 'BrainADZ Exhibits', short: 'Exhibits', tagline: 'Where Elegance Meets Execution', color: '#8CC63F' },
  { name: 'Corporate', short: 'Corporate', tagline: 'Shared services', color: '#7C5CFC' },
];
const DEPARTMENTS = ['Leadership', 'Sales', 'Events', 'Client Servicing', 'Marketing', 'Creative', 'Technology', 'Operations', 'Design', 'Business Development', 'HR', 'Finance', 'IT', 'Admin'];
const LOCATIONS = ['Bengaluru', 'Mumbai', 'Delhi NCR'];

export const LEAVE_TYPES = [
  { code: 'EL', name: 'Earned Leave', annual_quota: 20, accrual: 'monthly', carry_forward_max: 5, color: '#2F6FED', icon: 'calendar', rule: 'Accrued monthly · Carry forward up to 5 days' },
  { code: 'CL', name: 'Casual Leave', annual_quota: 12, color: '#22B05B', icon: 'palm', rule: '12 days/year · No carry forward' },
  { code: 'SL', name: 'Sick Leave', annual_quota: 10, color: '#F0457A', icon: 'cross', rule: 'Medical certificate after 3 days' },
  { code: 'ML', name: 'Maternity Leave', annual_quota: 182, calendar_days: 1, gender: 'F', color: '#8B5CF6', icon: 'baby', rule: '26 weeks as per the Maternity Benefit Act' },
  { code: 'PL', name: 'Paternity Leave', annual_quota: 15, gender: 'M', color: '#1BA7E0', icon: 'user', rule: 'To be availed within 6 months of birth' },
  { code: 'WFH', name: 'Work From Home', annual_quota: 30, kind: 'wfh', color: '#F5B400', icon: 'home', rule: 'Manager approval required' },
  { code: 'LOP', name: 'Loss of Pay', annual_quota: null, paid: 0, color: '#6B7A90', icon: 'ban', rule: 'Unpaid · deducted in payroll' },
];

export function holidaysFor(year) {
  const list = [
    [`${year}-01-14`, 'Makar Sankranti / Pongal', 'Restricted'],
    [`${year}-01-26`, 'Republic Day', 'Company'],
    [`${year}-05-01`, 'Labour Day', 'Company'],
    [`${year}-08-15`, 'Independence Day', 'Company'],
    [`${year}-10-02`, 'Gandhi Jayanti', 'Company'],
    [`${year}-12-25`, 'Christmas', 'Company'],
  ];
  // Festival dates move every year; only 2026 is pre-filled. Add the rest in Leave & Policies.
  if (year === 2026) {
    list.push(['2026-03-04', 'Holi', 'Company'], ['2026-03-20', 'Eid ul-Fitr', 'Restricted'], ['2026-04-03', 'Good Friday', 'Restricted'],
      ['2026-09-14', 'Ganesh Chaturthi', 'Company'], ['2026-10-20', 'Dussehra', 'Company'], ['2026-11-08', 'Diwali', 'Company'],
      ['2026-11-09', 'Govardhan Puja', 'Restricted']);
  }
  return list;
}

const MALE = ['Aarav', 'Vihaan', 'Rohan', 'Karan', 'Siddharth', 'Nikhil', 'Varun', 'Amit', 'Mohit', 'Tanmay', 'Harsh', 'Pranav', 'Yash', 'Akash', 'Deepak', 'Gaurav', 'Abhishek', 'Ankit', 'Sahil', 'Kabir', 'Dev', 'Ishaan', 'Naveen', 'Rahul', 'Ravi', 'Sanjay', 'Tarun', 'Aman', 'Jatin', 'Lokesh'];
const FEMALE = ['Divya', 'Aditi', 'Ishita', 'Nikita', 'Riya', 'Shreya', 'Sanya', 'Kritika', 'Aishwarya', 'Swati', 'Pallavi', 'Shruti', 'Komal', 'Simran', 'Anjali', 'Megha', 'Lakshmi', 'Radhika', 'Sakshi', 'Tara', 'Bhavna', 'Charu', 'Esha', 'Gauri', 'Harini', 'Jyoti', 'Madhu', 'Payal', 'Rashmi', 'Sonal'];
const LAST = ['Sharma', 'Patel', 'Mehta', 'Kapoor', 'Nair', 'Iyer', 'Rao', 'Das', 'Khan', 'Verma', 'Reddy', 'Joshi', 'Kulkarni', 'Menon', 'Malhotra', 'Bhat', 'Arora', 'Shetty', 'Pillai', 'Chopra', 'Gupta', 'Agarwal', 'Bose', 'Banerjee', 'Mishra', 'Pandey', 'Saxena', 'Desai', 'Shah', 'Jain', 'Thomas', 'Fernandes', 'Sinha', 'Ghosh', 'Naidu', 'Hegde'];

const SKILLS = {
  Leadership: ['Strategy', 'Leadership', 'P&L Management', 'Business Development', 'Stakeholder Management'],
  Sales: ['B2B Sales', 'Negotiation', 'CRM', 'Client Relationship', 'Lead Generation'],
  Events: ['Event Management', 'Vendor Management', 'Logistics', 'On-ground Execution', 'Budgeting'],
  'Client Servicing': ['Account Management', 'Client Communication', 'Presentation', 'Project Coordination'],
  Marketing: ['Digital Marketing', 'Content Strategy', 'Social Media', 'Brand Management', 'Campaign Analytics', 'SEO', 'Google Ads'],
  Creative: ['Photoshop', 'Illustrator', 'Copywriting', 'Storytelling', 'Video Editing', 'Figma'],
  Technology: ['React', 'JavaScript', 'TypeScript', 'Node.js', 'HTML', 'CSS', 'Redux', 'SQL'],
  Operations: ['Project Management', 'Vendor Management', 'Fabrication', 'Site Supervision', 'AutoCAD'],
  Design: ['3ds Max', 'AutoCAD', 'SketchUp', 'Photoshop', 'Spatial Design'],
  'Business Development': ['B2B Sales', 'Lead Generation', 'Proposal Writing', 'Negotiation', 'CRM'],
  HR: ['Talent Acquisition', 'Employee Engagement', 'HR Operations', 'Payroll', 'Labour Law'],
  Finance: ['Accounting', 'Tally', 'GST', 'Financial Analysis', 'Excel'],
  IT: ['Networking', 'Windows Server', 'IT Support', 'Cloud', 'Security'],
  Admin: ['Facilities', 'Procurement', 'Vendor Management', 'Travel Desk'],
};
const CERTS = {
  Marketing: [['Google Ads Certification', 'Google'], ['HubSpot Inbound Marketing', 'HubSpot'], ['Meta Blueprint', 'Meta']],
  Technology: [['AWS Cloud Practitioner', 'Amazon Web Services'], ['Meta Front-End Developer', 'Meta']],
  HR: [['SHRM-CP', 'SHRM']],
  Events: [['Certified Event Planner', 'EEMA']],
  Creative: [['Adobe Certified Professional', 'Adobe']],
};

const TEAMS = [
  { v: 'Live', d: 'Sales', lead: ['Vikram', 'Patel', 'M', 'Sales Manager'], named: [['Arjun', 'Nair', 'M', 'Business Development Executive']], titles: ['Sales Executive', 'Senior Sales Executive', 'Business Development Executive', 'Key Account Executive'], n: 8 },
  { v: 'Live', d: 'Events', lead: ['Ishita', 'Roy', 'F', 'Event Manager'], named: [['Sneha', 'Iyer', 'F', 'Event Coordinator']], titles: ['Event Coordinator', 'Event Executive', 'Production Executive', 'Logistics Coordinator'], n: 8 },
  { v: 'Live', d: 'Client Servicing', lead: ['Sameer', 'Khan', 'M', 'Client Servicing Manager'], named: [], titles: ['Account Manager', 'Client Servicing Executive', 'Senior Account Executive'], n: 5 },
  { v: 'Marketing', d: 'Marketing', lead: ['Nandini', 'Joshi', 'F', 'Marketing Manager'], named: [['Aarav', 'Mehta', 'M', 'Marketing Executive'], ['Pooja', 'Nair', 'F', 'Social Media Executive']], titles: ['Marketing Executive', 'Digital Marketing Specialist', 'SEO Analyst', 'Performance Marketer'], n: 8 },
  { v: 'Marketing', d: 'Creative', lead: ['Siddharth', 'Menon', 'M', 'Creative Director'], named: [['Kavya', 'Singh', 'F', 'Graphic Designer'], ['Ritik', 'Malhotra', 'M', 'Content Writer'], ['Ananya', 'Singh', 'F', 'Copywriter']], titles: ['Graphic Designer', 'Content Writer', 'Video Editor', 'Content Strategist'], n: 8 },
  { v: 'Marketing', d: 'Technology', lead: ['Aditya', 'Rao', 'M', 'Product Manager'], named: [['Rohit', 'Verma', 'M', 'Senior Software Engineer']], titles: ['Frontend Developer', 'Backend Developer', 'QA Engineer', 'UI/UX Designer'], n: 6 },
  { v: 'Exhibits', d: 'Operations', lead: ['Rohan', 'Das', 'M', 'Operations Lead'], named: [['Kunal', 'Verma', 'M', 'Operations Executive'], ['Neha', 'Iyer', 'F', 'Project Coordinator'], ['Kavya', 'Nair', 'F', 'Operations Executive']], titles: ['Operations Executive', 'Site Supervisor', 'Fabrication Coordinator', 'Project Coordinator'], n: 8 },
  { v: 'Exhibits', d: 'Design', lead: ['Tanvi', 'Desai', 'F', 'Design Lead'], named: [['Sneha', 'Kapoor', 'F', 'Exhibition Designer']], titles: ['Exhibition Designer', '3D Visualizer', 'Graphic Designer'], n: 6 },
  { v: 'Exhibits', d: 'Business Development', lead: ['Varun', 'Shetty', 'M', 'Business Development Manager'], named: [], titles: ['Business Development Executive', 'Sales Executive'], n: 5 },
  { v: 'Corporate', d: 'HR', lead: ['Priya', 'Sharma', 'F', 'HR Manager'], named: [['Neha', 'Kapoor', 'F', 'HR Specialist']], titles: ['HR Executive', 'Talent Acquisition Specialist'], n: 4 },
  { v: 'Corporate', d: 'Finance', lead: ['Neha', 'Bansal', 'F', 'Finance Manager'], named: [['Meera', 'Khan', 'F', 'Finance Analyst'], ['Vikram', 'Singh', 'M', 'Accounts Executive']], titles: ['Accounts Executive', 'Payroll Specialist'], n: 4 },
  { v: 'Corporate', d: 'IT', lead: ['Ritesh', 'Kumar', 'M', 'IT Manager'], named: [], titles: ['IT Support Engineer', 'System Administrator'], n: 3 },
  { v: 'Corporate', d: 'Admin', lead: ['Manish', 'Pandey', 'M', 'Admin Manager'], named: [], titles: ['Admin Executive', 'Facilities Coordinator'], n: 2 },
];
const HEADS = {
  Live: ['Arvind', 'Menon', 'M', 'Business Head – BrainADZ Live'],
  Marketing: ['Kavita', 'Rao', 'F', 'Head of Marketing'],
  Exhibits: ['Suresh', 'Iyer', 'M', 'Business Head – BrainADZ Exhibits'],
};
const JUNIOR = ['Facilities Coordinator', 'Site Supervisor', 'Admin Executive', 'Logistics Coordinator', 'Production Executive'];
const BANKS = [['HDFC Bank', 'HDFC'], ['ICICI Bank', 'ICIC'], ['State Bank of India', 'SBIN'], ['Axis Bank', 'UTIB'], ['Kotak Mahindra Bank', 'KKBK']];
const COMPANIES = ['Infosys', 'TCS', 'Wipro', 'Zoho', 'Accenture', 'Ogilvy', 'DDB Mudra', 'Dentsu', 'Wizcraft', 'Percept', 'Publicis', 'Havas', 'Leo Burnett', 'Flipkart', 'Swiggy', 'Razorpay', 'Freshworks', 'PeopleStrong', 'Cvent', 'Mindtree', 'Madison World', 'Encompass Events'];
const INSTITUTES = ['NIT Trichy', 'Pune University', 'DU', 'Anna University', 'VIT', 'Christ University', 'Mumbai University', 'NIFT Delhi', 'MICA Ahmedabad', 'Symbiosis Pune', 'Manipal University', 'IIT Bombay', 'BITS Pilani', 'Osmania University'];

export function seedDemo(db, { today, saveFile = null } = {}) {
  const T = today || D.todayIn('Asia/Kolkata');
  const rand = mulberry32(20261012);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const chance = (p) => rand() < p;
  const thisMonth = D.monthOf(T);
  const isoAt = (d, hm = '10:00') => new Date(`${d}T${hm}:00+05:30`).toISOString();
  const workday = (d, dir = 1) => {
    let x = d;
    while ([0, 6].includes(D.dow(x))) x = D.addDays(x, dir);
    return x;
  };

  db.tx(() => {
    // ---------- settings & masters ----------
    setSetting(db, 'companyName', 'BrainADZ');
    setSetting(db, 'timezone', 'Asia/Kolkata');
    setSetting(db, 'weeklyOffs', [0, 6]);
    setSetting(db, 'payroll', DEFAULT_SETTINGS.payroll);
    setSetting(db, 'demo', true);
    const vId = {};
    for (const v of VERTICALS) vId[v.short] = db.insert('verticals', v);
    const dId = {};
    for (const d of DEPARTMENTS) dId[d] = db.insert('departments', { name: d });
    const lId = {};
    for (const l of LOCATIONS) lId[l] = db.insert('locations', { name: l });
    LEAVE_TYPES.forEach((t, i) => db.insert('leave_types', { ...t, sort: i }));
    const lt = Object.fromEntries(db.all('SELECT * FROM leave_types').map((t) => [t.code, t]));
    const year = D.yearOf(T);
    for (const y of [year - 1, year, year + 1]) for (const [date, name, type] of holidaysFor(y)) db.insert('holidays', { date, name, type });
    const ctx = calendarCtx(db);

    // ---------- employees ----------
    const usedNames = new Set();
    const usedEmails = new Set();
    let seq = 0;
    const all = [];
    const recentJoinMonths = [-5, -4, -3, -2, -1, 0];

    function ctcFor(grade, title) {
      if (grade === 'CXO') return int(60, 75) * 100000;
      if (grade === 'Head') return int(32, 45) * 100000;
      if (grade === 'Manager') return int(14, 24) * 100000;
      if (JUNIOR.includes(title)) return int(22, 26) * 10000;
      if (/Senior|Specialist|Developer|Engineer|Designer|Visualizer|Analyst|Strategist|Account Manager|Director/.test(title)) return int(60, 140) * 10000;
      return int(36, 75) * 10000;
    }

    function addEmp({ first, last, g, v, d, title, grade, manager = null, join, loc, type = 'Full-time', status = 'Active', exit = null, about = null }) {
      const name = `${first} ${last}`;
      usedNames.add(name);
      let email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@brainadz.com';
      let n = 2;
      while (usedEmails.has(email)) email = `${first}.${last}${n++}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + '@brainadz.com';
      usedEmails.add(email);
      seq++;
      const ctc = ctcFor(grade, title);
      const bank = pick(BANKS);
      const skills = [...SKILLS[d]].sort(() => rand() - 0.5).slice(0, int(3, 5));
      const certPool = CERTS[d] || [];
      const certifications = certPool.filter(() => chance(0.45)).map(([cname, issuer]) => ({ name: cname, issuer, issued: D.addDays(T, -int(120, 900)) }));
      const row = {
        code: `BZ${String(seq).padStart(3, '0')}`,
        first_name: first,
        last_name: last,
        email,
        phone: `+91 9${int(100000000, 999999999)}`,
        gender: g,
        dob: `${int(1975, 2002)}-${D.pad(int(1, 12))}-${D.pad(int(1, 28))}`,
        vertical_id: vId[v],
        department_id: dId[d],
        designation: title,
        grade,
        manager_id: manager,
        employment_type: type,
        location_id: lId[loc],
        join_date: join,
        status,
        exit_date: exit,
        about: about || `${title} in the ${d} team at BrainADZ ${v === 'Corporate' ? 'corporate office' : v}. Works across ${skills.slice(0, 2).join(' and ').toLowerCase()} to deliver for clients and colleagues.`,
        skills,
        certifications,
        ctc,
        monthly_tds: estimateMonthlyTds(ctc),
        pan: `${String.fromCharCode(65 + int(0, 25), 65 + int(0, 25), 65 + int(0, 25))}P${last[0].toUpperCase()}${int(1000, 9999)}${String.fromCharCode(65 + int(0, 25))}`,
        uan: String(int(100000, 999999)) + String(int(100000, 999999)),
        bank_name: bank[0],
        bank_account: String(int(10000000, 99999999)) + String(int(1000, 9999)),
        ifsc: `${bank[1]}0${String(int(100000, 999999))}`,
        address: `${int(1, 999)}, ${pick(['MG Road', 'Indiranagar', 'Koramangala', 'HSR Layout', 'Andheri East', 'Powai', 'Bandra West', 'Saket', 'Cyber City', 'Sector 62', 'Whitefield', 'Malad West'])}, ${loc}`,
        emergency_contact: `${pick([...MALE, ...FEMALE])} ${last} · +91 9${int(100000000, 999999999)}`,
      };
      const idNew = db.insert('employees', row);
      const e = { ...row, id: idNew, v, d };
      all.push(e);
      return e;
    }

    function genName(g) {
      for (;;) {
        const first = pick(g === 'F' ? FEMALE : MALE);
        const last = pick(LAST);
        if (!usedNames.has(`${first} ${last}`)) return [first, last];
      }
    }
    const pastJoin = (from = '2017-01-01', backDays = 200) => {
      const span = D.diffDays(from, D.addDays(T, -backDays));
      return workday(D.addDays(from, int(0, Math.max(0, span))));
    };
    const recentJoin = () => {
      const m = D.addMonths(thisMonth, pick(recentJoinMonths));
      const last = m === thisMonth ? D.addDays(T, -1) : D.monthEnd(m);
      const span = Math.max(0, D.diffDays(D.monthStart(m), last));
      return workday(D.addDays(D.monthStart(m), int(0, span)));
    };

    const ceo = addEmp({ first: 'Rajiv', last: 'Malhotra', g: 'M', v: 'Corporate', d: 'Leadership', title: 'Chief Executive Officer', grade: 'CXO', join: '2015-06-01', loc: 'Bengaluru', about: 'Founder and CEO of BrainADZ. Leads strategy across the Live, Marketing and Exhibits verticals.' });
    const heads = {};
    for (const [v, [first, last, g, title]] of Object.entries(HEADS)) {
      heads[v] = addEmp({ first, last, g, v, d: 'Leadership', title, grade: 'Head', manager: ceo.id, join: pastJoin('2016-01-01', 1800), loc: v === 'Live' ? 'Mumbai' : v === 'Exhibits' ? 'Delhi NCR' : 'Bengaluru' });
    }
    const leads = {};
    const byName = {};
    for (const t of TEAMS) {
      const [first, last, g, title] = t.lead;
      const loc = t.v === 'Corporate' ? 'Bengaluru' : t.v === 'Live' ? pick(['Mumbai', 'Bengaluru']) : t.v === 'Exhibits' ? 'Delhi NCR' : 'Bengaluru';
      const lead = addEmp({ first, last, g, v: t.v, d: t.d, title, grade: 'Manager', manager: t.v === 'Corporate' ? ceo.id : heads[t.v].id, join: pastJoin('2017-01-01', 900), loc });
      leads[`${t.v}/${t.d}`] = lead;
      byName[`${first} ${last}`] = lead;
      const members = [...t.named.map((n) => ({ named: n })), ...Array.from({ length: t.n - t.named.length }, () => ({}))];
      for (const m of members) {
        let first2; let last2; let g2; let title2;
        if (m.named) [first2, last2, g2, title2] = m.named;
        else {
          g2 = chance(0.45) ? 'F' : 'M';
          [first2, last2] = genName(g2);
          title2 = pick(t.titles);
        }
        const recent = !m.named && chance(0.22);
        const type = chance(0.9) ? 'Full-time' : pick(['Contract', 'Intern', 'Part-time']);
        const emp = addEmp({
          first: first2, last: last2, g: g2, v: t.v, d: t.d, title: title2,
          grade: /Senior/.test(title2) ? 'Senior' : 'Executive',
          manager: lead.id,
          join: m.named?.[0] === 'Aarav' ? '2022-04-15' : recent ? recentJoin() : pastJoin('2018-06-01', 220),
          loc: chance(0.75) ? loc : pick(LOCATIONS),
          type,
        });
        byName[`${first2} ${last2}`] = emp;
      }
    }
    const aarav = byName['Aarav Mehta'];
    db.update('employees', aarav.id, { about: 'Creative and result-driven marketing professional with a passion for brand storytelling and digital innovation. Contributes to building impactful campaigns across BrainADZ verticals.', skills: ['Digital Marketing', 'Content Strategy', 'Social Media', 'Brand Management', 'Campaign Analytics', 'SEO'], certifications: [{ name: 'Google Ads Certification', issuer: 'Google', issued: '2023-03-10' }, { name: 'HubSpot Inbound Marketing', issuer: 'HubSpot', issued: '2023-11-02' }, { name: 'Meta Blueprint', issuer: 'Meta', issued: '2024-02-14' }] });
    // A few recent joiners have incomplete KYC / bank details (payroll exceptions).
    const recentJoiners = all.filter((e) => e.join_date >= D.monthStart(D.addMonths(thisMonth, -1)) && e.grade === 'Executive');
    recentJoiners.slice(0, 2).forEach((e) => db.update('employees', e.id, { uan: null }));
    recentJoiners.slice(2, 3).forEach((e) => db.update('employees', e.id, { pan: null }));
    recentJoiners.slice(3, 5).forEach((e) => db.update('employees', e.id, { ifsc: 'HDFC000123' }));

    // Exited employees over the last six months (attrition trend).
    const exitReasons = ['Better Opportunities', 'Better Opportunities', 'Career Growth', 'Better Opportunities', 'Compensation', 'Career Growth', 'Personal Reasons', 'Work-Life Balance', 'Compensation', 'Relocation'];
    const exited = [];
    exitReasons.forEach((reason, i) => {
      const t = TEAMS[(i * 5) % TEAMS.length];
      const g = chance(0.5) ? 'F' : 'M';
      const [first, last] = genName(g);
      const exitDate = workday(D.addDays(D.monthStart(D.addMonths(thisMonth, -5 + Math.floor(i / 2))), int(3, 25)), -1);
      const e = addEmp({ first, last, g, v: t.v, d: t.d, title: pick(t.titles), grade: 'Executive', manager: leads[`${t.v}/${t.d}`].id, join: pastJoin('2019-01-01', 400), loc: 'Bengaluru', status: exitDate <= T ? 'Exited' : 'Notice', exit: exitDate });
      exited.push({ e, reason });
    });

    // ---------- users ----------
    const demoHash = hashPassword(DEMO_PASSWORD);
    const users = {};
    const addUser = (emp, role) => {
      const uid = db.insert('users', { email: emp.email, password_hash: demoHash, role, employee_id: emp.id });
      users[emp.id] = uid;
      return uid;
    };
    const ceoUser = addUser(ceo, 'admin');
    const hrUser = addUser(byName['Priya Sharma'], 'hr');
    addUser(byName['Neha Kapoor'], 'hr');
    for (const h of Object.values(heads)) addUser(h, 'manager');
    for (const l of Object.values(leads)) if (!users[l.id]) addUser(l, 'manager');
    for (const n of ['Aarav Mehta', 'Kavya Singh', 'Rohit Verma', 'Ananya Singh', 'Sneha Kapoor']) addUser(byName[n], 'employee');
    const hrActor = { id: hrUser, name: 'Priya Sharma' };

    // ---------- leave ----------
    const busy = new Map();
    const managerUser = (e) => users[e.manager_id] || hrUser;
    function addLeave(e, code, from, to, { half = false, status = 'Approved', reason = null, created = null } = {}) {
      const type = lt[code];
      if (!type || (type.gender && type.gender !== e.gender)) return null;
      if (to < from || from < e.join_date || (e.exit_date && to > e.exit_date)) return null;
      const days = countLeaveDays({ from, to, halfDay: half, calendarDays: Boolean(type.calendar_days) }, ctx);
      if (!days) return null;
      const set = busy.get(e.id) || new Set();
      const dates = D.eachDay(from, to);
      if (dates.some((d) => set.has(d))) return null;
      if (status !== 'Rejected') dates.forEach((d) => set.add(d));
      busy.set(e.id, set);
      const createdAt = created || D.addDays(from, -int(2, 10));
      return db.insert('leave_requests', {
        employee_id: e.id, leave_type_id: type.id, from_date: from, to_date: to, half_day: half, days,
        reason: reason || pick({ CL: ['Personal work', 'Family function', 'Bank and documentation work'], SL: ['Fever and cold', 'Doctor appointment', 'Not feeling well'], EL: ['Family vacation', 'Travelling home', 'Wedding in the family'], WFH: ['Internet technician visit at home', 'Plumbing repairs at home', 'Focus day for proposal'], LOP: ['Extended personal travel'], PL: ['Birth of child'], ML: ['Maternity'] }[code] || ['Personal']),
        status,
        decided_by: status === 'Pending' ? null : managerUser(e),
        decided_at: status === 'Pending' ? null : isoAt(createdAt <= T ? createdAt : T, '15:00'),
        decision_note: status === 'Rejected' ? 'Peak project week, please reschedule' : null,
        created_at: isoAt(createdAt <= T ? createdAt : D.addDays(T, -1), '11:00'),
      });
    }
    const current = all.filter((e) => e.status !== 'Exited');
    for (const e of all) {
      const n = int(2, 5);
      for (let i = 0; i < n; i++) {
        const code = pick(['CL', 'CL', 'SL', 'EL', 'EL', 'WFH', 'WFH', 'LOP']);
        if (code === 'LOP' && chance(0.7)) continue;
        const from = workday(D.addDays(T, -int(5, 200)));
        const len = code === 'EL' ? int(2, 4) : code === 'WFH' ? 1 : int(1, 2);
        const to = workday(D.addDays(from, len - 1));
        if (to >= T) continue;
        addLeave(e, code, from, to, { half: code === 'CL' && len === 1 && chance(0.25) });
      }
    }
    // On leave today, upcoming approved leave, pending and rejected requests.
    const wd = workday(T);
    const shuffled = [...current].filter((e) => e.join_date < D.addDays(T, -30) && e.grade !== 'CXO').sort(() => rand() - 0.5);
    let k = 0;
    for (let i = 0; i < 4; i++, k++) addLeave(shuffled[k], pick(['CL', 'SL', 'EL']), D.addDays(wd, -int(0, 1)), D.addDays(wd, int(0, 2)));
    addLeave(shuffled[k++], 'WFH', wd, wd);
    for (let i = 0; i < 9; i++, k++) {
      const from = workday(D.addDays(T, int(1, 14)));
      addLeave(shuffled[k], pick(['CL', 'EL', 'EL', 'SL', 'WFH']), from, workday(D.addDays(from, int(0, 3))));
    }
    const pend = (name, code, inDays, len, reason) => {
      const e = byName[name];
      const from = workday(D.addDays(T, inDays));
      addLeave(e, code, from, workday(D.addDays(from, len - 1)), { status: 'Pending', reason, created: D.addDays(T, -int(0, 2)) });
    };
    pend('Ananya Singh', 'EL', 3, 2, 'Sister\'s engagement in Jaipur');
    pend('Vikram Patel', 'WFH', 2, 1, 'Client calls from home office');
    pend('Neha Iyer', 'CL', 5, 3, 'Family function');
    pend('Aarav Mehta', 'CL', 9, 1, 'Personal work');
    for (let i = 0; i < 5; i++, k++) {
      const from = workday(D.addDays(T, int(4, 25)));
      addLeave(shuffled[k], pick(['CL', 'EL', 'SL', 'WFH']), from, workday(D.addDays(from, int(0, 2))), { status: 'Pending', created: D.addDays(T, -int(0, 3)) });
    }
    for (let i = 0; i < 3; i++, k++) {
      const from = workday(D.addDays(T, -int(20, 60)));
      addLeave(shuffled[k], 'EL', from, workday(D.addDays(from, 3)), { status: 'Rejected' });
    }
    // One employee on maternity leave (calendar days, paid).
    for (const e of current.filter((x) => x.gender === 'F' && x.grade === 'Executive' && x.join_date < D.addDays(T, -400))) {
      if (addLeave(e, 'ML', D.addDays(T, -45), D.addDays(T, 136), { reason: 'Maternity leave', created: D.addDays(T, -60) })) break;
    }

    // ---------- attendance ----------
    const attFrom = D.monthStart(D.addMonths(thisMonth, -6));
    const insAtt = db.raw.prepare('INSERT OR REPLACE INTO attendance (employee_id, date, status, check_in, check_out) VALUES (?, ?, ?, ?, ?)');
    const lastMonthStart = D.monthStart(D.addMonths(thisMonth, -1));
    for (const e of all) {
      const leaveDates = busy.get(e.id) || new Set();
      for (const d of D.eachDay(attFrom > e.join_date ? attFrom : e.join_date, T)) {
        if (e.exit_date && d > e.exit_date) break;
        if (ctx.weeklyOffs.includes(D.dow(d)) || ctx.holidays.has(d) || leaveDates.has(d)) continue;
        if (d === T) {
          if (chance(0.78)) insAtt.run(e.id, d, 'P', isoAt(d, `09:${D.pad(int(5, 59))}`), null);
          continue;
        }
        if (d >= lastMonthStart && chance(0.012)) continue; // left unmarked
        const r = rand();
        const status = r < 0.86 ? 'P' : r < 0.93 ? 'WFH' : r < 0.97 ? 'HD' : 'A';
        if (status === 'A') insAtt.run(e.id, d, status, null, null);
        else {
          const late = chance(0.12);
          insAtt.run(e.id, d, status, isoAt(d, late ? `10:${D.pad(int(5, 45))}` : `09:${D.pad(int(0, 55))}`), isoAt(d, status === 'HD' ? `14:${D.pad(int(0, 30))}` : `${int(18, 19)}:${D.pad(int(0, 59))}`));
        }
      }
    }

    // ---------- payroll ----------
    const payMonths = [-6, -5, -4, -3, -2, -1].map((n) => D.addMonths(thisMonth, n));
    for (const m of [...payMonths, thisMonth]) {
      const pool = all.filter((e) => e.join_date <= D.monthEnd(m) && (!e.exit_date || e.exit_date >= D.monthStart(m)));
      for (let i = 0; i < 6; i++) db.insert('payroll_adjustments', { employee_id: pick(pool).id, month: m, kind: 'Reimbursement', amount: int(8, 60) * 100, note: pick(['Client travel', 'Internet bill', 'Team lunch', 'Fuel', 'Mobile bill']), status: 'Approved' });
      for (let i = 0; i < 3; i++) db.insert('payroll_adjustments', { employee_id: pick(pool).id, month: m, kind: 'Bonus', amount: int(5, 25) * 1000, note: 'Performance bonus', status: 'Approved' });
      if (m === thisMonth) for (let i = 0; i < 3; i++) db.insert('payroll_adjustments', { employee_id: pick(pool).id, month: m, kind: 'Reimbursement', amount: int(15, 80) * 100, note: 'Event travel claim', status: 'Pending' });
    }
    for (const m of payMonths) {
      const run = processRun(db, hrActor, m, { today: T });
      const end = D.monthEnd(m);
      const s = db.get('SELECT COUNT(*) c, SUM(net) n FROM payslips WHERE run_id = ?', run.id);
      db.update('payroll_runs', run.id, {
        status: 'Completed',
        steps: { collation: isoAt(D.addDays(end, -10)), sync: isoAt(D.addDays(end, -9)), processing: isoAt(D.addDays(end, -8)), approvals: isoAt(D.addDays(end, -5)), transfer: isoAt(D.addDays(end, -2)), completed: isoAt(end, '17:00') },
        approvals: [
          { stage: 'Prepared by HR', by: 'Priya Sharma', at: isoAt(D.addDays(end, -8)) },
          { stage: 'Review by Finance', by: 'Neha Bansal', at: isoAt(D.addDays(end, -6)) },
          { stage: 'Management Approval', by: 'Rajiv Malhotra', at: isoAt(D.addDays(end, -5)) },
        ],
        bank_batch: { id: `BT-${m.replace('-', '')}-001`, bank: 'HDFC Bank', count: s.c, amount: s.n, status: 'Completed', initiatedAt: isoAt(D.addDays(end, -2)), payDate: end },
        created_at: isoAt(D.addDays(end, -10)),
      });
      db.run("UPDATE payslips SET status = 'Paid' WHERE run_id = ?", run.id);
    }
    const cur = processRun(db, hrActor, thisMonth, { today: T });
    const curApprovals = JSON.parse(db.value('SELECT approvals FROM payroll_runs WHERE id = ?', cur.id));
    curApprovals.push({ stage: 'Review by Finance', by: 'Neha Bansal', at: new Date().toISOString() });
    db.update('payroll_runs', cur.id, { status: 'Finance Reviewed', approvals: curApprovals });

    // ---------- hiring ----------
    const JOBS = [
      { title: 'Senior Frontend Developer', v: 'Marketing', d: 'Technology', loc: 'Bengaluru', mode: 'Hybrid', openings: 2, ago: 24, must: ['React', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'Redux'], nice: ['GraphQL', 'Next.js'], exp: [4, 8], edu: 'B.Tech / B.E. in CS or related', sal: [12, 20], ko: ['Do you have experience with React?', 'Are you open to a hybrid work model in Bangalore?'], n: 14 },
      { title: 'Marketing Executive', v: 'Marketing', d: 'Marketing', loc: 'Bengaluru', mode: 'Onsite', openings: 3, ago: 18, must: ['Digital Marketing', 'Social Media', 'SEO', 'Content Strategy'], nice: ['Google Ads'], exp: [1, 4], edu: 'MBA / BBA / BMM', sal: [4, 7], ko: ['Have you managed social media for brands?'], n: 12 },
      { title: 'Event Manager', v: 'Live', d: 'Events', loc: 'Mumbai', mode: 'Onsite', openings: 2, ago: 20, must: ['Event Management', 'Vendor Management', 'Budgeting', 'Client Relationship'], nice: ['Logistics'], exp: [5, 10], edu: 'MBA / PGDM in Event Management', sal: [10, 16], ko: ['Have you managed events with 1000+ attendees?'], n: 10 },
      { title: 'Exhibition Designer', v: 'Exhibits', d: 'Design', loc: 'Delhi NCR', mode: 'Onsite', openings: 2, ago: 15, must: ['3ds Max', 'AutoCAD', 'Photoshop', 'Spatial Design'], nice: ['SketchUp'], exp: [3, 7], edu: 'B.Des / Diploma in Interior or Exhibition Design', sal: [6, 11], ko: ['Can you share a portfolio of exhibition stalls?'], n: 9 },
      { title: 'Business Development Executive', v: 'Live', d: 'Sales', loc: 'Bengaluru', mode: 'Onsite', openings: 4, ago: 30, must: ['B2B Sales', 'Lead Generation', 'Negotiation', 'CRM'], nice: ['Proposal Writing'], exp: [1, 4], edu: 'MBA / BBA', sal: [4, 8], ko: ['Are you comfortable with field sales and travel?'], n: 13 },
      { title: 'Content Strategist', v: 'Marketing', d: 'Creative', loc: 'Bengaluru', mode: 'Remote', openings: 1, ago: 45, status: 'On Hold', must: ['Content Strategy', 'Copywriting', 'Storytelling', 'SEO'], nice: ['Social Media'], exp: [3, 6], edu: 'B.A. / M.A. in Mass Communication', sal: [7, 12], ko: [], n: 6 },
      { title: 'Graphic Designer', v: 'Marketing', d: 'Creative', loc: 'Bengaluru', mode: 'Onsite', openings: 2, ago: 12, must: ['Photoshop', 'Illustrator', 'Figma'], nice: ['Video Editing'], exp: [2, 5], edu: 'B.Des / BFA', sal: [5, 9], ko: ['Can you share your portfolio?'], n: 9 },
      { title: 'HR Executive', v: 'Corporate', d: 'HR', loc: 'Bengaluru', mode: 'Onsite', openings: 1, ago: 21, must: ['HR Operations', 'Talent Acquisition', 'Employee Engagement', 'MS Office'], nice: ['Payroll'], exp: [2, 5], edu: 'MBA in HR', sal: [5, 8], ko: [], n: 8 },
      { title: 'Account Manager', v: 'Live', d: 'Client Servicing', loc: 'Mumbai', mode: 'Onsite', openings: 2, ago: 10, must: ['Account Management', 'Client Communication', 'Presentation'], nice: ['CRM'], exp: [3, 6], edu: 'MBA', sal: [8, 12], ko: [], n: 7 },
      { title: 'Sales Executive', v: 'Exhibits', d: 'Business Development', loc: 'Delhi NCR', mode: 'Onsite', openings: 3, ago: 8, must: ['B2B Sales', 'Lead Generation', 'Negotiation'], nice: ['CRM'], exp: [1, 3], edu: 'Graduate in any discipline', sal: [3.5, 6], ko: [], n: 8 },
      { title: 'UI/UX Designer', v: 'Marketing', d: 'Technology', loc: 'Bengaluru', mode: 'Hybrid', openings: 1, ago: 26, must: ['Figma', 'User Research', 'Prototyping', 'HTML'], nice: ['CSS'], exp: [3, 6], edu: 'B.Des / M.Des', sal: [9, 15], ko: [], n: 7 },
      { title: 'Operations Executive', v: 'Exhibits', d: 'Operations', loc: 'Delhi NCR', mode: 'Onsite', openings: 2, ago: 14, must: ['Vendor Management', 'Project Management', 'Site Supervision'], nice: ['AutoCAD'], exp: [1, 4], edu: 'Diploma / B.Tech', sal: [3.5, 6], ko: [], n: 7 },
      { title: 'Digital Marketing Specialist', v: 'Marketing', d: 'Marketing', loc: 'Mumbai', mode: 'Onsite', openings: 1, ago: 70, status: 'Closed', closedAgo: 20, must: ['Google Ads', 'SEO', 'Campaign Analytics'], nice: ['Social Media'], exp: [3, 6], edu: 'MBA / BBA', sal: [7, 11], ko: [], n: 5 },
    ];
    const SOURCES = ['LinkedIn', 'LinkedIn', 'LinkedIn', 'LinkedIn', 'Naukri', 'Naukri', 'Naukri', 'Indeed', 'Indeed', 'Company Website', 'Company Website', 'Referrals', 'Other'];
    const STAGES = ['Applied', 'AI Screened', 'Shortlisted', 'Interview 1', 'Interview 2', 'Offer', 'Hired'];
    const DEG = { Technology: 'B.Tech - CSE', Marketing: 'MBA - Marketing', Events: 'PGDM - Event Management', Design: 'B.Des', Sales: 'BBA', Creative: 'B.A. Mass Communication', HR: 'MBA - HR', 'Client Servicing': 'MBA', 'Business Development': 'BBA', Operations: 'Diploma - Civil Engineering' };
    const interviewers = { Technology: byName['Aditya Rao'], Marketing: byName['Nandini Joshi'], Events: byName['Ishita Roy'], Design: byName['Tanvi Desai'], Sales: byName['Vikram Patel'], Creative: byName['Siddharth Menon'], HR: byName['Priya Sharma'], 'Client Servicing': byName['Sameer Khan'], 'Business Development': byName['Varun Shetty'], Operations: byName['Rohan Das'] };

    const cands = [];
    for (const j of JOBS) {
      const jobId = db.insert('jobs', {
        title: j.title, vertical_id: vId[j.v], department_id: dId[j.d], location_id: lId[j.loc], employment_type: 'Full-time', work_mode: j.mode,
        openings: j.openings, status: j.status || 'Active', posted_on: D.addDays(T, -j.ago), closed_on: j.closedAgo ? D.addDays(T, -j.closedAgo) : null,
        description: `We are hiring a ${j.title} for BrainADZ ${j.v === 'Corporate' ? '' : j.v} in ${j.loc}. You will work with a fast-moving team delivering campaigns, events and exhibitions for leading brands.`,
        must_have: j.must, nice_to_have: j.nice, exp_min: j.exp[0], exp_max: j.exp[1], education: j.edu, salary_min: j.sal[0], salary_max: j.sal[1], knockout: j.ko,
        hiring_manager_id: (interviewers[j.d] || byName['Priya Sharma']).id,
        created_at: isoAt(D.addDays(T, -j.ago)),
      });
      const jobInfo = { title: j.title, must_have: j.must, nice_to_have: j.nice, exp_min: j.exp[0], exp_max: j.exp[1], education: j.edu, location: j.loc, work_mode: j.mode, salary_min: j.sal[0], salary_max: j.sal[1], knockout: j.ko };
      for (let i = 0; i < j.n; i++) {
        const g = chance(0.5) ? 'F' : 'M';
        const [first, last] = genName(g);
        usedNames.add(`${first} ${last}`);
        const q = rand();
        const exp = Math.max(0.5, Math.round((j.exp[0] + (j.exp[1] - j.exp[0]) * rand() + (q < 0.25 ? -2 : q > 0.9 ? 3 : 0)) * 10) / 10);
        const skills = [...j.must.filter(() => rand() < 0.35 + q * 0.6), ...j.nice.filter(() => rand() < q)];
        const city = rand() < 0.65 ? j.loc : pick(['Pune', 'Chennai', 'Hyderabad', 'Bengaluru', 'Mumbai', 'Delhi NCR']);
        const company = pick(COMPANIES);
        const expected = Math.round((j.sal[0] + (j.sal[1] - j.sal[0]) * rand() + (q < 0.2 ? 4 : 0)) * 10) / 10;
        const currentCtc = Math.round(expected * 0.75 * 10) / 10;
        const notice = pick([15, 30, 30, 45, 60, 90]);
        const inst = pick(INSTITUTES);
        const gradYear = 2025 - Math.ceil(exp) - int(0, 1);
        const email = `${first}.${last}${int(1, 99)}@gmail.com`.toLowerCase();
        const phone = `+91 9${int(100000000, 999999999)}`;
        const slug = `${first}${last}`.toLowerCase();
        const cityLabel = { Bengaluru: 'Bengaluru, KA', Mumbai: 'Mumbai, MH', 'Delhi NCR': 'Delhi NCR', Pune: 'Pune, MH', Chennai: 'Chennai, TN', Hyderabad: 'Hyderabad, TS' }[city];
        const text = `${first} ${last}\n${j.title} | ${cityLabel}\nEmail: ${email} | Phone: ${phone} | linkedin.com/in/${slug}\n\nPROFILE SUMMARY\n${j.title} with ${exp} years of experience. Currently working at ${company}.\nCurrent Company: ${company}\nCurrent Role: ${j.title}\nTotal Experience: ${exp} years\nLocation: ${city}\nExpected CTC: ${expected} LPA | Current CTC: ${currentCtc} LPA | Notice Period: ${notice} days\n\nKEY SKILLS\n${skills.join(', ') || 'Communication, MS Office, Teamwork'}\n\nEXPERIENCE\n${company} — ${j.title} (${gradYear + 1} - Present)\n${skills.slice(0, 3).map((s) => `- Delivered projects using ${s} for enterprise clients.`).join('\n') || '- Supported day-to-day operations of the team.'}\n- Collaborated with cross-functional teams and clients.\n\nEDUCATION\n${DEG[j.d] || 'B.Com'}, ${inst} (${gradYear})\n`;
        const ai = heuristicScreen(jobInfo, text);
        cands.push({ jobId, j, first, last, g, exp, company, city: cityLabel, expected, currentCtc, notice, email, phone, slug, text, ai, inst, gradYear, skills, applied: D.addDays(T, -int(0, Math.max(1, j.ago - 1))) });
      }
    }
    // Better-scoring candidates are further along the pipeline.
    cands.sort((a, b) => b.ai.score - a.ai.score);
    const pools = [['Hired', 'Offer', 'Interview 2', 'Offer', 'Interview 2', 'Interview 1'], ['Interview 1', 'Shortlisted', 'Interview 2', 'Shortlisted', 'Interview 1'], ['AI Screened', 'Shortlisted', 'AI Screened', 'Applied'], ['Applied', 'AI Screened', 'Rejected', 'Applied', 'On Hold'], ['Rejected', 'Applied', 'Rejected']];
    const todaySlots = ['10:00', '11:30', '14:00', '16:00'];
    let slot = 0;
    const hires = [];
    cands.forEach((c, i) => {
      const bucket = Math.min(pools.length - 1, Math.floor((i / cands.length) * pools.length));
      let stage = c.j.status === 'Closed' ? (i % 3 === 0 ? 'Hired' : 'Rejected') : pick(pools[bucket]);
      const screened = stage !== 'Applied';
      let maxStage = Math.max(0, STAGES.indexOf(stage));
      if (stage === 'Rejected' || stage === 'On Hold') maxStage = int(1, 3);
      const decision = ['Shortlisted', 'Interview 1', 'Interview 2', 'Offer', 'Hired'].includes(stage) ? 'Shortlist' : stage === 'Rejected' ? 'Reject' : stage === 'On Hold' ? 'Hold' : null;
      const updated = D.addDays(c.applied, int(0, Math.max(0, D.diffDays(c.applied, T))));
      const cid = db.insert('candidates', {
        job_id: c.jobId, name: `${c.first} ${c.last}`, email: c.email, phone: c.phone, location: c.city, current_company: c.company, current_title: c.j.title,
        experience: c.exp, education: `${DEG[c.j.d] || 'B.Com'}, ${c.inst} (${c.gradYear})`, current_ctc: c.currentCtc, expected_ctc: c.expected, notice_days: c.notice,
        linkedin: `linkedin.com/in/${c.slug}`, skills: c.skills, source: pick(SOURCES), stage, max_stage: maxStage,
        screen_status: screened ? 'done' : null, ai_score: screened ? c.ai.score : null, ai: screened ? c.ai : null, ai_engine: screened ? 'rules' : null,
        decision, resume_text: c.text, resume_name: `${c.first}_${c.last}_Resume.pdf`, applied_on: c.applied,
        reject_reason: stage === 'Rejected' ? pick(['Skills mismatch', 'Salary expectations too high', 'Notice period too long', 'Did not clear interview']) : null,
        updated_at: isoAt(updated, '12:00'),
      });
      const act = (text, d, by = 'Priya Sharma') => db.insert('candidate_activity', { candidate_id: cid, text, by_name: by, created_at: isoAt(d, '11:00') });
      act(`Applied for ${c.j.title}`, c.applied, 'Candidate');
      if (screened) act(`Resume screened · ${c.ai.score}% match`, c.applied, 'Resume Screener AI');
      const iv = interviewers[c.j.d] || byName['Neha Kapoor'];
      const stageIdx = STAGES.indexOf(stage);
      if (stageIdx >= 3 || (stage === 'Rejected' && maxStage >= 3)) {
        const done = stageIdx >= 4 || stage === 'Rejected';
        const when = done ? `${D.addDays(T, -int(6, 15))}T${pick(todaySlots)}` : slot < 4 ? `${T}T${todaySlots[slot++]}` : `${workday(D.addDays(T, int(1, 4)))}T${pick(todaySlots)}`;
        const rating = stage === 'Rejected' ? int(20, 30) / 10 : int(36, 49) / 10;
        db.insert('interviews', { candidate_id: cid, round: 'Interview 1', scheduled_at: when, mode: pick(['Virtual', 'Virtual', 'In-person']), interviewer_id: iv.id, status: done ? 'Completed' : 'Scheduled', rating: done ? rating : null, recommendation: done ? (rating >= 4.3 ? 'Strong Hire' : rating >= 3.5 ? 'Hire' : 'No Hire') : null, feedback: done ? (rating >= 3.5 ? 'Strong fundamentals and good communication. Recommend next round.' : 'Gaps in core skills for this role.') : null });
        act(`Interview 1 ${done ? 'completed' : 'scheduled'}`, when.slice(0, 10));
      }
      if (stageIdx >= 4) {
        const done = stageIdx >= 5;
        const when = done ? `${D.addDays(T, -int(2, 5))}T${pick(todaySlots)}` : slot < 4 ? `${T}T${todaySlots[slot++]}` : `${workday(D.addDays(T, int(1, 5)))}T${pick(todaySlots)}`;
        const rating = int(38, 50) / 10;
        db.insert('interviews', { candidate_id: cid, round: 'Interview 2', scheduled_at: when, mode: pick(['Virtual', 'In-person']), interviewer_id: (heads[c.j.v] || byName['Priya Sharma']).id, status: done ? 'Completed' : 'Scheduled', rating: done ? rating : null, recommendation: done ? (rating >= 4.3 ? 'Strong Hire' : 'Hire') : null, feedback: done ? 'Good culture fit and ownership. Recommend offer.' : null });
      }
      if (stage === 'Offer' || stage === 'Hired') {
        const offerDate = D.addDays(T, -int(1, 6));
        const status = stage === 'Hired' ? 'Accepted' : pick(['Sent', 'Sent', 'Accepted', 'Declined']);
        db.update('candidates', cid, { offer_ctc: c.expected, offer_date: offerDate, offer_status: status, joining_date: status === 'Accepted' || stage === 'Hired' ? workday(D.addDays(T, int(5, 25))) : null });
        act(`Offer ${status.toLowerCase()} · ${c.expected} LPA`, offerDate);
        if (stage === 'Hired') hires.push({ cid, c });
      }
    });

    // Convert three hires into employees with onboarding tasks.
    const fallbackHires = [['Rahul', 'Bhat', 'M', 'Exhibits', 'Design', 'Graphic Designer'], ['Divya', 'Nair', 'F', 'Live', 'Events', 'Event Executive'], ['Mohit', 'Arora', 'M', 'Marketing', 'Marketing', 'Marketing Executive']];
    const TASKS = ['Offer letter signed', 'Documents & KYC collected', 'Laptop and accounts set up', 'Welcome kit & ID card', 'Orientation and buddy assigned'];
    [4, 3, 2].forEach((done, i) => {
      const h = hires[i];
      const [first, last, g, v, d, title] = h ? [h.c.first, h.c.last, h.c.g, h.c.j.v, h.c.j.d, h.c.j.title] : fallbackHires[i];
      const join = workday(D.addDays(T, [-3, 2, 6][i]));
      const e = addEmp({ first, last, g, v, d, title, grade: 'Executive', manager: leads[`${v}/${d}`].id, join, loc: v === 'Exhibits' ? 'Delhi NCR' : v === 'Live' ? 'Mumbai' : 'Bengaluru' });
      const ctc = h ? Math.round(h.c.expected * 100000) : e.ctc;
      db.update('employees', e.id, { uan: null, ctc, monthly_tds: estimateMonthlyTds(ctc) });
      TASKS.forEach((t, n) => db.insert('onboarding_tasks', { employee_id: e.id, title: t, done: n < done, done_at: n < done ? isoAt(D.addDays(T, -int(1, 5))) : null, sort: n }));
      if (h) db.update('candidates', h.cid, { employee_id: e.id, joining_date: join });
    });

    // ---------- resignations ----------
    const CHECK = ['manager_approval', 'hr_review', 'knowledge_transfer', 'handover', 'exit_interview', 'asset_return', 'access_revocation', 'fnf'];
    const allDone = (at) => Object.fromEntries(CHECK.map((key) => [key, { status: 'Completed', at }]));
    const clearAll = (at) => ({ manager: { status: 'Approved', by: 'Reporting Manager', at }, it: { status: 'Approved', by: 'IT Team', at }, admin: { status: 'Approved', by: 'Admin Team', at }, finance: { status: 'Approved', by: 'Finance Team', at } });
    for (const { e, reason } of exited) {
      const submitted = workday(D.addDays(e.exit_date, -30), -1);
      const at = isoAt(e.exit_date);
      db.insert('resignations', {
        employee_id: e.id, submitted_on: submitted, reason_category: reason, reason: `${reason}.`, notice_days: 30, last_working_day: e.exit_date,
        status: e.exit_date <= T ? 'Completed' : 'In Progress',
        steps: { submitted: isoAt(submitted), manager: isoAt(D.addDays(submitted, 1)), hr: isoAt(D.addDays(submitted, 2)), checklist: at, exit_interview: at, settlement: at },
        checklist: allDone(at), clearance: clearAll(at),
        exit_interview: { rating: int(3, 5), joinAgain: chance(0.7), feedback: pick(['Great learning, wanted a bigger role.', 'Moving cities for family.', 'Got a significant hike elsewhere.']) },
        settlement: { amount: int(40, 160) * 1000, paidOn: D.addDays(e.exit_date, 15) <= T ? D.addDays(e.exit_date, 15) : null, notes: 'Leave encashment and pro-rata salary' },
        rehire_eligible: chance(0.8), letters: { experience: true, relieving: true },
        created_at: isoAt(submitted),
      });
    }
    const resign = (name, { daysAgo, status, notice = 30, reason, text }) => {
      const e = byName[name];
      const submitted = workday(D.addDays(T, -daysAgo), -1);
      const lwd = D.addDays(submitted, notice);
      const steps = { submitted: isoAt(submitted, '10:30') };
      const checklist = Object.fromEntries(CHECK.map((key) => [key, { status: 'Pending' }]));
      const clearance = { manager: { status: 'Pending' }, it: { status: 'Pending' }, admin: { status: 'Pending' }, finance: { status: 'Pending' } };
      if (['Approved', 'In Progress'].includes(status)) {
        steps.manager = isoAt(D.addDays(submitted, 1), '14:15');
        checklist.manager_approval = { status: 'Completed', at: steps.manager };
      }
      if (status === 'In Progress') {
        steps.hr = isoAt(D.addDays(submitted, 2), '11:20');
        checklist.hr_review = { status: 'Completed', at: steps.hr };
        checklist.knowledge_transfer = { status: 'In Progress' };
        clearance.manager = { status: 'Approved', by: 'Reporting Manager', at: steps.hr };
        clearance.it = { status: 'Approved', by: 'IT Team', at: isoAt(D.addDays(submitted, 3)) };
        db.update('employees', e.id, { status: 'Notice', exit_date: lwd });
      }
      if (status === 'Rejected') steps.manager = isoAt(D.addDays(submitted, 2));
      db.insert('resignations', {
        employee_id: e.id, submitted_on: submitted, reason_category: reason, reason: text, notice_days: notice, last_working_day: lwd, status,
        steps, checklist, clearance, decision_note: status === 'Rejected' ? 'Retained with role change and revised compensation' : null, created_at: isoAt(submitted, '10:30'),
      });
    };
    resign('Rohit Verma', { daysAgo: 22, status: 'In Progress', notice: 60, reason: 'Better Opportunities', text: 'Received an offer for a lead engineer role at a product company.' });
    resign('Kavya Nair', { daysAgo: 6, status: 'Approved', reason: 'Personal Reasons', text: 'Relocating to Kochi to be with family.' });
    resign('Sneha Kapoor', { daysAgo: 1, status: 'Pending', reason: 'Career Growth', text: 'Pursuing a Master\'s in Spatial Design.' });
    resign('Vikram Singh', { daysAgo: 18, status: 'Rejected', reason: 'Compensation', text: 'Looking for better compensation.' });

    // ---------- performance ----------
    const fyStart = Number(T.slice(5, 7)) >= 4 ? year : year - 1;
    const fy = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    const closed = db.insert('review_cycles', { name: `Annual Review FY ${fy(fyStart - 1)}`, start_date: `${fyStart - 1}-04-01`, end_date: `${fyStart}-03-31`, status: 'Closed' });
    const activeCycle = db.insert('review_cycles', { name: `Mid-Year Review FY ${fy(fyStart)}`, start_date: `${fyStart}-04-01`, end_date: `${fyStart}-09-30`, status: 'Active' });
    const GOALS = {
      Sales: ['Achieve quarterly revenue target', 'Add 10 new enterprise accounts', 'Improve proposal win rate to 35%', 'Keep CRM pipeline updated weekly'],
      Events: ['Deliver 12 flagship events on budget', 'Reduce vendor cost by 8%', 'Achieve client CSAT of 4.5+', 'Zero safety incidents on site'],
      Marketing: ['Grow organic traffic by 30%', 'Launch 4 integrated campaigns', 'Improve lead conversion to 6%', 'Publish monthly performance reports'],
      Creative: ['Deliver campaign creatives within SLA', 'Build the 2026 brand style guide', 'Win one industry creative award', 'Mentor two junior designers'],
      Technology: ['Ship the client portal v2', 'Reach 80% test coverage', 'Cut page load time below 2s', 'Document core services'],
      Operations: ['Complete 20 exhibition builds on schedule', 'Reduce fabrication rework by 15%', 'Onboard 5 new fabrication vendors', 'Maintain site safety audits'],
      Design: ['Deliver stall designs within 5 days', 'Create a reusable module library', 'Achieve 90% first-round approval', 'Upskill on real-time rendering'],
      default: ['Meet team KPIs for the half year', 'Complete two learning certifications', 'Improve process turnaround by 10%', 'Contribute to one cross-team initiative'],
    };
    for (const e of all.filter((x) => x.status !== 'Exited' && x.grade !== 'CXO')) {
      if (e.join_date <= `${fyStart}-03-31` && e.join_date <= T) {
        const r = Math.min(5, Math.max(2, Math.round((3.4 + (rand() + rand() + rand() - 1.5) * 0.9) * 2) / 2));
        db.insert('reviews', { cycle_id: closed, employee_id: e.id, self_rating: Math.min(5, r + 0.5), manager_rating: r, final_rating: r, self_comments: 'Delivered on my key goals and took on new responsibilities.', manager_comments: r >= 4 ? 'Consistently strong performer.' : r >= 3 ? 'Solid contributor; can raise the bar on ownership.' : 'Needs improvement on delivery timelines.', status: 'Completed' });
      }
      if (e.join_date > `${fyStart}-08-31`) continue;
      const titles = [...(GOALS[e.d] || GOALS.default)].sort(() => rand() - 0.5).slice(0, int(3, 4));
      const weights = titles.length === 3 ? [40, 30, 30] : [30, 25, 25, 20];
      titles.forEach((t, i) => db.insert('goals', { cycle_id: activeCycle, employee_id: e.id, title: t, weight: weights[i], progress: int(30, 100), due_date: `${fyStart}-09-30` }));
      const roll = rand();
      const status = roll < 0.3 ? 'Completed' : roll < 0.6 ? 'Manager Review' : roll < 0.8 ? 'Self Review' : 'Not Started';
      const self = int(6, 10) / 2;
      const mgr = Math.max(2, Math.min(5, self - int(0, 2) / 2));
      db.insert('reviews', {
        cycle_id: activeCycle, employee_id: e.id, status,
        self_rating: ['Manager Review', 'Completed'].includes(status) ? self : null,
        self_comments: ['Manager Review', 'Completed'].includes(status) ? 'Hit most of my goals this half and supported two major client launches.' : null,
        manager_rating: status === 'Completed' ? mgr : null, manager_comments: status === 'Completed' ? 'Good half year. Focus on stakeholder updates.' : null,
        final_rating: status === 'Completed' ? mgr : null,
      });
    }

    // ---------- policies, POSH, notices ----------
    const policies = policyLibrary(T);
    const ackRates = [0.95, 0.93, 0.96, 0.92, 0.86, 0];
    const currentEmps = all.filter((e) => e.status !== 'Exited' && e.join_date <= T);
    policies.forEach((p, i) => {
      const pid = db.insert('policies', p);
      if (!p.requires_ack) return;
      for (const e of currentEmps) if (chance(ackRates[i])) db.insert('policy_acks', { policy_id: pid, employee_id: e.id, version: p.version, acked_at: isoAt(D.addDays(T, -int(0, 60))) });
    });
    for (const e of currentEmps) if (chance(0.78)) db.insert('posh_training', { employee_id: e.id, completed_at: isoAt(D.addDays(T, -int(5, 300))) });
    setSetting(db, 'icc', { presidingOfficerId: heads.Marketing.id, memberIds: [byName['Priya Sharma'].id, byName['Neha Bansal'].id, byName['Rohan Das'].id], externalMember: 'Adv. Leela Thomas (NGO member)' });
    db.insert('posh_complaints', { ref_no: `POSH-${year}-001`, complainant_id: null, anonymous: 1, respondent: 'Name withheld (Operations)', incident_date: D.addDays(T, -170), place: 'Client site', description: 'Repeated inappropriate remarks during a site build.', status: 'Resolved', due_date: D.addDays(T, -75), updates: [{ at: isoAt(D.addDays(T, -165)), text: 'Complaint received by ICC.' }, { at: isoAt(D.addDays(T, -150)), text: 'Inquiry started; both parties heard.' }, { at: isoAt(D.addDays(T, -110)), text: 'Inquiry concluded. Written warning issued and sensitisation session held.' }], created_at: isoAt(D.addDays(T, -165)) });
    db.insert('posh_complaints', { ref_no: `POSH-${year}-002`, complainant_id: null, anonymous: 1, respondent: 'Name withheld (Sales)', incident_date: D.addDays(T, -16), place: 'Office', description: 'Unwelcome messages on a personal chat app after work hours.', status: 'Under Inquiry', due_date: D.addDays(T, 78), updates: [{ at: isoAt(D.addDays(T, -12)), text: 'Complaint received by ICC.' }, { at: isoAt(D.addDays(T, -8)), text: 'Inquiry started. Interim relief: reporting line changed.' }], created_at: isoAt(D.addDays(T, -12)) });

    db.insert('notices', { title: 'Annual Health Check-up Camp', body: 'Free health check-ups at all three offices next week. Book your slot with the Admin desk.', kind: 'health', created_by: hrUser, created_at: isoAt(D.addDays(T, -2)) });
    db.insert('notices', { title: 'New Leave Policy Guidelines', body: 'Leave Policy v3.2 is live: Earned Leave now accrues monthly and up to 5 days carry forward. Please acknowledge it in Leave & Policies.', kind: 'policy', created_by: hrUser, created_at: isoAt(D.addDays(T, -4)) });
    db.insert('notices', { title: `BrainADZ Excellence Awards ${year}`, body: 'Nominations are open across Live, Marketing and Exhibits. Last date to nominate is the 25th.', kind: 'award', created_by: hrUser, created_at: isoAt(D.addDays(T, -6)) });

    // ---------- assets, requests, notifications ----------
    for (const e of all) {
      const tech = ['Technology', 'Creative', 'Design'].includes(e.d);
      db.insert('assets', { employee_id: e.id, type: 'Laptop', name: tech ? 'MacBook Pro 14" M3' : pick(['Dell Latitude 5440', 'Lenovo ThinkPad E14']), serial: `BZ-LT-${String(e.id).padStart(4, '0')}`, issued_on: e.join_date, returned_on: e.status === 'Exited' ? e.exit_date : null, status: e.status === 'Exited' ? 'Returned' : 'Issued' });
      db.insert('assets', { employee_id: e.id, type: 'ID Card', name: 'Access card', serial: `BZ-ID-${String(e.id).padStart(4, '0')}`, issued_on: e.join_date, returned_on: e.status === 'Exited' ? e.exit_date : null, status: e.status === 'Exited' ? 'Returned' : 'Issued' });
      if (['Sales', 'Business Development', 'Leadership'].includes(e.d)) db.insert('assets', { employee_id: e.id, type: 'Phone', name: 'iPhone 15', serial: `BZ-PH-${String(e.id).padStart(4, '0')}`, issued_on: e.join_date, status: e.status === 'Exited' ? 'Returned' : 'Issued', returned_on: e.status === 'Exited' ? e.exit_date : null });
    }
    db.insert('requests', { employee_id: aarav.id, category: 'HR', subject: 'Address proof letter for bank', description: 'Need an employment and address proof letter for a home loan.', status: 'In Progress', created_at: isoAt(D.addDays(T, -3)) });
    db.insert('requests', { employee_id: byName['Kavya Singh'].id, category: 'IT', subject: 'Adobe licence renewal', description: 'Creative Cloud licence expires this week.', status: 'Open', created_at: isoAt(D.addDays(T, -1)) });
    db.insert('requests', { employee_id: byName['Arjun Nair'].id, category: 'Payroll', subject: 'Form 16 for last year', description: 'Please share Form 16 for ITR filing.', status: 'Resolved', response: 'Shared on email.', created_at: isoAt(D.addDays(T, -20)) });
    db.insert('requests', { employee_id: byName['Kunal Verma'].id, category: 'Admin', subject: 'Parking slot request', description: 'Requesting a two-wheeler parking slot at the Delhi office.', status: 'Open', created_at: isoAt(D.addDays(T, -2)) });

    const n = (uid, text, link, daysAgo, read = 0) => db.insert('notifications', { user_id: uid, text, link, read, created_at: isoAt(D.addDays(T, -daysAgo), '09:30') });
    n(hrUser, 'Sneha Kapoor submitted a resignation', '/resignation', 1);
    n(hrUser, 'Ananya Singh applied for 2 days of Earned Leave', '/leave', 0);
    n(hrUser, `Payroll for ${D.monthLabel(thisMonth)} was reviewed by Finance`, '/payroll', 0);
    n(hrUser, '3 reimbursement claims are awaiting approval', '/payroll', 0);
    n(hrUser, 'Interview with a Senior Frontend Developer candidate today', '/hiring', 0, 1);
    n(ceoUser, `Payroll for ${D.monthLabel(thisMonth)} needs management approval`, '/payroll', 0);
    n(users[aarav.id], 'Your Casual Leave request is awaiting approval', '/leave', 0);
    n(users[aarav.id], 'Leave Policy v3.2 needs your acknowledgement', '/leave?tab=policies', 4);
    n(users[byName['Vikram Patel'].id], 'Arjun Nair is on your team calendar this week', '/leave', 1, 1);

    // ---------- employee documents ----------
    // Sample PDFs for each employee's joining documents. About a quarter of
    // people are missing one or two, recent joiners more, so the checklist
    // shows what HR still has to collect. Aarav has not sent his address proof.
    if (saveFile) {
      const DEGREES = { Technology: 'B.Tech Degree Certificate', Design: 'B.Des Degree Certificate', Creative: 'BFA Degree Certificate', Finance: 'B.Com Degree Certificate', Sales: 'MBA Degree Certificate', 'Business Development': 'MBA Degree Certificate', Marketing: 'MBA Degree Certificate', HR: 'MBA (HR) Degree Certificate' };
      const specimen = 'SPECIMEN - sample document for the BrainADZ HRMS demo. Not a real record.';
      let fileSeq = 0;
      const addDoc = (e, category, name, heading, lines, by) => {
        const file = `demo-${String(++fileSeq).padStart(4, '0')}.pdf`;
        const bytes = textPdf(heading, lines, { footer: specimen });
        saveFile('documents', file, bytes);
        const up = D.addDays(e.join_date, int(-6, 6));
        db.insert('documents', { employee_id: e.id, name, category, file, mime: 'application/pdf', size: bytes.length, uploaded_by: by, uploaded_at: isoAt(up < T ? up : T, '11:30') });
      };
      for (const e of all.filter((x) => x.status !== 'Exited')) {
        const name = `${e.first_name} ${e.last_name}`;
        const recent = D.diffDays(e.join_date, T) < 60;
        const skip = new Set();
        if (e === aarav) skip.add('Address Proof');
        else if (recent) ['Bank Proof', 'Education', 'Appointment Letter'].filter(() => chance(0.6)).forEach((c) => skip.add(c));
        else if (chance(0.22)) skip.add(pick(['Address Proof', 'Education', 'Bank Proof', 'PAN Card', 'Appointment Letter']));
        const by = hrUser;
        const plan = [
          ['Aadhaar Card', 'Aadhaar Card', 'Aadhaar - Unique Identification Authority of India', [`Name: ${name}`, `Date of birth: ${e.dob}`, `Aadhaar number: XXXX XXXX ${int(1000, 9999)}`, `Gender: ${e.gender === 'F' ? 'Female' : 'Male'}`]],
          ['PAN Card', 'PAN Card', 'Income Tax Department - Permanent Account Number', [`Name: ${name.toUpperCase()}`, `PAN: ${e.pan}`, `Date of birth: ${e.dob}`]],
          ['Address Proof', pick(['Rent Agreement', 'Electricity Bill', 'Passport (address page)']), 'Proof of Address', [`Name: ${name}`, `Address: ${e.address}`]],
          ['Education', DEGREES[e.d] || 'Graduation Degree Certificate', DEGREES[e.d] || 'Degree Certificate', [`This is to certify that ${name}`, 'has been awarded the degree after completing all requirements.', `Year: ${Number(e.join_date.slice(0, 4)) - int(1, 8)}`]],
          ...(e.grade !== 'Executive' || chance(0.6) ? [['Experience', 'Relieving Letter - Previous Employer', 'Relieving Letter', [`${name} has been relieved from their duties`, 'with effect from the close of business on the last working day.', 'We wish them the very best.']]] : []),
          ['Offer Letter', 'Offer Letter', 'BrainADZ - Offer of Employment', [`Dear ${e.first_name},`, `We are pleased to offer you the role of ${e.designation}.`, `Annual CTC: Rs ${Number(e.ctc).toLocaleString('en-IN')}`, `Date of joining: ${e.join_date}`, 'Welcome to BrainADZ - People | Process | Possibilities.']],
          ['Appointment Letter', 'Appointment Letter', 'BrainADZ - Letter of Appointment', [`Employee: ${name} (${e.code})`, `Designation: ${e.designation}`, `Date of joining: ${e.join_date}`, 'Probation: 6 months. Notice period as per company policy.']],
          ['Bank Proof', 'Cancelled Cheque', 'Cancelled Cheque', [`Account holder: ${name}`, `Bank: ${e.bank_name}`, `Account: XXXXXXXX${String(e.bank_account).slice(-4)}`, `IFSC: ${e.ifsc}`]],
        ];
        for (const [cat, docName, heading, lines] of plan) if (!skip.has(cat)) addDoc(e, cat, docName, heading, lines, by);
      }
    }

    // ---------- offices and location log ----------
    // Sample office coordinates; update them in Settings > Office locations.
    // The sign-in location rule starts off, and the log shows what today's
    // check-ins and two refused sign-ins look like.
    const officeOf = {};
    for (const [loc, lat, lng] of [['Bengaluru', 12.9784, 77.6408], ['Mumbai', 19.1136, 72.8697], ['Delhi NCR', 28.495, 77.0895]]) {
      const oid = db.insert('office_sites', { name: `${loc} office`, location_id: lId[loc], lat, lng, radius_m: 300 });
      officeOf[lId[loc]] = db.get('SELECT * FROM office_sites WHERE id = ?', oid);
    }
    const near = (s, metres) => {
      const angle = rand() * 2 * Math.PI;
      const d = metres * (0.2 + 0.8 * rand());
      return { lat: s.lat + (d * Math.cos(angle)) / 111320, lng: s.lng + (d * Math.sin(angle)) / (111320 * Math.cos((s.lat * Math.PI) / 180)) };
    };
    const logAt = (emp, at, event, result, s, p) => db.insert('location_log', {
      user_id: users[emp.id] || null, employee_id: emp.id, at, event, result, site_id: s.id, site_name: s.name,
      distance_m: Math.round(distanceM(p, s)), lat: p.lat, lng: p.lng, accuracy_m: int(12, 65),
    });
    for (const a of db.all('SELECT employee_id, check_in FROM attendance WHERE date = ? AND check_in IS NOT NULL', T)) {
      const emp = all.find((x) => x.id === a.employee_id);
      const s = officeOf[emp?.location_id] || officeOf[lId.Bengaluru];
      if (emp) logAt(emp, a.check_in, 'check-in', 'in-office', s, near(s, 160));
    }
    for (const [nm, hm] of [['Kavya Singh', '08:41'], ['Rohit Verma', '09:06']]) {
      const emp = byName[nm];
      const s = officeOf[emp.location_id] || officeOf[lId.Bengaluru];
      logAt(emp, isoAt(T, hm), 'sign-in blocked', 'outside', s, near(s, 6500 + int(0, 3000)));
    }

    // ---------- work sessions and short hours ----------
    // People who stepped out during the past week: Aarav's client meeting
    // left him short on the last working day and he has not explained it
    // yet; other short days are explained, decided, or waiting on a manager.
    const setSessions = (emp, d, parts, mode = 'office') => {
      db.run('DELETE FROM work_sessions WHERE employee_id = ? AND date = ?', emp.id, d);
      parts.forEach(([a, b, reason, note], i) => db.insert('work_sessions', {
        employee_id: emp.id, date: d, start_at: isoAt(d, a), end_at: isoAt(d, b), mode,
        ended_by: i < parts.length - 1 ? 'signout' : 'checkout', gap_reason: i ? reason : null, gap_note: i ? note || null : null,
      }));
      syncAttendance(db, emp.id, d, null);
    };
    const recentDays = (emp, k) => db.all("SELECT date FROM attendance WHERE employee_id = ? AND date < ? AND date >= ? AND status = 'P' ORDER BY date DESC LIMIT ?", emp.id, T, D.addDays(T, -7), k).map((r) => r.date);
    const explain = (emp, reason, daysAgo = 0) => {
      const s = db.get("SELECT * FROM hour_shortfalls WHERE employee_id = ? ORDER BY date DESC LIMIT 1", emp.id);
      if (!s) return;
      db.update('hour_shortfalls', s.id, { status: 'Pending approval', reason, explained_at: isoAt(D.addDays(T, -daysAgo), '10:15') });
      for (const uid of approverUserIds(db, emp.id)) n(uid, `${fullName(emp)} explained short hours on ${dayLabel(s.date)} (${fmtMinutes(s.worked_minutes)} of ${fmtMinutes(s.required_minutes)})`, '/attendance?tab=short', daysAgo);
    };
    const scripted = [];
    const [aDay, , aEarlier] = recentDays(aarav, 3);
    if (aDay) { setSessions(aarav, aDay, [['09:18', '13:02'], ['15:20', '18:05', 'Client meeting', 'Brand review with Raymond at Thane']]); scripted.push(aarav); }
    if (aEarlier) setSessions(aarav, aEarlier, [['09:25', '13:30'], ['14:10', '18:40', 'Lunch break']]);
    const vikram = byName['Vikram Patel'];
    const vReports = current.filter((e) => e.manager_id === vikram.id);
    const scriptedPlans = [
      [vReports[0], [['09:40', '12:10'], ['14:45', '17:55', 'Site / field visit', 'Stall measurements at Bombay Exhibition Centre']], 'Went to BEC for the expo stall measurements; travel back took longer than planned.'],
      [vReports[1], [['09:35', '16:50']], "Left early for my daughter's school annual day. I will cover the time on Friday."],
      [current.find((e) => e.manager_id === ceo.id), [['08:50', '15:30']], 'Evening flight to Delhi for the Auto Expo pitch; worked on the deck at the airport.'],
    ];
    for (const [emp, parts] of scriptedPlans) {
      const d = emp && recentDays(emp, 2)[1];
      if (d) { setSessions(emp, d, parts); scripted.push(emp); }
    }
    generateShortfalls(db, { today: T, notify: false });
    for (const [emp, , reason] of scriptedPlans) if (emp && scripted.includes(emp)) explain(emp, reason, 0);
    const aShort = aDay && db.get('SELECT * FROM hour_shortfalls WHERE employee_id = ? AND date = ?', aarav.id, aDay);
    if (aShort) n(users[aarav.id], `You worked ${fmtMinutes(aShort.worked_minutes)} of ${fmtMinutes(aShort.required_minutes)} on ${dayLabel(aDay)}. Please tell your manager why.`, '/attendance?tab=short', 0);
    const lastWorking = db.value('SELECT MAX(date) FROM hour_shortfalls');
    const reasons = ['Doctor appointment in the evening.', 'Stuck in traffic after heavy rain; worked from home in the evening.', 'Bank work for a home loan; will make up the hours this week.', 'Client call ran from the car on the way back from a site visit.', 'Felt unwell and left early.', 'Family function in the evening.'];
    const scriptedIds = new Set(scripted.map((e) => e.id));
    for (const s of db.all("SELECT * FROM hour_shortfalls WHERE status = 'Awaiting explanation'")) {
      if (scriptedIds.has(s.employee_id)) continue;
      if (s.date === lastWorking && chance(0.5)) continue;
      const r = rand();
      const decided = s.date !== lastWorking && r < 0.7;
      const reject = decided && r < 0.12 && D.monthOf(s.date) === thisMonth;
      const approver = approverUserIds(db, s.employee_id)[0] || ceoUser;
      db.update('hour_shortfalls', s.id, {
        reason: pick(reasons), explained_at: isoAt(D.addDays(s.date, 1), '10:00'),
        status: decided ? (reject ? 'Rejected' : 'Approved') : 'Pending approval',
        decided_by: decided ? approver : null, decided_at: decided ? isoAt(D.addDays(s.date, 1), '16:00') : null,
      });
      if (reject) db.run("UPDATE attendance SET status = 'HD', note = 'Short hours not approved' WHERE employee_id = ? AND date = ?", s.employee_id, s.date);
      else if (decided) db.run("UPDATE attendance SET status = CASE status WHEN 'HD' THEN 'P' ELSE status END WHERE employee_id = ? AND date = ?", s.employee_id, s.date);
    }
  });
}

export function policyLibrary(T) {
  const d = (n) => new Date(`${D.addDays(T, -n)}T10:00:00+05:30`).toISOString();
  return [
    {
      title: 'Leave Policy', category: 'Leave', version: '3.2', requires_ack: 1, updated_at: d(4), created_at: d(900),
      summary: 'Leave entitlements, accrual, carry forward, approvals and holidays.',
      content: `## 1. Purpose\nThis policy sets out the leave every BrainADZ employee is entitled to and how to apply for it.\n\n## 2. Entitlements (per calendar year)\n- Earned Leave (EL): 20 days, accrued monthly. Up to 5 unused days carry forward to the next year.\n- Casual Leave (CL): 12 days, credited in January (pro-rated for joiners). No carry forward.\n- Sick Leave (SL): 10 days. A medical certificate is required for absences longer than 3 days.\n- Maternity Leave: 26 weeks as per the Maternity Benefit Act, 1961.\n- Paternity Leave: 15 days, to be availed within 6 months of birth or adoption.\n- Work From Home: up to 30 days a year with manager approval.\n- Loss of Pay: any absence beyond available balance is unpaid and deducted in payroll.\n\n## 3. Applying for leave\nApply in BrainADZ HRMS before the leave starts (sick leave may be applied on the day). Your reporting manager approves; HR can approve when the manager is unavailable.\n\n## 4. Weekly offs and holidays\nSaturdays and Sundays are weekly offs. Company holidays are published in the holiday calendar each January. Restricted holidays may be taken as Casual Leave.\n\n## 5. Attendance\nMark attendance daily in HRMS. Unapproved absence is treated as Loss of Pay.`,
    },
    {
      title: 'Employee Handbook', category: 'General', version: '2.1', requires_ack: 1, updated_at: d(210), created_at: d(1200),
      summary: 'How we work at BrainADZ: values, working hours, benefits and conduct.',
      content: `## Welcome to BrainADZ\nBrainADZ brings brands to life through Live events, Marketing and Exhibits.\n\n## Working hours\nCore hours are 9:30 am to 6:30 pm, Monday to Friday. Event and exhibition teams follow project schedules and receive compensatory off for weekend work.\n\n## Probation\nNew employees serve a 6-month probation with a review at the end of month 3 and month 6.\n\n## Benefits\n- Group health insurance for employee, spouse and two children\n- Provident Fund and gratuity as per law\n- Annual health check-up\n- Learning budget of Rs 15,000 per year\n\n## Notice period\n30 days for executives and 60 days for managers and above.`,
    },
    {
      title: 'Code of Conduct', category: 'Compliance', version: '1.8', requires_ack: 1, updated_at: d(240), created_at: d(1300),
      summary: 'Ethics, conflicts of interest, gifts, confidentiality and client conduct.',
      content: `## Our standards\nAct with integrity with clients, vendors and colleagues.\n\n## Conflicts of interest\nDeclare any personal interest in a vendor or client to your manager and HR.\n\n## Gifts\nGifts above Rs 2,000 from vendors must be declared and may not be accepted during an active tender.\n\n## Confidentiality\nClient briefs, budgets and designs are confidential and may not be shared outside BrainADZ.\n\n## Reporting concerns\nRaise concerns with your manager, HR, or the ethics mailbox. Retaliation against anyone raising a concern in good faith is prohibited.`,
    },
    {
      title: 'POSH Policy', category: 'POSH', version: '2.5', requires_ack: 1, updated_at: d(190), created_at: d(1300),
      summary: 'Prevention of Sexual Harassment at the Workplace, the ICC and how to raise a complaint.',
      content: `## 1. Commitment\nBrainADZ provides a safe workplace free from sexual harassment, in line with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013. This policy covers offices, client sites, events, travel and online communication.\n\n## 2. Internal Committee (ICC)\nThe ICC is chaired by a senior woman employee and includes at least two employee members and one external member from an NGO or with legal expertise. At least half the members are women.\n\n## 3. Raising a complaint\nA complaint may be made in writing to the ICC within 3 months of the incident (extendable by 3 months). Use HRMS → POSH → Raise a concern, or email the ICC. Complaints are confidential.\n\n## 4. Inquiry\nThe ICC completes its inquiry within 90 days and submits its report within 10 days of completion. Both parties are heard. Interim relief such as a change of reporting line or leave may be granted.\n\n## 5. Confidentiality and non-retaliation\nThe identity of the parties, witnesses and the proceedings are confidential. Retaliation is misconduct.\n\n## 6. Training\nEvery employee completes POSH awareness training on joining and once a year.`,
    },
    {
      title: 'IT & Information Security Policy', category: 'IT', version: '1.3', requires_ack: 1, updated_at: d(130), created_at: d(800),
      summary: 'Acceptable use of laptops, accounts, passwords and client data.',
      content: `## Devices\nCompany laptops must have disk encryption and automatic updates enabled. Report a lost device to IT within 2 hours.\n\n## Accounts and passwords\nUse a password manager and multi-factor authentication. Never share passwords.\n\n## Client data\nStore client files only in approved company drives. Do not use personal email or USB drives for client data.\n\n## Exit\nReturn all devices and access cards on your last working day.`,
    },
    {
      title: 'Travel & Expense Policy', category: 'Finance', version: '1.0', requires_ack: 0, updated_at: d(320), created_at: d(320),
      summary: 'Booking travel, daily allowances and filing reimbursement claims.',
      content: `## Booking\nBook travel through the Admin travel desk at least 7 days ahead where possible.\n\n## Allowances\n- Metro cities: Rs 1,500 per day\n- Other cities: Rs 1,000 per day\n\n## Claims\nSubmit reimbursement claims with bills within 30 days. Approved claims are paid with the next payroll.`,
    },
  ];
}

export function hasData(db) {
  return Boolean(db.value('SELECT COUNT(*) FROM employees'));
}

// First run without demo data: a company record and one administrator.
export function seedEmpty(db, { adminEmail, adminPassword }) {
  db.tx(() => {
    setSetting(db, 'demo', false);
    for (const v of VERTICALS) db.insert('verticals', v);
    for (const d of DEPARTMENTS) db.insert('departments', { name: d });
    for (const l of LOCATIONS) db.insert('locations', { name: l });
    LEAVE_TYPES.forEach((t, i) => db.insert('leave_types', { ...t, sort: i }));
    const year = D.yearOf(D.todayIn('Asia/Kolkata'));
    for (const y of [year, year + 1]) for (const [date, name, type] of holidaysFor(y)) db.insert('holidays', { date, name, type });
    for (const p of policyLibrary(D.todayIn('Asia/Kolkata'))) db.insert('policies', p);
    db.insert('users', { email: adminEmail, password_hash: hashPassword(adminPassword), role: 'admin', must_change_password: 1 });
  });
}

