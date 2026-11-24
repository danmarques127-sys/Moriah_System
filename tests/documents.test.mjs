import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {periodMatches, periodRank, csvRows, extractAnchors, parseTextRows, mapStructured, readXlsx, collectDocuments, detectFormat} from '../src/documents.mjs';
import {collect, NATIVE_MODES} from '../src/collectors.mjs';
import {SOURCES} from '../src/sources.mjs';
import {validatePermit} from '../src/radar.mjs';

const src = id => SOURCES.find(s => s.id === id);
const noSleep = {sleep: async () => {}};
function fakeFetch(map, calls = []) {
  return async url => {
    calls.push(url);
    const hit = map[url];
    if (hit === undefined) return new Response('not found', {status: 404});
    if (hit instanceof Response) return hit;
    return new Response(hit.body ?? hit, {status: 200, headers: {'content-type': hit.type || 'text/html'}});
  };
}
const pdfBytes = '%PDF-1.4 fake';

test('every city is either automatic or has an explicit import-only reason', () => {
  assert.equal(SOURCES.length, 34);
  for (const s of SOURCES) {
    if (NATIVE_MODES.includes(s.mode)) continue;
    assert.ok(s.reason, s.id + ' needs a documented reason');
  }
  assert.equal(SOURCES.filter(s => s.mode === 'documents').length, 15);
  for (const s of SOURCES.filter(s => s.mode === 'documents')) {
    assert.ok(s.collector, s.id);
    assert.ok(s.allowedHosts.length >= 1, s.id + ' needs a www/non-www host variant');
  }
});

test('period matching handles month names, abbreviations, combined months, quarters, years and fiscal years', () => {
  assert.ok(periodMatches('Bldg-Permits-Jan-2026', '2026-01'));
  assert.ok(periodMatches('Building Permits October 2026', '2026-10'));
  assert.ok(periodMatches('Permit Report - Sept 2025', '2025-09'));
  assert.ok(periodMatches('Sept and Oct 2025', '2025-10'));
  assert.ok(periodMatches('Sept and Oct 2025', '2025-09'));
  assert.ok(periodMatches('October-2026---Building-Permits-Issued', '2026-10'));
  assert.ok(!periodMatches('May 2026', '2026-06'));
  assert.ok(!periodMatches('March 2025', '2026-03'));
  assert.ok(!periodMatches('Permits 12 2026 mar', '2026-03'));
  assert.ok(periodMatches('2026 - Residential Permits', '2026-04', 'year'));
  assert.ok(!periodMatches('2025 - Residential Permits', '2026-04', 'year'));
  assert.ok(periodMatches('FY2026 1 or 2 Family', '2025-10', 'fiscal'));
  assert.ok(!periodMatches('FY2025 1 or 2 Family', '2025-10', 'fiscal'));
  assert.ok(periodMatches('FY2026', '2026-02', 'fiscal'));
  assert.ok(periodMatches('2026 Q3 Building Permits', '2026-08', 'quarter'));
  assert.ok(!periodMatches('2026 Q2 Building Permits', '2026-08', 'quarter'));
});

test('anchors are extracted and resolved against the page', () => {
  const links = extractAnchors('<a href="/DocumentCenter/View/9/May-2026">May &amp; June 2026</a><a href="javascript:x()">no</a><a href="#top">no</a>', 'https://x.gov/page');
  assert.deepEqual(links, [{href: 'https://x.gov/DocumentCenter/View/9/May-2026', text: 'May & June 2026', ctx: ''}]);
});

test('wakefield-style rows parse by column role; paid date is flagged as a proxy', () => {
  const text = 'Record #   Record Type   Amount Paid\nBP-26-157  Building Permit (DOORS, INSULATION, ROOFING)  $300.00  5/7/2026  1 AZARIAN CT  HARTREY, ROBERT  $25,000.00  STRIP AND RE-ROOF, REPLACE 7 WINDOWS  TED D DOW\n';
  const rows = parseTextRows(text, src('wakefield').collector, '2026-05');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].number, 'BP-26-157');
  assert.equal(rows[0].issued, '2026-05-07');
  assert.equal(rows[0].address, '1 AZARIAN CT');
  assert.equal(rows[0].value, 25000);
  assert.equal(rows[0].contractor, 'TED D DOW');
  assert.match(rows[0].description, /RE-ROOF/);
});

