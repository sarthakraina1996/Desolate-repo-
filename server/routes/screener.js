import fs from 'node:fs';
import path from 'node:path';
import { isHR, requireHR, str, id, fail, notFound, oneOf, today } from '../core.js';
import { json } from '../db.js';
import { aiEnabled, screenWithClaude, askClaude, AI_MODEL } from '../services/ai.js';
import { extractResumeText, RESUME_EXTS } from '../services/resume.js';
import { heuristicScreen, extractFields, searchResume } from '../lib/screener.js';
import { JOB_SELECT, shapeJob, shapeCandidate, logActivity, assertCandidateAccess, STAGES } from './hiring.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const phoneKey = (s) => String(s || '').replace(/\D/g, '').slice(-10);

export default function screenerRoutes(r, { db, uploads, upload }) {
  // ---------- background screening queue ----------
  const queue = [];
  let running = 0;
  const CONCURRENCY = 3;
  const pump = () => {
    while (running < CONCURRENCY && queue.length) {
      const cid = queue.shift();
      running++;
      screenCandidate(cid).catch((e) => console.error('screening failed', e)).finally(() => {
        running--;
        pump();
      });
    }
  };
  const enqueue = (cid) => {
    db.run("UPDATE candidates SET screen_status = 'queued', screen_error = NULL WHERE id = ?", cid);
    queue.push(cid);
    setImmediate(pump);
  };
  // Resume anything left mid-screening by a previous run of the server.
  for (const c of db.all("SELECT id FROM candidates WHERE screen_status IN ('queued','processing')")) {
    queue.push(c.id);
  }
  setImmediate(pump);

  async function screenCandidate(cid) {
    const c = db.get('SELECT * FROM candidates WHERE id = ?', cid);
    if (!c) return;
    const jobRow = c.job_id ? db.get(`${JOB_SELECT} WHERE j.id = ?`, c.job_id) : null;
    if (!jobRow) {
      db.update('candidates', cid, { screen_status: 'error', screen_error: 'Candidate is not linked to a job' });
      return;
    }
    db.update('candidates', cid, { screen_status: 'processing' });
    const job = shapeJob(jobRow);
    const jobInfo = { ...job, location: job.location };
    let text = c.resume_text || '';
    const file = c.resume_file ? path.join(uploads, 'resumes', path.basename(c.resume_file)) : null;
    try {
      if (!text && file) text = await extractResumeText(file, path.extname(file).toLowerCase());
    } catch (e) {
      db.update('candidates', cid, { screen_status: 'error', screen_error: `Could not read the resume: ${e.message}` });
      return;
    }
    const fields = extractFields(text, { fileName: c.resume_name });
    let analysis;
    let engine = 'rules';
    let note = null;
    if (aiEnabled()) {
      try {
        const isPdf = file && path.extname(file).toLowerCase() === '.pdf';
        const resume = isPdf ? { pdfBase64: (await fs.promises.readFile(file)).toString('base64') } : { text: text || '(empty resume)' };
        analysis = await screenWithClaude(jobInfo, resume);
        engine = AI_MODEL;
      } catch (e) {
        note = `AI screening unavailable (${e.message}); used rule-based scoring.`;
      }
    }
    if (!analysis) analysis = heuristicScreen(jobInfo, text, fields);
    const x = analysis.extracted || {};
    const pickVal = (cur, ...vals) => (cur != null && cur !== '' ? cur : vals.find((v) => v != null && v !== '') ?? null);
    const fresh = db.get('SELECT * FROM candidates WHERE id = ?', cid);
    const placeholderName = !fresh.name || fresh.name === fresh.resume_name || /^Candidate \d+$/.test(fresh.name);
    db.update('candidates', cid, {
      ai: analysis,
      ai_score: analysis.score,
      ai_engine: engine,
      screen_status: 'done',
      screen_error: note,
      resume_text: text || fresh.resume_text,
      name: placeholderName ? (x.name || fields.name || fresh.name) : fresh.name,
      email: pickVal(fresh.email, x.email, fields.email),
      phone: pickVal(fresh.phone, x.phone, fields.phone),
      location: pickVal(fresh.location, x.location, fields.location),
      current_company: pickVal(fresh.current_company, x.currentCompany, fields.currentCompany),
      current_title: pickVal(fresh.current_title, x.currentTitle, fields.currentTitle),
      experience: pickVal(fresh.experience, x.experienceYears, fields.experience),
      education: pickVal(fresh.education, x.education, fields.education),
      expected_ctc: pickVal(fresh.expected_ctc, x.expectedCtcLpa, fields.expectedCtc),
      notice_days: pickVal(fresh.notice_days, x.noticePeriodDays, fields.noticeDays),
      linkedin: pickVal(fresh.linkedin, x.linkedin, fields.linkedin),
      skills: (analysis.skills || []).filter((s) => s.score > 0).map((s) => s.skill),
      stage: fresh.stage === 'Applied' ? 'AI Screened' : fresh.stage,
      max_stage: Math.max(fresh.max_stage, 1),
      updated_at: new Date().toISOString(),
    });
    logActivity(db, cid, `Resume screened · ${analysis.score}% match (${engine === 'rules' ? 'rule-based' : 'Claude AI'})`, { name: 'Resume Screener AI' });
  }

  function duplicatesFor(jobId) {
    const all = db.all('SELECT c.id, c.name, c.email, c.phone, c.job_id, c.stage, j.title FROM candidates c LEFT JOIN jobs j ON j.id = c.job_id');
    const groups = new Map();
    const add = (key, c) => {
      if (!key) return;
      if (!groups.has(key)) groups.set(key, new Map());
      groups.get(key).set(c.id, c);
    };
    for (const c of all) {
      add(c.email ? `e:${c.email.toLowerCase()}` : null, c);
      add(phoneKey(c.phone).length === 10 ? `p:${phoneKey(c.phone)}` : null, c);
      add(norm(c.name).length > 5 ? `n:${norm(c.name)}` : null, c);
    }
    const seen = new Set();
    const out = [];
    for (const [key, m] of groups) {
      if (m.size < 2) continue;
      const list = [...m.values()];
      if (!list.some((c) => c.job_id === jobId)) continue;
      const sig = list.map((c) => c.id).sort().join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ reason: key.startsWith('e:') ? 'Same email' : key.startsWith('p:') ? 'Same phone' : 'Same name', candidates: list });
    }
    return out;
  }

  r.get('/screener', (req, res) => {
    requireHR(req);
    const jobs = db.all(`${JOB_SELECT} WHERE j.status != 'Closed' ORDER BY j.posted_on DESC`).map(shapeJob);
    const active = jobs.filter((j) => j.status === 'Active').sort((a, b) => b.applicants - a.applicants);
    const jobId = req.query.job ? id(req.query.job) : active[0]?.id || jobs[0]?.id;
    const job = jobId ? db.get(`${JOB_SELECT} WHERE j.id = ?`, jobId) : null;
    if (!job) return res.json({ jobs, job: null, candidates: [], duplicates: [], ai: aiEnabled() });
    const candidates = db.all(`SELECT * FROM candidates WHERE job_id = ? ORDER BY ai_score IS NULL, ai_score DESC, applied_on DESC`, job.id).map(shapeCandidate);
    res.json({
      jobs,
      job: shapeJob(job),
      candidates,
      duplicates: duplicatesFor(job.id),
      totals: {
        uploaded: db.value('SELECT COUNT(*) FROM candidates WHERE resume_file IS NOT NULL OR resume_text IS NOT NULL'),
        forJob: candidates.length,
        processing: candidates.filter((c) => ['queued', 'processing'].includes(c.screen_status)).length,
      },
      ai: aiEnabled(),
      model: aiEnabled() ? AI_MODEL : null,
    });
  });

  const resumeUpload = upload('resumes', { maxMb: 10, exts: RESUME_EXTS }).array('files', 25);
  r.post('/screener/jobs/:id/upload', resumeUpload, async (req, res) => {
    requireHR(req);
    const job = db.get('SELECT * FROM jobs WHERE id = ?', id(req.params.id)) || notFound('Job');
    if (!req.files?.length) fail(400, 'Choose at least one resume (PDF, DOCX or TXT)');
    const created = [];
    for (const f of req.files) {
      const ext = path.extname(f.originalname).toLowerCase();
      let text = '';
      try {
        text = await extractResumeText(f.path, ext);
      } catch {
        text = '';
      }
      const fields = extractFields(text, { fileName: f.originalname });
      const cid = db.insert('candidates', {
        job_id: job.id,
        name: fields.name || f.originalname.replace(/\.[a-z]+$/i, '').slice(0, 80),
        email: fields.email, phone: fields.phone, source: oneOf(req.body.source || 'Upload', ['Upload', 'LinkedIn', 'Naukri', 'Indeed', 'Company Website', 'Referrals', 'Other'], { name: 'Source' }),
        stage: 'Applied', applied_on: today(db),
        resume_file: f.filename, resume_name: f.originalname.slice(0, 150), resume_mime: f.mimetype, resume_text: text || null,
      });
      logActivity(db, cid, `Resume uploaded (${f.originalname})`, req.user);
      enqueue(cid);
      created.push(cid);
    }
    res.json({ created, ai: aiEnabled() });
  });

  r.post('/screener/candidates/:id/screen', (req, res) => {
    requireHR(req);
    const c = db.get('SELECT id FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    enqueue(c.id);
    res.json({ ok: true });
  });

  r.post('/screener/jobs/:id/screen-all', (req, res) => {
    requireHR(req);
    const ids = db.all("SELECT id FROM candidates WHERE job_id = ? AND (screen_status IS NULL OR screen_status = 'error') AND (resume_text IS NOT NULL OR resume_file IS NOT NULL)", id(req.params.id)).map((c) => c.id);
    ids.forEach(enqueue);
    res.json({ queued: ids.length });
  });

  r.post('/screener/candidates/:id/action', (req, res) => {
    requireHR(req);
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    const action = oneOf(req.body.action, ['shortlist', 'hold', 'reject', 'interview'], { required: true, name: 'Action' });
    const map = { shortlist: ['Shortlisted', 'Shortlist'], hold: ['On Hold', 'Hold'], reject: ['Rejected', 'Reject'], interview: ['Interview 1', 'Shortlist'] };
    const [stage, decision] = map[action];
    const idx = STAGES.indexOf(stage);
    db.update('candidates', c.id, { stage, decision, max_stage: Math.max(c.max_stage, idx), reject_reason: action === 'reject' ? (str(req.body.reason, { max: 200 }) || 'Not a match for the requirement') : c.reject_reason, updated_at: new Date().toISOString() });
    logActivity(db, c.id, `${decision === 'Shortlist' && action === 'interview' ? 'Moved to interview' : `Marked ${decision}`} from Resume Screener`, req.user);
    res.json({ ok: true, stage });
  });

  r.post('/screener/candidates/:id/ask', async (req, res) => {
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    assertCandidateAccess(db, req.user, c);
    const question = str(req.body.question, { required: true, max: 500, name: 'Question' });
    const text = c.resume_text || '';
    if (!aiEnabled()) return res.json({ answer: searchResume(text, question), engine: 'keyword search' });
    const job = c.job_id ? shapeJob(db.get(`${JOB_SELECT} WHERE j.id = ?`, c.job_id)) : { title: 'Unknown role' };
    const file = c.resume_file ? path.join(uploads, 'resumes', path.basename(c.resume_file)) : null;
    const isPdf = file && path.extname(file).toLowerCase() === '.pdf' && fs.existsSync(file);
    try {
      const resume = isPdf ? { pdfBase64: (await fs.promises.readFile(file)).toString('base64') } : { text: text || '(no resume text available)' };
      const answer = await askClaude(job, { name: c.name, summary: json(c.ai, {})?.summary }, resume, question);
      res.json({ answer, engine: AI_MODEL });
    } catch (e) {
      res.json({ answer: `${searchResume(text, question)}\n\n(AI unavailable: ${e.message})`, engine: 'keyword search' });
    }
  });

  r.get('/candidates/:id/resume', (req, res) => {
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    assertCandidateAccess(db, req.user, c);
    if (c.resume_file) {
      const file = path.join(uploads, 'resumes', path.basename(c.resume_file));
      if (fs.existsSync(file)) return res.download(file, c.resume_name || path.basename(file));
    }
    if (!c.resume_text) notFound('Resume');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${(c.name || 'resume').replace(/[^A-Za-z0-9 _-]/g, '')}.txt"`);
    res.send(c.resume_text);
  });

  r.get('/screener/status', (req, res) => {
    if (!isHR(req.user)) fail(403, 'Not allowed');
    res.json({ queued: queue.length, running });
  });
}
