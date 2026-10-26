import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { migrate, seedBasics } from '../core/setup.js';
import { seedDemo, seedGroupChats, demoEmail } from '../core/demo-seed.js';
import { handle } from '../core/api.js';
import { loadUser } from '../core/access.js';

const TODAY = '2026-10-13';
let clock = Date.parse(`${TODAY}T10:00:00.000Z`);
let db;
const services = {
  today: () => TODAY,
  now: () => new Date(clock).toISOString(),
  hashPassword: async (p) => `plain$${p}`,
  verifyPassword: async (p, h) => h === `plain$${p}`,
  removeStored: async () => {},
};
const idOf = (key) => db.get('SELECT id FROM users WHERE email = ?', demoEmail(key)).id;
const call = (who, method, path, { query, body } = {}) => handle({ db, user: loadUser(db, idOf(who)), query, body, services }, method, path);
const vid = (short) => db.get('SELECT id FROM verticals WHERE short = ?', short).id;
const rejects = (p, status) => assert.rejects(p, (e) => e.status === status);
const tick = (ms = 1000) => (clock += ms);

before(() => {
  db = openDb(':memory:');
  migrate(db);
  seedBasics(db);
  seedDemo(db, { today: TODAY, passwordHash: 'plain$demo1234' });
});

// A fresh Exhibits project owned by Neha, with nobody else on it yet.
async function newProject(name = 'Chat test stall') {
  tick();
  return call('suresh', 'POST', '/projects', { body: { vertical_id: vid('Exhibits'), name, owner_id: idOf('neha') } });
}

test('a project gets a group for the people working on it, and only they and heads can see it', async () => {
  const p = await newProject();
  const g = await call('neha', 'GET', `/groups/${p.id}`);
  assert.equal(g.role, 'member');
  assert.deepEqual(g.members.map((m) => m.id), [idOf('neha')]);
  assert.ok((await call('neha', 'GET', '/groups')).items.some((x) => x.id === p.id && x.member));

  // Same vertical but not on the project: the group does not exist for them.
  await rejects(call('rohan', 'GET', `/groups/${p.id}`), 404);
  assert.ok(!(await call('rohan', 'GET', '/groups')).items.some((x) => x.id === p.id));
  // Heads of the vertical (and the admin) can look in.
  assert.equal((await call('suresh', 'GET', `/groups/${p.id}`)).role, 'head');
  assert.equal((await call('rajiv', 'GET', `/groups/${p.id}`)).role, 'head');
  // Other verticals never see it, not even their heads.
  await rejects(call('kavita', 'GET', `/groups/${p.id}`), 404);
  await rejects(call('kavita', 'GET', `/groups/${p.id}/messages`), 404);
  await rejects(call('kavita', 'POST', `/groups/${p.id}/messages`, { body: { body: 'hi' } }), 404);
  for (const g2 of (await call('kavita', 'GET', '/groups')).items) assert.equal(g2.vertical, 'Marketing');
});

test('people join automatically when they get a task or join the team', async () => {
  const p = await newProject('Auto-join stall');
  tick();
  await call('neha', 'POST', `/projects/${p.id}/tasks`, { body: { title: 'Logistics to venue', assignee_id: idOf('kunal') } });
  tick();
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('tanvi')] } });
  const g = await call('kunal', 'GET', `/groups/${p.id}`);
  assert.deepEqual(g.members.map((m) => m.name).sort(), ['Kunal Verma', 'Neha Iyer', 'Tanvi Desai']);
  assert.equal(g.members.find((m) => m.name === 'Kunal Verma').open_tasks, 1);
  const notices = (await call('kunal', 'GET', `/groups/${p.id}/messages`)).items.filter((m) => m.kind === 'system').map((m) => m.body);
  assert.ok(notices.some((b) => b.includes('started this group')));
  assert.ok(notices.some((b) => b === 'Kunal Verma joined the group: Neha Iyer assigned them “Logistics to venue”.'));
  assert.ok(notices.some((b) => b === 'Neha Iyer added Tanvi Desai to the project team.'));
});