test('chatham-style rows use the real issued date and project cost', () => {
  const text = 'B-26-206  3/25/2026  328  BARN HILL RD  Retrofit insulation and weatherization  Ryan McCluskey  11900  THE MICHAEL CUSHING REV TRUST  SINGLE FAMILY\n';
  const [row] = parseTextRows(text, src('chatham').collector, '2026-03');
  assert.equal(row.issued, '2026-03-25');
  assert.equal(row.address, '328 BARN HILL RD');
  assert.equal(row.value, 11900);
  assert.equal(row.applicant, 'Ryan McCluskey');
});

test('heuristic rows (Newton layout) take the last date as the issued date and skip certificates of occupancy', () => {
  const text = [
    'BP-22-4482  Building Permit Application  5/27/2022  25-27 Woodrow Ave, Newtonville  14006 0009  6/1/2022  Frank Meehan  $60,967.00  $1,220.00  First-floor bathroom and kitchen remodel',
    'BP-22-4500  Certificate of Occupancy  5/27/2022  1 Main St  6/2/2022  Someone  $0.00'
  ].join('\n');
  const rows = parseTextRows(text, {dateWhich: 'last'}, '2022-06');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issued, '2022-06-01');
  assert.equal(rows[0].address, '25-27 Woodrow Ave');
  assert.equal(rows[0].value, 60967);
  assert.match(rows[0].description, /bathroom and kitchen/);
});

test('wrapped description lines are attached to the previous row and page headers are ignored', () => {
  const text = 'Record #  Date  Address\nBP-26-1  5/2/2026  10 ELM ST  Replace siding  $9,000.00\n   and trim on the north side\nPage 2 of 9\nBP-26-2  5/3/2026  12 ELM ST  New deck  $4,000.00\n';
  const rows = parseTextRows(text, {}, '2026-05');
  assert.equal(rows.length, 2);
  assert.match(rows[0].description, /north side/);
});

test('structured tables map headers by synonym and tolerate title rows', () => {
  const rows = mapStructured([
    ['Residential permits 2026'],
    ['Record #', 'Date Issued', 'Street No', 'Street', 'Brief Description of Proposed Work', 'Estimated Cost', 'Contractor Name', 'Record Status'],
    ['BP-26-9', 46150, '5', 'ELM ST', 'New single family dwelling', '$450,000', 'ACME BUILD', 'Issued'],
    ['', '', '', '', '', '', '', '']
  ], {}, '2026-05');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issued, '2026-05-08'); // Excel serial 46150
  assert.equal(rows[0].address, '5 ELM ST');
  assert.equal(rows[0].value, 450000);
  assert.equal(rows[0].contractor, 'ACME BUILD');
});

function xlsx(sheets) {
  const files = {
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook><sheets>' + sheets.map((s, i) => '<sheet name="' + s.name + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships>' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>'
  };
  sheets.forEach((s, i) => {
    files['xl/worksheets/sheet' + (i + 1) + '.xml'] = '<worksheet><sheetData>' + s.rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
      const ref = String.fromCharCode(65 + ci) + (ri + 1);
      return typeof v === 'number' ? '<c r="' + ref + '"><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"><is><t>' + v + '</t></is></c>';
    }).join('') + '</row>').join('') + '</sheetData></worksheet>';
  });
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name), data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(text.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data); central.push(cen, nameBuf); offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

