import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFields, heuristicScreen, searchResume } from '../server/lib/screener.js';

const job = { title: 'Senior Frontend Developer', must_have: ['React', 'JavaScript', 'TypeScript', 'Redux'], nice_to_have: ['GraphQL'], exp_min: 4, exp_max: 8, education: 'B.Tech / B.E. in CS', location: 'Bengaluru', work_mode: 'Hybrid', salary_min: 12, salary_max: 20, knockout: ['Do you have experience with React?'] };
const resume = `Ananya Rao
Frontend Engineer | Bengaluru
Email: ananya.rao@example.com | Phone: +91 98765 43210
Total Experience: 6 years
Current Company: Flipkart
Skills: React.js, JS, TypeScript, Redux Toolkit, GraphQL
B.Tech CSE, NIT Trichy (2018)
Expected CTC: 18 LPA, Notice Period: 2 months`;

test('extracts contact and career fields', () => {
  const f = extractFields(resume);
  assert.equal(f.name, 'Ananya Rao');
  assert.equal(f.email, 'ananya.rao@example.com');
  assert.equal(f.phone, '+91 9876543210');
  assert.equal(f.experience, 6);
  assert.equal(f.currentCompany, 'Flipkart');
  assert.equal(f.location, 'Bengaluru, KA');
  assert.equal(f.expectedCtc, 18);
  assert.equal(f.noticeDays, 60);
  assert.ok(f.degrees.includes('B.Tech'));
});

test('strong resume scores high and matches synonyms', () => {
  const a = heuristicScreen(job, resume);
  assert.ok(a.score >= 85, `score ${a.score}`);
  assert.equal(a.verdict, 'Strong Fit');
  assert.ok(a.skills.every((s) => s.score > 0));
  assert.equal(a.knockout[0].answer, 'Yes');
});

test('weak resume scores low and lists gaps', () => {
  const a = heuristicScreen(job, 'Rahul Verma\nAccountant\nTotal Experience: 1 year\nTally, GST, Excel\nLocation: Kolkata');
  assert.ok(a.score < 45, `score ${a.score}`);
  assert.ok(a.missing.includes('React'));
});

test('keyword answer quotes the resume', () => {
  assert.match(searchResume(resume, 'Which company is she at?'), /Flipkart/);
});
