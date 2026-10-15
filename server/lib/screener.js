// Rule-based resume screening. Used when no Claude API key is configured, for
// seed data, and as the field extractor for every uploaded resume.

const SYNONYMS = {
  javascript: ['javascript', 'js', 'es6', 'ecmascript'],
  typescript: ['typescript', 'ts'],
  react: ['react', 'react.js', 'reactjs', 'react js'],
  redux: ['redux', 'redux toolkit', 'rtk'],
  html: ['html', 'html5'],
  css: ['css', 'css3', 'scss', 'sass', 'tailwind', 'styled-components'],
  node: ['node', 'node.js', 'nodejs'],
  'node.js': ['node', 'node.js', 'nodejs'],
  'next.js': ['next.js', 'nextjs', 'next js'],
  graphql: ['graphql', 'apollo'],
  'ms office': ['ms office', 'microsoft office', 'excel', 'powerpoint', 'word'],
  'social media': ['social media', 'instagram', 'linkedin marketing', 'facebook ads', 'meta ads'],
  seo: ['seo', 'search engine optimisation', 'search engine optimization'],
  'google ads': ['google ads', 'adwords', 'sem', 'ppc'],
  photoshop: ['photoshop', 'adobe photoshop'],
  illustrator: ['illustrator', 'adobe illustrator'],
  'autocad': ['autocad', 'auto cad'],
  '3ds max': ['3ds max', '3dsmax', '3d studio max'],
  'event management': ['event management', 'events', 'event planning', 'event execution'],
  'b2b sales': ['b2b sales', 'b2b', 'enterprise sales', 'corporate sales'],
  crm: ['crm', 'salesforce', 'hubspot', 'zoho crm'],
  'vendor management': ['vendor management', 'vendors', 'vendor coordination'],
};