test('xlsx workbook is read without dependencies and the month tab is preferred', async () => {
  const header = ['Record #', 'Date Issued', 'Address', 'Description', 'Cost'];
  const book = xlsx([
    {name: 'September', rows: [header, ['BP-1', 45900, '1 A ST', 'Old work', 100]]},
    {name: 'October', rows: [header, ['BP-2', 45945, '2 B ST', 'New single family dwelling', 500000]]} // 45945 = 2025-10-15
  ]);
  assert.equal(detectFormat({buffer: book}), 'xlsx');
  assert.equal(readXlsx(book).length, 2);
  const url = 'https://www.arlingtonma.gov/departments/inspectional-services/building-permit-activity';
  const file = 'https://www.arlingtonma.gov/home/showpublisheddocument/1/FY2026-1-or-2-Family-Building-Permits.xlsx';
  const calls = [];
  const result = await collectDocuments({...src('arlington'), collector: {scope: 'fiscal', match: 'permit'}}, '2025-10', {fetch: fakeFetch({[url]: '<a href="' + file + '">FY2026 1 or 2 Family Building Permits (Residential)</a><a href="/home/showpublisheddocument/2/fy2025.xlsx">FY2025 Residential</a>', [file]: {body: book, type: 'application/octet-stream'}}, calls), ...noSleep});
  assert.equal(calls.length, 2);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].number, 'BP-2');
  assert.equal(result.records[0].issued, '2025-10-15');
  assert.equal(result.status, 'partial');
});

test('listing to PDF to validated permit records (monthly file, injected PDF text)', async () => {
  const source = src('wakefield');
  const file = 'https://www.wakefieldma.gov/DocumentCenter/View/2801/Building-Permits-Issued-May-2026-PDF';
  const listing = '<a href="/DocumentCenter/View/2801/Building-Permits-Issued-May-2026-PDF">Building Permits Issued May 2026 (PDF)</a><a href="/DocumentCenter/View/2700/Building-Permits-Issued-April-2026-PDF">Building Permits Issued April 2026 (PDF)</a>';
  const calls = [];
  const text = 'BP-26-157  Building Permit  $300.00  5/7/2026  1 AZARIAN CT  HARTREY, ROBERT  $25,000.00  STRIP AND RE-ROOF  TED D DOW\nBP-26-170  Building Permit  $500.00  5/21/2026  9 OAK ST  SMITH, JOHN  $90,000.00  ADDITION OVER GARAGE  BUILDER LLC\n';
  const result = await collectDocuments(source, '2026-05', {fetch: fakeFetch({[source.url]: listing, [file]: {body: pdfBytes, type: 'application/pdf'}}, calls), pdfToText: async () => text, ...noSleep});
  assert.deepEqual(calls, [source.url, file]);
  assert.equal(result.records.length, 2);
  assert.match(result.message, /pagamento/);
  for (const r of result.records) assert.doesNotThrow(() => validatePermit(r, source));
  assert.match(result.records[0].description, /Data na fonte: pagamento/);
});

test('month not published is pending, never an invented zero', async () => {
  const source = src('wakefield');
  const result = await collectDocuments(source, '2026-12', {fetch: fakeFetch({[source.url]: '<a href="/DocumentCenter/View/1/Building-Permits-Issued-May-2026-PDF">Building Permits Issued May 2026</a>'}), ...noSleep});
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.records, []);
  assert.match(result.message, /não significa zero/);
});

test('unrecognized document layout fails loudly instead of returning an empty month', async () => {
  const source = src('wakefield'), file = 'https://www.wakefieldma.gov/DocumentCenter/View/5/Building-Permits-Issued-May-2026-PDF';
  await assert.rejects(collectDocuments(source, '2026-05', {fetch: fakeFetch({[source.url]: '<a href="' + file + '">Building Permits Issued May 2026</a>', [file]: {body: pdfBytes, type: 'application/pdf'}}), pdfToText: async () => 'scanned image, no text rows', ...noSleep}), /Layout do documento não reconhecido/);
});

test('HTTP 403 and cross-domain redirects are failures, not empty results', async () => {
  const source = src('wakefield');
  await assert.rejects(collectDocuments(source, '2026-05', {fetch: async () => new Response('no', {status: 403}), ...noSleep}), /HTTP 403/);
  await assert.rejects(collectDocuments(source, '2026-05', {fetch: async () => new Response('', {status: 302, headers: {location: 'https://evil.example/x'}}), ...noSleep}), /Redirecionamento/);
});

test('links on non-reviewed hosts are ignored and reported', async () => {
  const source = src('wakefield');
  const result = await collectDocuments(source, '2026-05', {fetch: fakeFetch({[source.url]: '<a href="https://evil.example/Building-Permits-Issued-May-2026.pdf">Building Permits Issued May 2026</a>'}), ...noSleep});
  assert.equal(result.status, 'pending');
  assert.match(result.message, /evil\.example/);
});