test('members chat, post updates and statuses; viewers can read but not post', async () => {
  const p = await newProject('Status stall');
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('rohan'), idOf('vikram')] } });
  tick();
  const msg = await call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Reached the venue, unloading now' } });
  assert.equal(msg.kind, 'message');
  assert.equal(msg.mine, true);
  tick();
  await call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { kind: 'update', body: 'Flooring done, carpet tomorrow' } });
  tick();
  await rejects(call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { kind: 'status', body: 'x' } }), 400);
  await rejects(call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { body: '   ' } }), 400);
  await call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { kind: 'status', status: 'blocked', body: 'Power not connected at the stall' } });

  // Asking for help reaches the owner.
  const ownerNotes = (await call('neha', 'GET', '/notifications')).items;
  assert.ok(ownerNotes.some((n) => n.text.startsWith('Rohan Das is blocked in the') && n.link === `/teams/${p.id}`));

  const g = await call('neha', 'GET', `/groups/${p.id}`);
  assert.equal(g.members.find((m) => m.name === 'Rohan Das').status.status, 'blocked');
  const list = (await call('neha', 'GET', '/groups')).items.find((x) => x.id === p.id);
  assert.equal(list.flags.blocked, 1);
  assert.equal(list.last.kind, 'status');
  const updates = (await call('neha', 'GET', `/groups/${p.id}/messages`, { query: { kind: 'updates' } })).items;
  assert.deepEqual(updates.map((m) => m.kind), ['update', 'status']);

  // Vikram only has view access to Exhibits: he can follow the group but not post.
  const asViewer = await call('vikram', 'GET', `/groups/${p.id}`);
  assert.equal(asViewer.can_post, false);
  await rejects(call('vikram', 'POST', `/groups/${p.id}/messages`, { body: { body: 'hello' } }), 403);
});

test('unread counts turn off once the group is opened; notices do not count', async () => {
  const p = await newProject('Unread stall');
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('tanvi')] } });
  await call('tanvi', 'POST', '/seen', { body: { scope: `group:${p.id}` } });
  tick();
  await call('neha', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Render v2 looks good' } });
  tick();
  await call('neha', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Send to the client today please' } });
  const unread = async (who) => (await call(who, 'GET', '/groups')).items.find((x) => x.id === p.id).unread;
  assert.equal(await unread('tanvi'), 2);
  assert.equal(await unread('neha'), 0); // your own messages are never unread
  tick();
  await call('tanvi', 'POST', '/seen', { body: { scope: `group:${p.id}` } });
  assert.equal(await unread('tanvi'), 0);
  tick();
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('tanvi'), idOf('kunal')] } });
  assert.equal(await unread('tanvi'), 0);
  // Marking a group seen needs access to it.
  await rejects(call('kavita', 'POST', '/seen', { body: { scope: `group:${p.id}` } }), 404);
});

test('mentions notify people in the group, with a link to it', async () => {
  const p = await newProject('Mention stall');
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('tanvi')] } });
  tick();
  await call('neha', 'POST', `/groups/${p.id}/messages`, { body: { body: '@Tanvi can you share the render? cc @Kavita' } });
  const tanvi = (await call('tanvi', 'GET', '/notifications')).items[0];
  assert.match(tanvi.text, /Neha Iyer mentioned you in the .* group/);
  assert.equal(tanvi.link, `/teams/${p.id}`);
  // A full name picks one person even when others share the first name.
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('tanvi'), idOf('sneha_k')] } });
  tick();
  await call('neha', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Thanks @Sneha Kapoor, looks great' } });
  assert.match((await call('sneha_k', 'GET', '/notifications')).items[0].text, /mentioned you/);
  assert.equal((await call('rajiv', 'GET', `/projects/${p.id}`)).group.unread, 2);
  assert.equal((await call('rohan', 'GET', `/projects/${p.id}`)).group, null);
  // Kavita works in Marketing and cannot see this group.
  assert.ok(!(await call('kavita', 'GET', '/notifications')).items.some((n) => n.link === `/teams/${p.id}`));
});

