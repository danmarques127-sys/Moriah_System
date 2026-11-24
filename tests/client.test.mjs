import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../src/server.mjs';

async function setup(t) {
  const app = await createApplication({databasePath: ':memory:', adminEmail: 'owner@example.test', adminPassword: 'long-test-password-123', appUrl: 'http://127.0.0.1', startBackground: false});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.server.address().port;
  app.config.appUrl = base; t.after(() => app.close());
  const login = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({email: 'owner@example.test', password: 'long-test-password-123'})});
  const cookie = login.headers.get('set-cookie').split(';')[0], me = await (await fetch(base + '/api/me', {headers: {Cookie: cookie}})).json();
  const admin = b => fetch(base + '/api/admin/partners', {method: 'POST', headers: {Origin: base, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf}, body: JSON.stringify(b)});
  const client = (path, opts = {}) => fetch(base + path, {...opts, headers: {Origin: base, 'Content-Type': 'application/json', ...(opts.headers || {})}});
  const now = new Date().toISOString().slice(0, 10);
  const put = (id, source, issued, extra = {}) => app.db.prepare('INSERT INTO permits(id,source_id,issued,project_key,data,first_seen,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, source, issued, 'k' + id, JSON.stringify({id, sourceId: source, city: source === 'boston' ? 'Boston' : 'Cambridge', state: 'MA', address: '1 Main St', number: 'N' + id.replace(/\W/g, ''), issued, description: 'Reroof see https://secret.example.gov/portal?id=1 ok', type: 'Roof', value: 5000, contractor: 'ACME', applicant: 'Owner', sourceUrl: 'https://www.boston.gov/permits/internal-directory'}), 'x', 'x');
  put('boston:1', 'boston', now); put('cambridge:1', 'cambridge', now); put('boston:old', 'boston', '2020-01-01');
  return {app, base, cookie, admin, client, me};
}

test('client channel is closed (404) until the admin switches it on', async t => {
  const {client} = await setup(t);
  assert.equal((await client('/api/client/permits')).status, 404);
  assert.equal((await client('/api/client/login', {method: 'POST', body: JSON.stringify({email: 'a@b.co', password: 'x'})})).status, 404);
});

test('a client sees only its cities, never a municipal link, and cannot open internal routes', async t => {
  const {admin, client, base, app} = await setup(t);
  const co = await (await admin({op: 'saveCompany', name: 'Acme'})).json();
  const cl = await (await admin({op: 'saveClient', email: 'bob@acme.test', companyId: co.id, cities: ['boston']})).json();
  assert.equal((await admin({op: 'saveSettings', retention_months: 12, stale_days: 45, client_portal: true})).status, 200);
  assert.equal((await admin({op: 'setClientPassword', id: cl.id, password: 'short'})).status, 400);
  assert.equal((await admin({op: 'setClientPassword', id: cl.id, password: 'a-long-client-password-1'})).status, 200);
  // wrong password
  assert.equal((await client('/api/client/login', {method: 'POST', body: JSON.stringify({email: 'bob@acme.test', password: 'nope-nope-nope-nope'})})).status, 401);
  const ok = await client('/api/client/login', {method: 'POST', body: JSON.stringify({email: 'BOB@acme.test', password: 'a-long-client-password-1'})});
  assert.equal(ok.status, 200); const ck = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  const res = await client('/api/client/permits', {headers: {Cookie: ck}}), text = await res.text(), d = JSON.parse(text);
  assert.equal(d.total, 1); assert.equal(d.permits[0].city, 'Boston');
  assert.doesNotMatch(text, /https?:|www\.|sourceUrl|sourceId|boston:|cambridge|secret\.example|internal-directory|portal/i);
  assert.deepEqual(Object.keys(d.permits[0]).sort(), ['address', 'contractor', 'dateApprox', 'description', 'email', 'fav', 'issued', 'key', 'kind', 'number', 'owner', 'phone', 'state', 'status', 'city', 'type', 'value'].sort());
  assert.ok(!JSON.stringify(d.cities).includes('boston'), 'city keys are opaque');
  // a city filter outside its assignment is ignored (still only Boston)
  const other = await (await client('/api/client/permits?city=cambridge', {headers: {Cookie: ck}})).json(); assert.equal(other.total, 1);
  // client cookie does nothing on internal routes, and the internal cookie does nothing on client routes
  for (const p of ['/api/me', '/api/radar', '/api/admin/overview', '/api/admin/partners']) assert.equal((await fetch(base + p, {headers: {Cookie: ck}})).status, 401, p);
  // usage is counted for the company
  const usage = app.db.prepare("SELECT SUM(permits) AS n FROM usage_events WHERE company_id=? AND kind='seen'").get(co.id).n; assert.ok(usage >= 1);
  // deactivating the client closes the session at once
  await admin({op: 'setClientActive', id: cl.id, active: false});
  assert.equal((await client('/api/client/permits', {headers: {Cookie: ck}})).status, 401);
});

test('a client without a password, or of an inactive company, cannot sign in', async t => {
  const {admin, client} = await setup(t);
  const co = await (await admin({op: 'saveCompany', name: 'Co'})).json();
  const cl = await (await admin({op: 'saveClient', email: 'x@co.test', companyId: co.id, cities: ['boston']})).json();
  await admin({op: 'saveSettings', retention_months: 12, stale_days: 45, client_portal: true});
  const tryLogin = pw => client('/api/client/login', {method: 'POST', body: JSON.stringify({email: 'x@co.test', password: pw})});
  assert.equal((await tryLogin('')).status, 401);
  await admin({op: 'setClientPassword', id: cl.id, password: 'a-long-client-password-1'});
  await admin({op: 'setCompanyActive', id: co.id, active: false});
  assert.equal((await tryLogin('a-long-client-password-1')).status, 401);
});