test('annual archive page is parsed inline when the item has no file link, filtered to the requested month', async () => {
  const source = src('wellesley'), item = 'https://www.wellesleyma.gov/Archive.aspx?ADID=848';
  const page = '<a href="/Archive.aspx?ADID=848">2026 - Residential Permits</a>';
  const body = '<html><body><pre>RES-26-0001  Residential Alteration  6/2/2026  5 ELM ST  Smith  $10,000.00  Kitchen remodel\nRES-26-0002  Residential Addition  7/9/2026  7 OAK ST  Jones  $250,000.00  Second story addition</pre></body></html>';
  const result = await collectDocuments(source, '2026-07', {fetch: fakeFetch({[source.url]: page, [item]: body}), ...noSleep});
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].number, 'RES-26-0002');
  assert.match(result.records[0].description, /submissão/);
});

test('collect() routes document sources and keeps portal-only cities pending with their reason', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response('<p>sem links</p>', {headers: {'content-type': 'text/html'}});
  try {
    assert.equal((await collect(src('reading'), '2026-10')).status, 'pending');
    const portal = await collect(src('newton'), '2026-10');
    assert.equal(portal.status, 'pending');
    assert.match(portal.message, /OpenGov/);
  } finally { globalThis.fetch = old; }
});

test('crawl stays inside the listing section, ignores the site menu, and lists the files it saw when nothing matches', async () => {
  const source = {...src('newton'), url: 'https://www.newtonma.gov/government/inspectional-services/building-permit-summary-report', collector: {scope: 'month', crawl: true, crawlRe: 'permit'}};
  const calls = [];
  const listing = '<a href="/government/city-clerk/burial-permits">Burial permits</a><a href="/government/inspectional-services/permit-forms">Permit forms</a><a href="/home/showpublisheddocument/1/2">Summary June 2026</a>';
  const result = await collectDocuments(source, '2026-08', {fetch: fakeFetch({[source.url]: listing, 'https://www.newtonma.gov/government/inspectional-services/permit-forms': '<p>forms</p>'}, calls), ...noSleep});
  assert.ok(!calls.some(u => u.includes('city-clerk')));
  assert.ok(calls.some(u => u.includes('permit-forms')));
  assert.equal(result.status, 'pending');
  assert.match(result.message, /Arquivos vistos na página \(1\).*Summary June 2026/);
});

test('a refused crawled page stops the crawl instead of hammering the site', async () => {
  const source = {...src('newton'), url: 'https://www.newtonma.gov/government/inspectional-services/building-permit-summary-report', collector: {scope: 'month', crawl: true, crawlRe: 'permit|building'}};
  const calls = [];
  const base = 'https://www.newtonma.gov/government/inspectional-services/';
  const result = await collectDocuments(source, '2026-08', {fetch: fakeFetch({[source.url]: '<a href="' + base + 'permit-a">permit a</a><a href="' + base + 'permit-b">permit b</a>', [base + 'permit-a']: new Response('no', {status: 403})}, calls), ...noSleep});
  assert.ok(!calls.some(u => u.endsWith('permit-b')));
  assert.match(result.message, /Rastreamento interrompido/);
});

test('csv rows tolerate title lines and quoted commas; newest-period ranking understands quarter/half/month', () => {
  const rows = csvRows('\uFEFFTown permits 2026\r\nRecord #,Date Issued,Address,Cost\r\nBP-1,8/5/2026,"1 A ST, REAR","$1,200"\r\n');
  assert.equal(rows[2][2], '1 A ST, REAR');
  const mapped = mapStructured(rows, {}, '2026-08');
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].value, 1200);
  assert.ok(periodRank('2026 Q3 Residential') > periodRank('2026 Q1 Residential'));
  assert.ok(periodRank('2026 Q1') > periodRank('2025 Q4'));
  assert.ok(periodRank('Second half 2025') > periodRank('First half 2025'));
  assert.ok(periodRank('Permit Report - Oct 2025') > periodRank('Permit Report - Sept 2025'));
  assert.equal(periodRank('Permits'), 0);
});