const DEGREES = [
  ['B.Tech', /\bb\.?\s?tech\b/i], ['B.E.', /\bb\.?\s?e\.?(?=[\s,(-])/i], ['BCA', /\bbca\b/i], ['MCA', /\bmca\b/i],
  ['M.Tech', /\bm\.?\s?tech\b/i], ['MBA', /\bmba\b/i], ['PGDM', /\bpgdm\b/i], ['B.Sc', /\bb\.?\s?sc\b/i],
  ['M.Sc', /\bm\.?\s?sc\b/i], ['B.Com', /\bb\.?\s?com\b/i], ['M.Com', /\bm\.?\s?com\b/i], ['BBA', /\bbba\b/i],
  ['B.Des', /\bb\.?\s?des\b/i], ['M.Des', /\bm\.?\s?des\b/i], ['BMM', /\bbmm\b/i], ['B.A.', /\bb\.?\s?a\.?(?=[\s,(-])/i],
  ['M.A.', /\bm\.?\s?a\.?(?=[\s,(-])/i], ['Diploma', /\bdiploma\b/i],
];

const CITY_ALIASES = {
  bengaluru: ['bengaluru', 'bangalore', 'blr'],
  mumbai: ['mumbai', 'navi mumbai', 'thane', 'bombay'],
  'delhi ncr': ['delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'ncr', 'faridabad', 'ghaziabad'],
  pune: ['pune'],
  chennai: ['chennai', 'madras'],
  hyderabad: ['hyderabad'],
  kolkata: ['kolkata', 'calcutta'],
};
const CITY_DISPLAY = { bengaluru: 'Bengaluru, KA', mumbai: 'Mumbai, MH', 'delhi ncr': 'Delhi NCR', pune: 'Pune, MH', chennai: 'Chennai, TN', hyderabad: 'Hyderabad, TS', kolkata: 'Kolkata, WB' };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = (t) => new RegExp(`(?<![a-z0-9])${esc(t.toLowerCase())}(?![a-z0-9])`, 'g');

export function countMentions(text, skill) {
  const lower = text.toLowerCase();
  const terms = SYNONYMS[skill.toLowerCase()] || [skill.toLowerCase()];
  let n = 0;
  let evidence = '';
  for (const t of terms) {
    const re = termRe(t);
    let m;
    while ((m = re.exec(lower))) {
      n++;
      if (!evidence) {
        const start = Math.max(0, m.index - 50);
        evidence = text.slice(start, m.index + t.length + 60).replace(/\s+/g, ' ').trim();
      }
    }
  }
  return { count: n, evidence };
}

function cityKey(s) {
  const lower = String(s || '').toLowerCase();
  for (const [key, aliases] of Object.entries(CITY_ALIASES)) if (aliases.some((a) => termRe(a).test(lower))) return key;
  return null;
}

export function extractFields(text, { fileName } = {}) {
  const t = String(text || '');
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = {};
  out.email = (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0] || null;
  const phone = t.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/);
  out.phone = phone ? phone[0].replace(/[^\d+]/g, '').replace(/^(\d{10})$/, '+91 $1').replace(/^\+?91(\d{10})$/, '+91 $1') : null;
  out.linkedin = (t.match(/linkedin\.com\/in\/[A-Za-z0-9_-]+/i) || [])[0] || null;

  const nameLine = lines.slice(0, 6).find((l) => /^[A-Za-z][A-Za-z.' -]{2,40}$/.test(l)
    && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 4
    && !/resume|curriculum|vitae|profile|summary|developer|engineer|manager|designer|executive/i.test(l));
  out.name = nameLine ? nameLine.replace(/\s+/g, ' ') : null;
  if (!out.name && fileName) {
    const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\b(resume|cv|final|updated|\d+)\b/gi, '').trim();
    if (base) out.name = base.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  let exp = null;
  const expRe = /(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:total\s+)?(?:work\s+)?experience)?/gi;
  let m;
  while ((m = expRe.exec(t))) {
    const v = Number(m[1]);
    if (v <= 45 && (exp == null || v > exp)) exp = v;
  }
  out.experience = exp;

  const degrees = DEGREES.filter(([, re]) => re.test(t)).map(([d]) => d);
  out.education = degrees.length ? degrees.slice(0, 2).join(', ') : null;
  out.degrees = degrees;

  const company = t.match(/(?:current(?:ly)?\s+(?:company|employer|working at|at)|presently\s+(?:at|with))\s*[:\-]?\s*([A-Z][A-Za-z0-9&.,' ]{1,40})/i);
  out.currentCompany = company ? company[1].replace(/[.,\s]+$/, '').trim() : null;
  const title = t.match(/(?:current\s+(?:role|designation|title)|designation)\s*[:\-]\s*([A-Za-z/&,' ]{2,50})/i);
  out.currentTitle = title ? title[1].trim() : null;

  const loc = t.match(/(?:location|based in|current location|address)\s*[:\-]?\s*([A-Za-z ,]{3,40})/i);
  const key = cityKey(loc ? loc[1] : lines.slice(0, 8).join(' '));
  out.location = key ? CITY_DISPLAY[key] : null;

  const ctc = t.match(/expected\s+(?:ctc|salary|compensation)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:lpa|lakhs?|l\b)/i);
  out.expectedCtc = ctc ? Number(ctc[1]) : null;
  const cur = t.match(/current\s+(?:ctc|salary)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:lpa|lakhs?|l\b)/i);
  out.currentCtc = cur ? Number(cur[1]) : null;
  const notice = t.match(/notice\s+period\s*[:\-]?\s*(\d{1,3})\s*(days?|months?)/i);
  out.noticeDays = notice ? Number(notice[1]) * (/month/i.test(notice[2]) ? 30 : 1) : null;
  return out;
}

const verdictFor = (s) => (s >= 80 ? 'Strong Fit' : s >= 65 ? 'Good Fit' : s >= 45 ? 'Partial Fit' : 'Weak Fit');

// job: { title, must_have[], nice_to_have[], exp_min, exp_max, education, location, work_mode, salary_min, salary_max, knockout[] }
export function heuristicScreen(job, text, fields = extractFields(text)) {
  const must = job.must_have || [];
  const nice = job.nice_to_have || [];
  const skills = must.map((skill) => {
    const { count, evidence } = countMentions(text, skill);
    return { skill, score: count ? Math.min(100, 55 + count * 12) : 0, evidence: evidence || 'Not mentioned in the resume' };
  });
  const matchedSkills = skills.filter((s) => s.score > 0);
  const skillScore = skills.length ? skills.reduce((t, s) => t + s.score, 0) / skills.length : 70;
  const niceHits = nice.filter((s) => countMentions(text, s).count > 0);

  const exp = fields.experience;
  let expScore = 50;
  if (exp != null && job.exp_min != null) {
    const max = job.exp_max ?? job.exp_min + 5;
    if (exp >= job.exp_min && exp <= max) expScore = 100;
    else if (exp < job.exp_min) expScore = Math.max(0, 100 - (job.exp_min - exp) * 25);
    else expScore = Math.max(60, 100 - (exp - max) * 8);
  }

  const wanted = DEGREES.filter(([, re]) => re.test(job.education || '')).map(([d]) => d);
  let eduScore = fields.degrees?.length ? 60 : 30;
  if (wanted.length && fields.degrees?.some((d) => wanted.includes(d))) eduScore = 100;
  else if (!wanted.length && fields.degrees?.length) eduScore = 90;

  const jobCity = cityKey(job.location);
  const candCity = cityKey(fields.location);
  const remote = /remote/i.test(job.work_mode || '') || /remote/i.test(job.location || '');
  const locScore = remote || (jobCity && jobCity === candCity) ? 100 : candCity ? 45 : 60;

  let salScore = 70;
  if (fields.expectedCtc != null && job.salary_max) {
    salScore = fields.expectedCtc <= job.salary_max ? 100 : Math.max(0, 100 - ((fields.expectedCtc - job.salary_max) / job.salary_max) * 200);
  }

  const score = Math.round(Math.min(100, skillScore * 0.55 + expScore * 0.2 + eduScore * 0.1 + locScore * 0.1 + salScore * 0.05 + niceHits.length * 2));

  const matched = [];
  const missing = [];
  for (const s of skills) (s.score > 0 ? matched : missing).push(s.skill);
  for (const s of nice) (niceHits.includes(s) ? matched : missing).push(`${s} (Preferred)`);
  if (exp != null && job.exp_min != null) (expScore === 100 ? matched : missing).push(`${job.exp_min}${job.exp_max ? `-${job.exp_max}` : '+'} Years Experience`);
  if (wanted.length) (eduScore === 100 ? matched : missing).push(wanted.join(' / '));
  if (jobCity) (locScore === 100 ? matched : missing).push(`${job.location} Location`);
  if (fields.expectedCtc != null && job.salary_max) (salScore === 100 ? matched : missing).push('Expected Salary in Range');

  const knockout = (job.knockout || []).map((q) => {
    const words = q.toLowerCase().match(/[a-z][a-z.+#]{3,}/g) || [];
    const stop = new Set(['have', 'experience', 'with', 'your', 'open', 'work', 'model', 'are', 'you', 'able', 'willing', 'join', 'within', 'days', 'from', 'this', 'that']);
    const key = words.filter((w) => !stop.has(w));
    const hit = key.find((w) => countMentions(text, w).count > 0 || (cityKey(w) && cityKey(w) === candCity));
    return { question: q, answer: hit ? 'Yes' : 'Unclear', evidence: hit ? `Resume mentions "${hit}"` : 'Not addressed in the resume' };
  });

  const verdict = verdictFor(score);
  const name = fields.name || 'The candidate';
  const headline = must.length
    ? `${verdict === 'Strong Fit' || verdict === 'Good Fit' ? 'Good' : 'Limited'} match with ${matchedSkills.length} of ${must.length} must-have skills${exp != null ? ` and ${exp} years of experience` : ''}.`
    : `${verdict} based on experience and profile.`;
  const summary = `${name}${fields.currentTitle ? `, ${fields.currentTitle}` : ''}${fields.currentCompany ? ` at ${fields.currentCompany}` : ''}`
    + `${exp != null ? `, has about ${exp} years of experience` : ''}. `
    + (matchedSkills.length ? `The resume shows ${matchedSkills.map((s) => s.skill).join(', ')}. ` : 'The resume does not mention the must-have skills. ')
    + (missing.length ? `Gaps to probe: ${missing.slice(0, 3).join(', ')}.` : 'No obvious gaps against the requirement.');

  return {
    score,
    verdict,
    headline,
    skills,
    matched,
    missing,
    summary,
    knockout,
    extracted: {
      name: fields.name, email: fields.email, phone: fields.phone, location: fields.location,
      currentCompany: fields.currentCompany, currentTitle: fields.currentTitle,
      experienceYears: fields.experience, education: fields.education,
      expectedCtcLpa: fields.expectedCtc, noticePeriodDays: fields.noticeDays, linkedin: fields.linkedin,
    },
  };
}

// Keyword answer used for "Ask AI" when Claude is not configured.
export function searchResume(text, question) {
  const words = (question.toLowerCase().match(/[a-z][a-z.+#]{2,}/g) || [])
    .filter((w) => !['what', 'does', 'have', 'with', 'the', 'and', 'how', 'many', 'candidate', 'their', 'has', 'any', 'about', 'did', 'is', 'are', 'for'].includes(w));
  const sentences = String(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 15);
  const scored = sentences.map((s) => ({ s, n: words.filter((w) => s.toLowerCase().includes(w)).length })).filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n).slice(0, 3);
  if (!scored.length) return 'The resume does not appear to mention this. Add a Claude API key in the server settings for a full AI answer.';
  return `From the resume:\n${scored.map((x) => `• ${x.s}`).join('\n')}`;
}