test('the group is deleted when the project is delivered or cancelled; reopening starts a new one', async () => {
  const p = await newProject('Closing stall');
  tick();
  await call('neha', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Handover done @Suresh Iyer' } });
  tick();
  const fid = (await upload('neha', p.id)).id;
  tick();
  await call('neha', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Final render', file_ids: [fid] } });
  assert.ok(db.get('SELECT COUNT(*) AS n FROM notifications WHERE link = ?', `/teams/${p.id}`).n > 0);
  tick();
  await call('neha', 'PATCH', `/projects/${p.id}`, { body: { status: 'ready' } });
  tick();
  await call('neha', 'PATCH', `/projects/${p.id}`, { body: { status: 'completed' } });

  // Gone for everyone, heads included, with everything that pointed at it.
  assert.ok(!(await call('neha', 'GET', '/groups')).items.some((x) => x.id === p.id));
  assert.ok(!(await call('suresh', 'GET', '/groups')).items.some((x) => x.id === p.id));
  await assert.rejects(call('neha', 'GET', `/groups/${p.id}`), (e) => e.status === 404 && e.code === 'group_deleted');
  await rejects(call('suresh', 'GET', `/groups/${p.id}/messages`), 404);
  await rejects(call('neha', 'POST', `/groups/${p.id}/messages`, { body: { body: 'one more thing' } }), 404);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM group_messages WHERE project_id = ?', p.id).n, 0);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM seen WHERE scope = ?', `group:${p.id}`).n, 0);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM notifications WHERE link = ?', `/teams/${p.id}`).n, 0);
  assert.equal((await call('neha', 'GET', `/projects/${p.id}`)).group, null);
  // The shared file stays with the project; only its link to the chat is gone.
  const kept = (await call('neha', 'GET', `/projects/${p.id}/files`)).items.find((f) => f.id === fid);
  assert.ok(kept);
  assert.equal(kept.message_id, null);
  assert.equal(db.get("SELECT detail FROM activity WHERE project_id = ? AND action = 'group_deleted'", p.id).detail, '2 messages');
  // Changing the team of a finished project does not bring messages back.
  await call('suresh', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('kunal')] } });
  assert.equal(db.get('SELECT COUNT(*) AS n FROM group_messages WHERE project_id = ?', p.id).n, 0);

  // Reopening starts a fresh group.
  tick();
  await call('neha', 'PATCH', `/projects/${p.id}`, { body: { status: 'active' } });
  assert.ok((await call('neha', 'GET', '/groups')).items.some((x) => x.id === p.id));
  const fresh = (await call('neha', 'GET', `/groups/${p.id}/messages`)).items;
  assert.deepEqual(fresh.map((m) => m.body), ['Neha Iyer reopened the project and started a new group for it.']);
  await call('neha', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Client wants a small change' } });

  tick();
  await call('neha', 'PATCH', `/projects/${p.id}`, { body: { status: 'cancelled' } });
  assert.ok(!(await call('neha', 'GET', '/groups')).items.some((x) => x.id === p.id));
  assert.equal(db.get('SELECT COUNT(*) AS n FROM group_messages WHERE project_id = ?', p.id).n, 0);
});

test('messages follow the comment rule: 15 seconds to delete, then a head approves', async () => {
  const p = await newProject('Delete stall');
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('rohan')] } });
  tick();
  const quick = await call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { body: 'wrong chat' } });
  assert.equal(quick.can_delete, true);
  tick(10_000);
  await call('rohan', 'DELETE', `/group-messages/${quick.id}`);

  const late = await call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Quote is ₹4,80,000' } });
  tick(30_000);
  await rejects(call('rohan', 'DELETE', `/group-messages/${late.id}`), 403);
  await rejects(call('neha', 'DELETE', `/group-messages/${late.id}`), 403); // the owner is not a head
  await call('rohan', 'POST', `/group-messages/${late.id}/delete-request`);
  await rejects(call('neha', 'POST', `/group-messages/${late.id}/delete-decision`, { body: { approve: true } }), 403);
  const asHead = (await call('suresh', 'GET', `/groups/${p.id}/messages`)).items.find((m) => m.id === late.id);
  assert.equal(asHead.can_decide, true);
  await call('suresh', 'POST', `/group-messages/${late.id}/delete-decision`, { body: { approve: true } });
  await call('rohan', 'DELETE', `/group-messages/${late.id}`);
  const after = (await call('neha', 'GET', `/groups/${p.id}/messages`)).items;
  assert.ok(!after.some((m) => m.id === late.id || m.id === quick.id));
  assert.ok(after.some((m) => m.body === 'Rohan Das deleted a message, approved by Suresh Iyer.'));

  // Heads can remove anyone's message; the group sees that they did.
  const rude = await call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { body: 'not for this group' } });
  tick(60_000);
  await call('suresh', 'DELETE', `/group-messages/${rude.id}`);
  assert.ok((await call('rohan', 'GET', `/groups/${p.id}/messages`)).items.some((m) => m.body === 'Suresh Iyer removed a message by Rohan Das.'));
  assert.ok((await call('rohan', 'GET', '/notifications')).items.some((n) => n.text.includes('removed your message')));
  // Notices cannot be deleted.
  const notice = (await call('suresh', 'GET', `/groups/${p.id}/messages`)).items.find((m) => m.kind === 'system');
  await rejects(call('suresh', 'DELETE', `/group-messages/${notice.id}`), 403);
});

