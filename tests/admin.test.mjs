import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../src/server.mjs';
import {checkSource, checkAllSources} from '../src/source-audit.mjs';
import {openDatabase} from '../src/db.mjs';

const source = {id: 'x', city: 'X', state: 'MA', url: 'https://www.x.gov/permits'};
const res = (status, headers = {}) => new Response('', {status, headers});

test('source check classifies ok, blocked, moved and off-site redirects', async () => {
  assert.equal((await checkSource(source, async () => res(200))).ok, true);
  const blocked = await checkSource(source, async () => res(403));
  assert.equal(blocked.ok, false); assert.match(blocked.note, /bloqueia/);
  assert.equal((await checkSource(source, async () => res(404))).ok, false);
  assert.equal((await checkSource(source, async () => res(301, {location: '/new/permits'}))).ok, true);
  const off = await checkSource(source, async () => res(302, {location: 'https://other.example/x'}));
  assert.equal(off.ok, false); assert.match(off.note, /other\.example/);
  assert.equal((await checkSource(source, async () => { throw new Error('boom'); })).status, 0);
});

test('source checks are stored per source and overwritten on the next run', async () => {
  const db = openDatabase(':memory:');
  await checkAllSources(db, [source], {fetchImpl: async () => res(404), pause: async () => {}});
  await checkAllSources(db, [source], {fetchImpl: async () => res(200), pause: async () => {}});
  const rows = db.prepare('SELECT * FROM source_checks').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].ok, 1);
  db.close();
});

test('admin overview lists accounts without secrets and is closed to non-admins', async t => {
  const app = await createApplication({databasePath: ':memory:', adminEmail: 'owner@example.test', adminPassword: 'long-test-password-123', appUrl: 'http://127.0.0.1', startBackground: false});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.server.address().port;
  app.config.appUrl = base; t.after(() => app.close());
  const login = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({email: 'owner@example.test', password: 'long-test-password-123'})});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(base + '/api/admin/overview', {headers: {Cookie: cookie}});
  assert.equal(r.status, 200);
  const text = await r.text(), d = JSON.parse(text);
  assert.equal(d.users[0].email, 'owner@example.test'); assert.equal(d.users[0].systemAdmin, true); assert.equal(d.users[0].activeSessions, 1);
  assert.doesNotMatch(text, /password_hash|scrypt|token/i);
  assert.ok(d.sources.length >= 30 && d.sources.some(x => x.id === 'boston' && x.automatic));
  // a non-admin user of the workspace cannot open it
  app.db.prepare('UPDATE users SET system_admin=0').run();
  assert.equal((await fetch(base + '/api/admin/overview', {headers: {Cookie: cookie}})).status, 403);
});
