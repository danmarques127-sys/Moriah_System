import test from 'node:test';
import assert from 'node:assert/strict';
import {cardRows, bboxRows, prepPages, autoBboxConfig} from '../src/documents.mjs';
import {SOURCES} from '../src/sources.mjs';

// Helpers that build the word boxes pdftotext -bbox would give for a line of text starting at x.
const W = (text, x, y, w = null) => ({text, x0: x, x1: x + (w ?? text.length * 5), y0: y, y1: y + 9});
const line = (text, x, y) => { let cx = x; return text.split(' ').map(t => { const w = W(t, cx, y); cx = w.x1 + 3; return w; }); };

test('Needham card: permit type, construction type, value, owner, contractor and licence are read', () => {
  const words = [
    ...line('PERMIT #', 10, 10), ...line('DATE:', 160, 10), ...line('MBL#', 320, 10), ...line('STATUS', 470, 10),
    ...line('BR-26-10589', 10, 30), ...line('07/14/2026', 245, 30), ...line('1990520002900000', 350, 30), ...line('Active', 470, 30),
    ...line('PERMIT TYPE', 10, 50), ...line('ZONING', 315, 50), ...line('Residential', 10, 70),
    ...line('ADDRESS', 10, 110), ...line('5 TAMARACK LN, Needham, MA 02492', 10, 130),
    ...line('CONST. TYPE', 10, 230), ...line('USE GROUP', 160, 230), ...line('FOUNDATION', 315, 230), ...line('Addition/Alterations', 10, 250), ...line('Poured Concrete', 315, 250),
    ...line('DESCRIPTION', 10, 290), ...line('ESTIMATED COST', 672, 330), ...line('Addition and remodeling of existing home as per plans', 10, 350), ...line('$450,000', 720, 350),
    ...line('OWNER', 1050, 10), ...line('Alexandra Edelstein', 780, 30), ...line('5 Tamarack Lane, NEEDHAM, MA 02492', 1040, 30),
    ...line('CONTRACTOR', 1040, 130), ...line('James Cram', 780, 150), ...line('156 Prospect St, HOLLISTON, MA 01746', 1040, 150), ...line('Licence # 054065', 780, 170),
  ];
  const [r] = cardRows([{width: 1400, height: 420, words}]);
  assert.equal(r.number, 'BR-26-10589'); assert.equal(r.issued, '2026-07-14');
  assert.equal(r.type, 'Residential - Addition/Alterations'); assert.equal(r.value, 450000);
  assert.match(r.description, /^Addition and remodeling of existing home as per plans$/);
  assert.equal(r.applicant, 'Alexandra Edelstein'); assert.match(r.contractor, /James Cram · Lic\. 054065/);
  assert.match(r.address, /5 TAMARACK LN/);
});

test('West Hartford: work class, application type, value, description below the row and the applicant phone', () => {
  const x = f => f * 1000, rows = [];
  const add = (y, num, addr, val, cls, typ, applied, desc, contact) => rows.push(
    ...line(addr.split('|')[0], x(0.1), y), ...line(addr.split('|')[1], x(0.1), y + 11), ...line(num, x(0.255), y), ...line(val, x(0.34), y), ...line(cls, x(0.41), y), ...line(typ, x(0.47), y), ...line(applied, x(0.655), y),
    ...line('Contact Type', x(0.73), y), ...line('Applicant', x(0.73), y + 12), ...line(contact, x(0.815), y + 12), ...line(desc, x(0.256), y + 34));
  add(60, 'PRRF202606418', '106 LAYTON STREET,|WEST HARTFORD, CT 06107', '$10,243.00', 'Alteration', 'Roofing-Siding', '10/30/2026', 'Remove and replace 15 squares architectural asphalt roofing shingles', 'Heidi Jarvis, Phone:(860) 460-4140');
  add(160, 'PRPL202606426', '270 WHITING LANE,|WEST HARTFORD, CT 06107', '$1,500.00', 'Alteration', 'Plumbing', '10/30/2026', 'Kitchen renovation existing plumbing fixtures staying', 'Chris Cavaliere, Address:62 Scarboro Road');
  const [a, b] = bboxRows([{width: 1000, height: 600, words: rows}], SOURCES.find(s => s.id === 'west-hartford').collector.bbox);
  assert.equal(a.number, 'PRRF202606418'); assert.equal(a.issued, '2026-10-30'); assert.equal(a.value, 10243);
  assert.equal(a.type, 'Roofing-Siding - Alteration'); assert.match(a.description, /asphalt roofing shingles/);
  assert.equal(a.address, '106 LAYTON STREET, WEST HARTFORD, CT 06107'); assert.equal(a.applicant, 'Heidi Jarvis'); assert.equal(a.phone, '(860) 460-4140');
  assert.equal(b.type, 'Plumbing - Alteration'); assert.match(b.description, /Kitchen renovation/);
});

test('Milford: permit numbers printed on two lines, owner, permit for, address, description, contractor and cost', () => {
  const x = f => f * 600, rows = [];
  const add = (y, n1, n2, owner, pf, date, addr, desc, contractor, cost) => rows.push(
    ...line(n1, x(0.05), y), ...line(n2, x(0.05), y + 13), ...line(owner, x(0.12), y), ...line(pf, x(0.22), y), ...line(date, x(0.3), y), ...line(addr, x(0.38), y), ...line(desc, x(0.5), y), ...line(contractor, x(0.7), y), ...line(cost, x(0.82), y));
  add(200, 'B-26-', '1734', 'LISCIO', 'Window/Door', '10/01/2026', '22 RIDGEMONT', 'R&R 4 windows', 'Gregory Mazares', '$8,545.00');
  add(300, 'B-26-', '1586', 'STIRK', 'Alteration', '10/01/2026', '35 REVERE PL', 'Removed old cement front stairs', '', '$1,200.00');
  const out = bboxRows(prepPages([{width: 600, height: 800, words: rows}]), SOURCES.find(s => s.id === 'milford').collector.bbox);
  assert.deepEqual(out.map(r => r.number), ['B-26-1734', 'B-26-1586']);
  assert.equal(out[0].type, 'Window/Door'); assert.equal(out[0].value, 8545); assert.equal(out[0].contractor, 'Gregory Mazares'); assert.match(out[0].description, /R&R 4 windows/);
  assert.equal(out[1].address, '35 REVERE PL'); assert.equal(out[1].issued, '2026-10-01');
});

test('column reader maps a "Permit For" header to the type column', () => {
  const header = [...line('Permit Number', 20, 40), ...line('Permit For', 120, 40), ...line('Date Issued', 220, 40), ...line('Address', 320, 40), ...line('Work Description', 420, 40), ...line('Project Cost', 560, 40)];
  const data = []; for (let i = 0; i < 4; i++) { const y = 70 + i * 30; data.push(...line('B-26-10' + i, 20, y), ...line('Reroof', 120, y), ...line('10/0' + (i + 1) + '/2026', 220, y), ...line((10 + i) + ' MAIN ST', 320, y), ...line('Replace roof shingles', 420, y), ...line('$9,000.00', 560, y)); }
  const cfg = autoBboxConfig([{width: 700, height: 600, words: [...header, ...data]}]);
  assert.ok(cfg && cfg.columns.type, JSON.stringify(cfg));
  assert.equal(bboxRows([{width: 700, height: 600, words: [...header, ...data]}], cfg)[0].type, 'Reroof');
});
