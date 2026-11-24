import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../src/server.mjs';
import {parseUploadedFile} from '../src/documents.mjs';
import {SOURCES} from '../src/sources.mjs';

const password = 'only-for-tests-password-123456';
async function fixture(t) {
  const app = await createApplication({databasePath: ':memory:', adminEmail: 'owner@example.test', adminPassword: password, production: false, appUrl: 'http://127.0.0.1', startBackground: false});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port; app.config.appUrl = base; t.after(() => app.close());
  let cookie = '', csrf = '';
  const json = async (path, body) => (await fetch(base + path, {method: body ? 'POST' : 'GET', headers: {Origin: base, ...(cookie ? {Cookie: cookie} : {}), ...(body ? {'Content-Type': 'application/json', 'X-CSRF-Token': csrf} : {})}, body: body ? JSON.stringify(body) : undefined}));
  const login = async (email = 'owner@example.test') => {
    const r = await json('/api/login', {email, password}); assert.equal(r.status, 200);
    cookie = r.headers.get('set-cookie').split(';')[0]; csrf = (await (await json('/api/me')).json()).csrf;
  };
  const upload = (query, data) => fetch(base + '/api/import-file?' + new URLSearchParams(query), {method: 'POST', headers: {Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/octet-stream'}, body: data});
  return {...app, json, login, upload};
}
const csv = 'Record #,Date Issued,Address,Description,Type,Cost\n'
  + 'BLD-26-100,10/15/2026,12 Main St,Construct new single family dwelling,Building Permit,"$600,000"\n'
  + 'BLD-26-101,9/30/2026,5 Elm St,Replace windows,Building Permit,"$9,000"\n';

test('admin uploads a CSV: preview first, nothing is saved until confirmed, then permits appear in the radar as partial coverage', async t => {
  const f = await fixture(t); await f.login();
  const q = {sourceId: 'brookline', month: '2026-10', filename: 'brookline-oct.csv'};
  const preview = await (await f.upload({...q, confirm: '0'}, csv)).json();
  assert.equal(preview.preview, true);
  assert.equal(preview.format, 'text');
  assert.equal(preview.inMonth, 1);
  assert.equal(preview.outsideMonth, 1);
  assert.equal(preview.sample[0].value, 600000);
  assert.equal((await (await f.json('/api/radar?from=2026-10&to=2026-10')).json()).recordsLoaded, 0);
  const done = await (await f.upload({...q, confirm: '1'}, csv)).json();
  assert.equal(done.added, 1);
  const radar = await (await f.json('/api/radar?from=2026-10&to=2026-10')).json();
  assert.equal(radar.total, 1);
  assert.equal(radar.coverage.find(c => c.sourceId === 'brookline').status, 'partial');
  const again = await (await f.upload({...q, confirm: '1'}, csv)).json();
  assert.equal(again.added, 0);
});

test('only the system administrator can upload; unreadable files and bad months are rejected', async t => {
  const f = await fixture(t); await f.login();
  assert.equal((await f.upload({sourceId: 'brookline', month: '2026-10', confirm: '0'}, 'not a permit table at all')).status, 400);
  assert.equal((await f.upload({sourceId: 'brookline', month: '2026-13', confirm: '0'}, csv)).status, 400);
  assert.equal((await f.upload({sourceId: 'nowhere', month: '2026-10', confirm: '0'}, csv)).status, 400);
  assert.equal((await f.upload({sourceId: 'brookline', month: '2026-10', confirm: '0'}, '')).status, 400);
  assert.equal((await f.json('/api/members', {email: 'est@example.test', password, role: 'estimator'})).status, 201);
  await f.login('est@example.test');
  assert.equal((await f.upload({sourceId: 'brookline', month: '2026-10', confirm: '1'}, csv)).status, 403);
});

test('uploaded text-PDF rows go through the same parser as the collectors', async () => {
  const source = SOURCES.find(s => s.id === 'chatham');
  const text = 'B-26-206  3/25/2026  328  BARN HILL RD  Retrofit insulation and weatherization  Ryan McCluskey  11900  OWNER  SINGLE FAMILY\n';
  const parsed = await parseUploadedFile({buffer: Buffer.from('%PDF-1.4 fake'), source, month: '2026-03', deps: {pdfToText: async () => text}});
  assert.equal(parsed.format, 'pdf');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].address, '328 BARN HILL RD');
  assert.deepEqual(parsed.range, {from: '2026-03-25', to: '2026-03-25'});
});

test('upload preview suggests the right month and detects a file from another city', async () => {
  const {parseUploadedFile} = await import('../src/documents.mjs');
  const csv = 'Record #,Date Issued,Full Address,Type of Improvement\nB-1,2026-10-01,"1 MAIN ST, Westerly, RI 02891",Addition\nB-2,2026-10-05,"2 OAK ST, Westerly, RI 02891",Pool\n';
  const src = {id: 'chicopee', city: 'Chicopee', state: 'MA', url: 'https://www.chicopeema.gov/x', mode: 'report'};
  const r = await parseUploadedFile({buffer: Buffer.from(csv), source: src, month: '2026-11'});
  assert.equal(r.suggestedMonth, '2026-10'); assert.equal(r.records.length, 0);
  assert.ok(r.addresses.every(a => /Westerly/.test(a)));
});
