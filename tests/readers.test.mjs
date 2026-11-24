import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toIso, csvRows, detectDelimiter, mapStructured, bboxRows, autoBboxConfig, parseUploadedFile} from '../src/documents.mjs';

test('dates are understood in many written formats, never taken out of free text for the new ones', () => {
  for (const [s, want] of [['Oct 1, 2026', '2026-10-01'], ['1-Oct-2026', '2026-10-01'], ['October 1, 2026', '2026-10-01'], ['2026/10/01', '2026-10-01'], ['10.01.2026', '2026-10-01'], ['20261001', '2026-10-01'], ['1 Oct 26', '2026-10-01'], ['Sept 5 2026', '2026-09-05'], ['10/1/26', '2026-10-01'], ['not a date', '']]) assert.equal(toIso(s), want, s);
});

test('CSV delimiter (semicolon, tab, pipe) and flexible headers are detected', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n'), ';'); assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3\n'), '\t'); assert.equal(detectDelimiter('a,b,c\n"1,5",2,3\n'), ',');
  const rows = mapStructured(csvRows('Permit ID;Property Address;Issue Date;Job Cost;Fee Total\nB1;12 Main St;Oct 3, 2026;$5,000;$40\n'));
  assert.deepEqual([rows[0].number, rows[0].address, rows[0].issued, rows[0].value], ['B1', '12 Main St', '2026-10-03', 5000]);
  const noAddr = mapStructured(csvRows('Permit #,Contractor Address,Date Issued,Project Address\nX1,9 Other Rd,2026-10-01,3 Elm St\n'));
  assert.equal(noAddr[0].address, '3 Elm St');
});

// A wide table drawn as positioned words: columns at fixed x, cells centred on the permit-number line.
const w = (text, x0, y0) => ({text, x0, x1: x0 + text.length * 4, y0, y1: y0 + 7});
function page() {
  const words = [w('Permit', 10, 60), w('Report', 40, 60), w('Permit', 10, 100), w('Date', 12, 108), w('Permit', 50, 100), w('Number', 50, 108), w('Address', 100, 108), w('Work', 180, 100), w('Description', 180, 108), w('Cost', 260, 108)];
  const row = (y, date, num, addr, desc, cost) => [w(date, 10, y), w(num, 50, y), ...addr.map((a, i) => w(a, 100, y + (i - (addr.length - 1) / 2) * 7)), ...desc.map((d, i) => w(d, 180, y + (i - (desc.length - 1) / 2) * 7)), w(cost, 260, y)];
  words.push(...row(150, '10/2/2026', 'B-26-001', ['5 ELM', 'ST'], ['Reroof', 'asphalt shingles', 'whole house'], '$9,000'), ...row(230, '10/5/2026', 'B-26-002', ['7 OAK AVE'], ['New deck'], '$12,000'), ...row(300, '10/9/2026', 'B-26-003', ['1 PINE RD'], ['Kitchen remodel'], '$30,000'));
  return {height: 600, words};
}
test('auto-detected columns read a wide PDF table by position', () => {
  const cfg = autoBboxConfig([page()]);
  assert.ok(cfg && cfg.columns.address && cfg.columns.issued && cfg.columns.description);
  const rows = bboxRows([page()], cfg);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].number, rows[0].issued, rows[0].address, rows[0].value], ['B-26-001', '2026-10-02', '5 ELM ST', 9000]);
  assert.equal(rows[0].description, 'Reroof asphalt shingles whole house');
  assert.equal(rows[2].description, 'Kitchen remodel');
});

test('upload falls back to position reading when the text layout finds nothing', async () => {
  const src = {id: 'zz', city: 'Zz', state: 'MA', url: 'https://www.zz.gov/p', mode: 'report'};
  const r = await parseUploadedFile({buffer: Buffer.from('%PDF-1.4 fake'), source: src, month: '2026-10', deps: {pdfToText: async () => 'nothing useful here', pdfWords: async () => [page()]}});
  assert.equal(r.records.length, 3); assert.equal(r.records[1].address, '7 OAK AVE');
});

test('a row repeated on a later page (cut by a page break) keeps the first, complete copy', () => {
  const second = {height: 600, words: page().words.map(x => ({...x, text: x.text === '5 ELM' ? 'ELM' : x.text}))};
  const rows = bboxRows([page(), second], autoBboxConfig([page()]));
  assert.equal(rows.length, 3); assert.equal(rows.find(r => r.number === 'B-26-001').address, '5 ELM ST');
});
