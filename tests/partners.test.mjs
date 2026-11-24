import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {partnersOverview, partnersAction, freshness} from '../src/partners.mjs';
import {purgeOldPermits} from '../src/retention.mjs';

const sources = [{id: 'a', city: 'Alpha', state: 'MA'}, {id: 'b', city: 'Beta', state: 'CT'}];
const act = (db, b) => partnersAction(db, sources, 'mestre', b);

test('trades are seeded and companies keep trades, contact and join date', () => {
  const db = openDatabase(':memory:');
  assert.ok(partnersOverview(db, sources).trades.some(t => t.name === 'Painting'));
  const trade = partnersOverview(db, sources).trades.find(t => t.name === 'Roofing').id;
  const {id} = act(db, {op: 'saveCompany', name: 'Acme Painting', contactEmail: 'a@acme.test', tradeIds: [trade, 9999]});
  const c = partnersOverview(db, sources).companies[0];
  assert.equal(c.id, id); assert.deepEqual(c.tradeIds, [trade]); assert.match(c.joinedOn, /^\d{4}-\d\d-\d\d$/);
  assert.throws(() => act(db, {op: 'saveCompany', name: 'Acme Painting'}), /Já existe/);
  assert.throws(() => act(db, {op: 'saveCompany', name: 'X', contactEmail: 'bad'}), /inválido/);
  db.close();
});

test('client accounts link to a company and valid cities; deactivating a company deactivates its clients', () => {
  const db = openDatabase(':memory:');
  const {id: company} = act(db, {op: 'saveCompany', name: 'Co'});
  const {id: client} = act(db, {op: 'saveClient', email: 'Bob@Co.test', companyId: company, cities: ['a', 'nope']});
  let o = partnersOverview(db, sources);
  assert.deepEqual(o.clients[0].cities, ['a']); assert.equal(o.clients[0].email, 'bob@co.test');
  assert.deepEqual(o.coverage[0].cities, ['a']);
  act(db, {op: 'setClientActive', id: client, active: false});
  assert.deepEqual(partnersOverview(db, sources).coverage[0].cities, []);
  act(db, {op: 'setClientActive', id: client, active: true});
  act(db, {op: 'setCompanyActive', id: company, active: false});
  o = partnersOverview(db, sources); assert.equal(o.clients[0].active, false);
  assert.throws(() => act(db, {op: 'setClientActive', id: client, active: true}), /inativa/);
  assert.throws(() => act(db, {op: 'saveClient', email: 'x@y.test', companyId: 999}), /empresa/);
  db.close();
});

test('data freshness flags cities with no permits or more than the stale limit', () => {
  const db = openDatabase(':memory:');
  const now = new Date('2026-11-23T12:00:00Z');
  db.prepare("INSERT INTO permits(id,source_id,issued,project_key,data,first_seen,updated_at) VALUES('1','a','2026-11-10','k','{}','x','x'),('2','b','2026-08-01','k2','{}','x','x')").run();
  const f = freshness(db, sources, now);
  assert.equal(f[0].stale, false); assert.equal(f[0].daysSincePermit, 13);
  assert.equal(f[1].stale, true);
  act(db, {op: 'saveSettings', retention_months: 12, stale_days: 200});
  assert.equal(freshness(db, sources, now)[1].stale, false);
  db.close();
});

test('settings are validated, audited with the actor, and drive retention', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => act(db, {op: 'saveSettings', retention_months: 0, stale_days: 45}), /Prazo/);
  assert.throws(() => act(db, {op: 'saveSettings', retention_months: 12, stale_days: 0}), /Limite/);
  act(db, {op: 'saveSettings', retention_months: 6, stale_days: 30});
  const o = partnersOverview(db, sources);
  assert.equal(o.settings.retention_months, 6);
  assert.equal(o.audit[0].actor, 'mestre'); assert.match(o.audit[0].event, /12→6/);
  assert.equal(purgeOldPermits(db, new Date('2026-11-23T12:00:00Z')).months, 6);
  db.close();
});

test('usage totals are summed per company', () => {
  const db = openDatabase(':memory:');
  const {id} = act(db, {op: 'saveCompany', name: 'Co'});
  act(db, {op: 'recordUsage', companyId: id, kind: 'seen', permits: 40}); act(db, {op: 'recordUsage', companyId: id, kind: 'exported', permits: 5}); act(db, {op: 'recordUsage', companyId: id, kind: 'seen', permits: 2});
  const u = partnersOverview(db, sources).usage[0];
  assert.equal(u.seen, 42); assert.equal(u.exported, 5);
  assert.throws(() => act(db, {op: 'recordUsage', companyId: id, kind: 'x'}), /inválido/);
  db.close();
});

import {createApplication} from '../src/server.mjs';
test('partners API is admin-only, writes the audit log with the actor and records logins', async t => {
  const app = await createApplication({databasePath: ':memory:', adminEmail: 'owner@example.test', adminPassword: 'long-test-password-123', appUrl: 'http://127.0.0.1', startBackground: false});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.server.address().port;
  app.config.appUrl = base; t.after(() => app.close());
  const login = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({email: 'owner@example.test', password: 'long-test-password-123'})});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = await (await fetch(base + '/api/me', {headers: {Cookie: cookie}})).json();
  const post = b => fetch(base + '/api/admin/partners', {method: 'POST', headers: {Origin: base, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf}, body: JSON.stringify(b)});
  assert.equal((await post({op: 'saveCompany', name: 'Acme'})).status, 200);
  assert.equal((await post({op: 'bogus'})).status, 400);
  const d = await (await fetch(base + '/api/admin/partners', {headers: {Cookie: cookie}})).json();
  assert.equal(d.companies[0].name, 'Acme');
  assert.ok(d.audit.some(x => x.kind === 'login' && x.actor === 'owner@example.test'));
  assert.ok(d.audit.some(x => x.kind === 'config' && /Acme/.test(x.event)));
  assert.ok(d.freshness.length >= 30);
  app.db.prepare('UPDATE users SET system_admin=0').run();
  assert.equal((await fetch(base + '/api/admin/partners', {headers: {Cookie: cookie}})).status, 403);
});
