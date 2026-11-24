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

test('a multi-month file is split by month, undated rows are skipped and the range is capped at 24 months', async () => {
  const {parseUploadedFile} = await import('../src/documents.mjs');
  const csv = 'Record #,Date Issued,Full Address,Type of Improvement\nB-1,2026-08-01,"1 MAIN ST",Addition\nB-2,2026-09-05,"2 OAK ST",Pool\nB-3,2026-10-20,"3 ELM ST",Roof\nB-4,2025-01-02,"4 ELM ST",Roof\nB-5,,"5 ELM ST",Roof\n';
  const src = {id: 'x', city: 'X', state: 'MA', url: 'https://www.x.gov/p', mode: 'report'};
  const r = await parseUploadedFile({buffer: Buffer.from(csv), source: src, month: '2026-08', toMonth: '2026-10'});
  assert.deepEqual(r.records.map(x => x.issued).sort(), ['2026-08-01', '2026-09-05', '2026-10-20']);
  assert.equal(r.outside, 1); assert.equal(r.undated, 1);
  await assert.rejects(parseUploadedFile({buffer: Buffer.from(csv), source: src, month: '2024-01', toMonth: '2026-10'}), /24 meses/);
});

test('API: multi-month upload previews per month, drops permits older than the retention limit and stores coverage per month', async t => {
  const {createApplication} = await import('../src/server.mjs');
  const app = await createApplication({databasePath: ':memory:', adminEmail: 'owner@example.test', adminPassword: 'long-test-password-123', appUrl: 'http://127.0.0.1', startBackground: false});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.server.address().port;
  app.config.appUrl = base; t.after(() => app.close());
  const login = await fetch(base + '/api/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({email: 'owner@example.test', password: 'long-test-password-123'})});
  const cookie = login.headers.get('set-cookie').split(';')[0], me = await (await fetch(base + '/api/me', {headers: {Cookie: cookie}})).json();
  const d = new Date(); const iso = k => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 10)); return x.toISOString().slice(0, 10); };
  const csv = 'Record #,Date Issued,Full Address,Type of Improvement\nB-1,' + iso(3) + ',"1 MAIN ST",Addition\nB-2,' + iso(2) + ',"2 OAK ST",Pool\nB-3,' + iso(1) + ',"3 ELM ST",Roof\nB-4,' + iso(20) + ',"4 ELM ST",Roof\n';
  const send = confirm => fetch(base + '/api/import-file?' + new URLSearchParams({sourceId: 'chicopee', month: iso(20).slice(0, 7), to: iso(1).slice(0, 7), filename: 'x.csv', confirm}), {method: 'POST', headers: {Origin: base, Cookie: cookie, 'X-CSRF-Token': me.csrf, 'Content-Type': 'application/octet-stream'}, body: csv});
  const prev = await (await send('0')).json();
  assert.equal(prev.inMonth, 3); assert.equal(prev.tooOld, 1); assert.equal(Object.keys(prev.months).length, 3);
  const done = await (await send('1')).json();
  assert.equal(done.added, 3);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM coverage WHERE source_id='chicopee'").get().n, 3);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM manual_imports WHERE source_id='chicopee'").get().n, 3);
});