// What the server and demo do after storing an uploaded file.
let stored = 0;
const removed = [];
services.removeStored = async (key) => { removed.push(key); };
async function upload(who, pid, name = 'Stall render v4.jpg', mime = 'image/jpeg') {
  stored++;
  return handle({ db, user: loadUser(db, idOf(who)), body: { category: 'Design', note: 'Shared in the team group' }, upload: { storage_key: `t/${stored}`, name, mime, size: 2048 }, services },
    'POST', `/projects/${pid}/files`);
}

test('files and designs can be shared in the group, and they land in the project files', async () => {
  const p = await newProject('Attachment stall');
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('tanvi'), idOf('rohan')] } });
  tick();
  const render = await upload('tanvi', p.id);
  const drawing = await upload('tanvi', p.id, 'Fabrication drawings.pdf', 'application/pdf');
  const m = await call('tanvi', 'POST', `/groups/${p.id}/messages`, { body: { body: '', file_ids: [render.id, drawing.id] } });
  assert.deepEqual(m.files.map((f) => f.name), ['Stall render v4.jpg', 'Fabrication drawings.pdf']);
  assert.equal(m.body, '');

  // Everyone in the group sees them, and so does the project's Files tab.
  const seen = (await call('rohan', 'GET', `/groups/${p.id}/messages`)).items.find((x) => x.id === m.id);
  assert.equal(seen.files.length, 2);
  const projectFiles = (await call('rohan', 'GET', `/projects/${p.id}/files`)).items;
  assert.ok(projectFiles.some((f) => f.id === render.id && f.message_id === m.id));
  const g = await call('rohan', 'GET', `/groups/${p.id}`);
  assert.equal(g.file_count, 2);
  const listed = (await call('rohan', 'GET', '/groups')).items.find((x) => x.id === p.id);
  assert.equal(listed.last.file_count, 2);
  assert.equal(listed.last.file_name, 'Stall render v4.jpg');
  tick();
  await call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Looks great' } });
  const onlyFiles = (await call('rohan', 'GET', `/groups/${p.id}/messages`, { query: { kind: 'files' } })).items;
  assert.deepEqual(onlyFiles.map((x) => x.id), [m.id]);

  // Only your own fresh uploads from this project, once.
  await rejects(call('rohan', 'POST', `/groups/${p.id}/messages`, { body: { body: 'mine now', file_ids: [render.id] } }), 400);
  await rejects(call('tanvi', 'POST', `/groups/${p.id}/messages`, { body: { body: 'again', file_ids: [render.id] } }), 400);
  const elsewhere = await upload('tanvi', (await newProject('Other stall')).id);
  await rejects(call('tanvi', 'POST', `/groups/${p.id}/messages`, { body: { body: 'x', file_ids: [elsewhere.id] } }), 400);
  const old = await upload('tanvi', p.id, 'Old brief.pdf', 'application/pdf');
  tick(7 * 3600 * 1000);
  await rejects(call('tanvi', 'POST', `/groups/${p.id}/messages`, { body: { body: 'x', file_ids: [old.id] } }), 400);
  await rejects(call('tanvi', 'POST', `/groups/${p.id}/messages`, { body: { body: '' } }), 400);
});

test('deleting a message removes its files, but keeps any marked as final', async () => {
  const p = await newProject('Attachment delete stall');
  await call('neha', 'PUT', `/projects/${p.id}/members`, { body: { user_ids: [idOf('neha'), idOf('tanvi')] } });
  tick();
  const wrong = await upload('tanvi', p.id, 'Wrong client render.jpg');
  const m1 = await call('tanvi', 'POST', `/groups/${p.id}/messages`, { body: { file_ids: [wrong.id] } });
  tick(5000);
  await call('tanvi', 'DELETE', `/group-messages/${m1.id}`);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM files WHERE id = ?', wrong.id).n, 0);
  assert.ok(removed.includes(wrong.storage_key));

  tick();
  const keep = await upload('tanvi', p.id, 'Final render.jpg');
  const scrap = await upload('tanvi', p.id, 'Draft render.jpg');
  const m2 = await call('tanvi', 'POST', `/groups/${p.id}/messages`, { body: { body: 'Final and draft', file_ids: [keep.id, scrap.id] } });
  await call('neha', 'PATCH', `/files/${keep.id}`, { body: { is_final: true } });
  tick(60_000);
  await call('suresh', 'DELETE', `/group-messages/${m2.id}`);
  assert.equal(db.get('SELECT message_id FROM files WHERE id = ?', keep.id).message_id, null);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM files WHERE id = ?', scrap.id).n, 0);
});