test('"latest" scope picks only the newest period (all of its files) and ignores older years', async () => {
  const source = {...src('needham'), collector: {scope: 'latest', match: 'permit', maxFiles: 4}};
  const base = 'https://www.needhamma.gov/DocumentCenter/View/';
  const listing = ['2026 Q1 Building Permits Issued', '2026 Q3 Building Permits Issued - Residential', '2026 Q3 Building Permits Issued - Commercial', '2025 Q4 Building Permits Issued']
    .map((t, i) => '<a href="/DocumentCenter/View/' + (100 + i) + '">' + t + '</a>').join('') + '<div class="alert"><a href="/news/closure">Town hall closure notice</a></div>';
  const calls = [], texts = {[base + '101']: 'BP-26-77  8/5/2026  1 A ST  New single family dwelling  $500,000.00\n', [base + '102']: 'CB-26-5  8/9/2026  9 B ST  Commercial fit-out  $90,000.00\n'};
  const fetchImpl = fakeFetch({[source.url]: listing, [base + '101']: {body: pdfBytes, type: 'application/pdf'}, [base + '102']: {body: pdfBytes + '2', type: 'application/pdf'}}, calls);
  const result = await collectDocuments(source, '2026-08', {fetch: fetchImpl, pdfToText: async buf => texts[base + (buf.toString().endsWith('2') ? '102' : '101')], ...noSleep});
  assert.deepEqual(calls.slice(1).sort(), [base + '101', base + '102']);
  assert.equal(result.records.length, 2);
  // an older month the newest document does not cover stays pending and says what the document covers
  const older = await collectDocuments(source, '2026-02', {fetch: fakeFetch({[source.url]: listing, [base + '101']: {body: pdfBytes, type: 'application/pdf'}, [base + '102']: {body: pdfBytes + '2', type: 'application/pdf'}}), pdfToText: async buf => texts[base + (buf.toString().endsWith('2') ? '102' : '101')], ...noSleep});
  assert.equal(older.status, 'pending');
  assert.match(older.message, /cobre 2026-08-05 a 2026-08-09/);
});

test('fixed workbook links: SharePoint gets download=1 and the redirect cookie is carried to the file', async () => {
  const link = 'https://arlingtonma-my.sharepoint.com/:x:/g/personal/x/IQA?rtime=1', calls = [];
  const csv = 'Record #,Date Issued,Address,Description,Cost\nBP-1,8/5/2026,1 A ST,New home,"$100,000"\n';
  const fetchImpl = async (url, opts) => {
    calls.push({url, cookie: opts.headers.Cookie});
    if (url.includes('/:x:/')) return new Response('', {status: 302, headers: {location: 'https://arlingtonma-my.sharepoint.com/personal/x/download.aspx?id=1', 'set-cookie': 'FedAuth=abc; path=/; HttpOnly'}});
    if (opts.headers.Cookie !== 'FedAuth=abc') return new Response('login', {status: 403});
    return new Response(csv, {headers: {'content-type': 'text/csv'}});
  };
  const source = {...src('arlington'), collector: {fileUrls: [link]}};
  const result = await collectDocuments(source, '2026-08', {fetch: fetchImpl, ...noSleep});
  assert.match(calls[0].url, /download=1/);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].number, 'BP-1');
  assert.doesNotThrow(() => validatePermit(result.records[0], source));
});

test('a login redirect to an unreviewed host is a visible failure', async () => {
  const source = {...src('arlington'), collector: {fileUrls: ['https://arlingtonma-my.sharepoint.com/:x:/g/personal/x/IQA']}};
  await assert.rejects(collectDocuments(source, '2026-08', {fetch: async () => new Response('', {status: 302, headers: {location: 'https://login.microsoftonline.com/x'}}), ...noSleep}), /Redirecionamento/);
});

