import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectAccela, parseResults, formFields, postbackTargets} from '../src/accela.mjs';
import {validatePermit} from '../src/radar.mjs';
import {SOURCES} from '../src/sources.mjs';

const source = SOURCES.find(s => s.id === 'brookline');
const noSleep = async () => {};
const home = '<html><body><form method="post" action="./CapHome.aspx?module=Building">'
  + '<input type="hidden" name="__VIEWSTATE" value="vs1"><input type="hidden" name="__EVENTVALIDATION" value="ev1"><input type="hidden" name="__EVENTTARGET" value=""><input type="hidden" name="__EVENTARGUMENT" value="">'
  + '<input name="ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate" type="text" value="">'
  + '<input name="ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate" type="text" value="">'
  + '<select name="ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType"><option value="">--Select--</option><option value="Building">Building</option></select>'
  + '<input type="submit" name="ignored" value="Clear">'
  + '<a id="ctl00_PlaceHolderMain_btnNewSearch" href="javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(&quot;ctl00$PlaceHolderMain$btnNewSearch&quot;, &quot;&quot;, true, &quot;&quot;, &quot;&quot;, false, true))">Search</a></form></body></html>';
const row = (d, n, t, a, s, desc) => '<tr><td>' + d + '</td><td><a href="#">' + n + '</a></td><td>' + t + '</td><td>' + a + '</td><td>' + s + '</td><td>' + desc + '</td><td></td></tr>';
const grid = (rows, showing, pager = '') => '<table id="ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList"><tr><th>Date</th><th>Record Number</th><th>Record Type</th><th>Address</th><th>Status</th><th>Description</th><th>Project Name</th></tr>' + rows + pager + '</table><span>Showing ' + showing + '</span>';
const pager2 = "<tr><td colspan=\"7\"><a href=\"javascript:__doPostBack('ctl00$PlaceHolderMain$dgvPermitList$gdvPermitList','Page$2')\">2</a></td></tr>";
const page1 = grid(row('10/15/2026', 'BLD-26-100', 'Building', '12 Main St', 'Issued', 'Construct new single family dwelling') + row('10/20/2026', 'ELE-26-5', 'Electrical', '5 Elm St', 'Issued', 'Wiring'), '1-2 of 3', pager2);
const page2 = grid(row('10/28/2026', 'BLD-26-101', 'Certificate of Occupancy', '9 Oak St', 'Issued', 'CO'), '3-3 of 3');

function portal(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const method = opts.method || 'GET';
    calls.push({url, method, cookie: opts.headers.Cookie, form: method === 'POST' ? new URLSearchParams(String(opts.body)) : null});
    if (method === 'GET') return new Response(overrides.home ?? home, {headers: {'content-type': 'text/html', 'set-cookie': 'ASP.NET_SessionId=abc; path=/'}});
    if (opts.headers.Cookie !== 'ASP.NET_SessionId=abc') return new Response('no session', {status: 403});
    const form = calls.at(-1).form;
    if (form.get('__EVENTTARGET') === 'ctl00$PlaceHolderMain$btnNewSearch') return new Response(overrides.results ?? page1, {headers: {'content-type': 'text/html'}});
    if (form.get('__EVENTARGUMENT') === 'Page$2') return new Response(page2, {headers: {'content-type': 'text/html'}});
    return new Response('unexpected', {status: 400});
  };
  return {calls, fetchImpl};
}

test('Brookline is imported by hand (the Accela collector is not enabled for any city)', () => {
  assert.notEqual(source.mode, 'accela');
  assert.ok(source.reason);
});

test('form state, text boxes and selects are collected; buttons are not', () => {
  const f = formFields(home);
  assert.equal(f.get('__VIEWSTATE'), 'vs1');
  assert.equal(f.get('ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType'), '');
  assert.ok(!f.has('ignored'));
  assert.deepEqual(postbackTargets(home).map(t => t.target), ['ctl00$PlaceHolderMain$btnNewSearch']);
});

test('search fills the month range, keeps the session cookie, pages through results and validates records', async () => {
  const {calls, fetchImpl} = portal();
  const result = await collectAccela(source, '2026-10', {fetch: fetchImpl, sleep: noSleep});
  assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'POST']);
  assert.equal(calls[1].form.get('ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate'), '10/01/2026');
  assert.equal(calls[1].form.get('ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate'), '10/31/2026');
  assert.equal(calls[1].form.get('__VIEWSTATE'), 'vs1');
  assert.equal(calls[2].form.get('__EVENTARGUMENT'), 'Page$2');
  assert.equal(result.records.length, 2); // the certificate of occupancy is skipped
  assert.equal(result.records[0].issued, '2026-10-15');
  assert.equal(result.status, 'partial');
  assert.match(result.message, /3 linha\(s\) lida\(s\) de 3/);
  assert.match(result.records[0].description, /abertura|submissão/);
  for (const r of result.records) assert.doesNotThrow(() => validatePermit(r, source));
});

test('CAPTCHA, a changed page and a login wall are visible failures, never bypassed', async () => {
  await assert.rejects(collectAccela(source, '2026-10', {fetch: portal({home: home + '<div class="g-recaptcha"></div>'}).fetchImpl, sleep: noSleep}), /CAPTCHA/);
  await assert.rejects(collectAccela(source, '2026-10', {fetch: portal({home: '<html><input name="x" value=""></html>'}).fetchImpl, sleep: noSleep}), /campos de data/);
  await assert.rejects(collectAccela(source, '2026-10', {fetch: portal({results: '<html>sem tabela</html>'}).fetchImpl, sleep: noSleep}), /Tabela de resultados/);
  await assert.rejects(collectAccela(source, '2026-10', {fetch: async () => new Response('', {status: 403}), sleep: noSleep}), /HTTP 403/);
});

test('an empty result list is a valid empty page, and unknown columns are reported', () => {
  assert.deepEqual(parseResults('<div>No records found.</div>'), {rows: [], total: 0});
  assert.throws(() => parseResults('<table id="x_gdvPermitList"><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>'), /Colunas vistas: A \| B \| C/);
});