test('the sample data has lively groups, and none for finished projects', async () => {
  const { items } = await call('rohan', 'GET', '/groups');
  assert.ok(items.length >= 3);
  assert.ok(items.every((g) => g.vertical === 'Exhibits' && g.member));
  assert.ok(items.some((g) => g.unread > 0));
  // Sample chats include shared designs, which also sit in the project's files.
  const shared = (await call('rohan', 'GET', `/groups/${items[0].id}/messages`, { query: { kind: 'files' } })).items;
  assert.ok(shared.length > 0 && shared[0].files.some((f) => f.mime === 'image/jpeg'));
  const finished = db.all("SELECT id FROM projects WHERE status IN ('completed','cancelled')").map((r) => r.id);
  assert.ok(finished.length > 0);
  assert.equal(db.get(`SELECT COUNT(*) AS n FROM group_messages WHERE project_id IN (${finished.join(',')})`).n, 0);
  await rejects(call('rohan', 'GET', `/groups/${db.get("SELECT id FROM projects WHERE status = 'completed' AND vertical_id = ? LIMIT 1", vid('Exhibits')).id}`), 404);
});

test('upgrading deletes the groups of projects that were already over', () => {
  const old = openDb(':memory:');
  migrate(old);
  seedBasics(old);
  seedDemo(old, { today: TODAY, passwordHash: 'x' });
  // As saved by an older version: a delivered project still holding its closed group.
  const done = old.get("SELECT id FROM projects WHERE status = 'completed' LIMIT 1").id;
  const mid = old.run("INSERT INTO group_messages (project_id, user_id, kind, body, created_at) VALUES (?, 1, 'message', 'Great show', ?)", done, `${TODAY}T09:00:00.000Z`).id;
  const fid = old.run("INSERT INTO files (project_id, kind, name, mime, size, category, uploaded_by, created_at, message_id) VALUES (?, 'link', 'Photos', 'text/uri-list', 0, 'Production', 1, ?, ?)", done, `${TODAY}T09:00:00.000Z`, mid).id;
  old.run("INSERT INTO seen (user_id, scope, seen_at) VALUES (1, ?, ?)", `group:${done}`, `${TODAY}T09:00:00.000Z`);
  old.run("UPDATE settings SET value = '6' WHERE key = 'schema_version'");
  const open = old.get("SELECT COUNT(*) AS n FROM group_messages g JOIN projects p ON p.id = g.project_id WHERE p.status IN ('planning','active','on_hold','ready')").n;
  migrate(old);
  assert.equal(old.get('SELECT COUNT(*) AS n FROM group_messages WHERE project_id = ?', done).n, 0);
  assert.equal(old.get('SELECT message_id FROM files WHERE id = ?', fid).message_id, null);
  assert.equal(old.get('SELECT COUNT(*) AS n FROM seen WHERE scope = ?', `group:${done}`).n, 0);
  assert.equal(old.get('SELECT COUNT(*) AS n FROM group_messages').n, open, 'groups of running projects are untouched');
  assert.equal(old.get("SELECT value FROM settings WHERE key = 'schema_version'").value, '7');
});

test('older sample data gets sample chats once; nothing is invented otherwise', () => {
  const old = openDb(':memory:');
  migrate(old);
  seedBasics(old);
  seedDemo(old, { today: TODAY, passwordHash: 'x' });
  old.run('DELETE FROM group_messages');
  old.run("DELETE FROM seen WHERE scope LIKE 'group:%'");
  assert.equal(seedGroupChats(old, { today: TODAY, now: `${TODAY}T12:00:00.000Z` }), true);
  assert.ok(old.get('SELECT COUNT(*) AS n FROM group_messages').n > 20);
  assert.ok(old.get("SELECT COUNT(*) AS n FROM seen WHERE scope LIKE 'group:%'").n > 0);
  assert.equal(seedGroupChats(old, { today: TODAY }), false);
  // Seeded messages are never in the future.
  const early = openDb(':memory:');
  migrate(early);
  seedBasics(early);
  seedDemo(early, { today: TODAY, passwordHash: 'x', now: `${TODAY}T01:00:00.000Z` });
  assert.equal(early.get('SELECT COUNT(*) AS n FROM group_messages WHERE created_at > ?', `${TODAY}T01:00:00.000Z`).n, 0);
});