test('a link without a year takes the year heading above it', async () => {
  const source = src('needham'), base = 'https://www.needhamma.gov/DocumentCenter/View/';
  const listing = '<h3>2026</h3><a href="/DocumentCenter/View/1">1st Quarter</a><a href="/DocumentCenter/View/2">3rd\u200b Quarter</a><h3>2025</h3><a href="/DocumentCenter/View/3">3rd Quarter</a>';
  const calls = [];
  const result = await collectDocuments(source, '2026-08', {fetch: fakeFetch({[source.url]: listing, [base + '2']: {body: pdfBytes, type: 'application/pdf'}}, calls), pdfToText: async () => 'BP-26-77  8/5/2026  1 A ST  New single family dwelling  $500,000.00\n', ...noSleep});
  assert.deepEqual(calls.slice(1), [base + '2']);
  assert.equal(result.records.length, 1);
});

test('rows that start with the date and then the permit number are read (Amesbury layout)', () => {
  const text = 'DATE  RECORD  APPLICANT  ADDRESS  DESCRIPTION  COST\n10/1/2026 5:36  BR-26-545  Trinity Solar, LLC  10 MERRILL AVE, Amesbury, MA 01913  roof  $ 17,000.00\n';
  const rows = parseTextRows(text, {leadDate: true, columns: ['applicant', 'address', 'description', 'value']}, '2026-10');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].number, 'BR-26-545');
  assert.equal(rows[0].issued, '2026-10-01');
  assert.equal(rows[0].value, 17000);
  assert.match(rows[0].address, /^10 MERRILL AVE/);
});

test('month-only links with no year get their year from the newest-first order (West Hartford)', async () => {
  const source = src('west-hartford'), base = 'https://www.westhartfordct.gov/fs/resource-manager/view/';
  const months = ['October', 'September', 'August', 'January', 'December', 'November'];
  const listing = months.map((m, i) => '<a href="/fs/resource-manager/view/g' + i + '">' + m + '</a>').join('') + '<a href="/fs/resource-manager/view/demo">Demographics</a>';
  const calls = [];
  const result = await collectDocuments(source, '2026-08', {fetch: fakeFetch({[source.url]: listing, [base + 'g2']: {body: pdfBytes, type: 'application/pdf'}}, calls), pdfToText: async () => 'BP-26-77  8/5/2026  1 A ST  New single family dwelling  $500,000.00\n', now: () => new Date('2026-11-23T12:00:00Z'), ...noSleep});
  assert.deepEqual(calls.slice(1), [base + 'g2']);
  assert.equal(result.records.length, 1);
  const wrongYear = await collectDocuments(source, '2025-12', {fetch: fakeFetch({[source.url]: listing, [base + 'g4']: {body: pdfBytes, type: 'application/pdf'}}), pdfToText: async () => 'BP-25-9  12/5/2025  1 A ST  New single family dwelling  $500,000.00\n', now: () => new Date('2026-11-23T12:00:00Z'), ...noSleep});
  assert.equal(wrongYear.records.length, 1);
});

test('an unrecognized layout error carries the first lines that were read', async () => {
  const source = src('lexington'), base = 'https://www.lexingtonma.gov/DocumentCenter/View/';
  const listing = '<a href="/DocumentCenter/View/5">October 2026</a>';
  await assert.rejects(collectDocuments(source, '2026-10', {fetch: fakeFetch({[source.url]: listing, [base + '5']: {body: pdfBytes, type: 'application/pdf'}}), pdfToText: async () => 'Weird header line\nnothing that looks like a permit\n', ...noSleep}), /Início do que foi lido: Weird header line/);
});

test('rows without a recognizable date say so instead of claiming the month is empty', async () => {
  const source = {...src('lexington'), collector: {scope: 'month', rowMode: 'dated-line'}}, base = 'https://www.lexingtonma.gov/DocumentCenter/View/';
  const listing = '<a href="/DocumentCenter/View/5">October 2026</a>';
  const result = await collectDocuments(source, '2026-10', {fetch: fakeFetch({[source.url]: listing, [base + '5']: {body: pdfBytes, type: 'application/pdf'}}), pdfToText: async () => 'BP-26-77  Sept 5 2026  1 A ST  New dwelling  $5,000.00\n', ...noSleep});
  assert.equal(result.status, 'pending'); assert.match(result.message, /não trazem data reconhecida/);
});
