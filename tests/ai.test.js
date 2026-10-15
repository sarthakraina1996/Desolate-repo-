// Exercises the Claude integration against a local stand-in for the
// Anthropic Messages API, checking the request we send and how we parse the reply.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let last;
const reply = {
  score: 87, verdict: 'Strong Fit', headline: 'Matches 4 of 4 must-have skills.',
  skills: [{ skill: 'React', score: 95, evidence: '6 years of React' }],
  matched: ['React'], missing: ['GraphQL (Preferred)'], summary: 'Strong frontend engineer.',
  knockout: [{ question: 'React?', answer: 'Yes', evidence: 'React projects' }],
  extracted: { name: 'Asha Rao', email: 'asha@example.com', phone: '', location: 'Pune, MH', currentCompany: 'Zoho', currentTitle: 'SDE 2', experienceYears: '6', education: 'B.Tech', expectedCtcLpa: '18 LPA', noticePeriodDays: '30', linkedin: '' },
};

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      last = { url: req.url, headers: req.headers, body: JSON.parse(body) };
      const isScreen = Boolean(last.body.output_config?.format);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: last.body.model, stop_reason: 'end_turn', stop_details: null,
        content: [{ type: 'text', text: isScreen ? JSON.stringify(reply) : 'Yes, she led a team of four.' }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('screenWithClaude sends a structured-output request and normalises the reply', async () => {
  const { screenWithClaude, aiEnabled } = await import('../server/services/ai.js');
  assert.equal(aiEnabled(), true);
  const out = await screenWithClaude({ title: 'Frontend', must_have: ['React'], knockout: ['React?'] }, { text: 'Asha Rao resume' });
  assert.equal(last.url, '/v1/messages?beta=true');
  assert.equal(last.body.model, 'claude-opus-5-5');
  assert.equal(last.body.output_config.format.type, 'json_schema');
  assert.equal(last.body.fallbacks, 'default');
  assert.match(last.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(out.score, 87);
  assert.equal(out.extracted.experienceYears, 6);
  assert.equal(out.extracted.expectedCtcLpa, 18);
  assert.equal(out.extracted.phone, null);
});

test('PDF resumes are sent as a document block', async () => {
  const { screenWithClaude } = await import('../server/services/ai.js');
  await screenWithClaude({ title: 'Frontend', must_have: [] }, { pdfBase64: Buffer.from('%PDF-1.4').toString('base64') });
  assert.equal(last.body.messages[0].content[0].type, 'document');
  assert.equal(last.body.messages[0].content[0].source.media_type, 'application/pdf');
});

test('askClaude returns the text answer', async () => {
  const { askClaude } = await import('../server/services/ai.js');
  const a = await askClaude({ title: 'Frontend', must_have: [] }, { name: 'Asha' }, { text: 'resume' }, 'Did she lead a team?');
  assert.equal(a, 'Yes, she led a team of four.');
});
