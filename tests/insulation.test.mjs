import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {partnersAction} from '../src/partners.mjs';
import {listInsulation, insulationAction} from '../src/insulation.mjs';

function setup() {
  const db = openDatabase(':memory:'), co = partnersAction(db, [{id: 'a', city: 'A', state: 'MA'}], 't', {op: 'saveCompany', name: 'Acme'}).id;
  return {db, owner: {id: 1, companyId: co, role: 'owner'}};
}
const byName = (d, n) => d.materials.find(m => m.name.startsWith(n)).id;

// The six lines of a real proposal made in the reference tool: every number below comes from that proposal.
test('real method: material + crew days x (day cost + day profit), days rounded up, fireblocking, Rockwool included', () => {
  const {db, owner} = setup(), d = listInsulation(db, owner), OC = byName(d, 'Open Cell'), CC = byName(d, 'Closed Cell'), RX = byName(d, 'Roxul 3');
  const lines = [
    {place: 'UNDER SIDE OF ROOF', depth: '2x12', materialId: OC, rv: 60, ft: 3608}, {place: 'EXTERIOR WALLS', depth: '2x12', materialId: OC, rv: 28, ft: 9604},
    {place: 'IN BETWEEN UNIT WALLS', depth: '2x4', materialId: RX, ft: 2772}, {place: 'GARAGE CEILING', depth: '2x12', materialId: OC, rv: 30, ft: 1680},
    {place: 'GARAGE HOUSE WALLS', depth: '2x4', materialId: CC, rv: 28, ft: 840}, {place: 'GARAGE WALLS', depth: '2x6', materialId: OC, rv: 21, ft: 2230}
  ];
  const r = insulationAction(db, owner, {op: 'calc', lines, fire: true}), t = r.totals;
  const m = Object.fromEntries(r.materials.map(x => [x.material, x]));
  assert.equal(m['Open Cell Spray Foam'].qty, 366); assert.equal(m['Closed Cell Spray Foam'].qty, 33); assert.equal(m['Roxul 3 inches 3x15'].qty, 35);
  assert.equal(t.gallons, 399); assert.equal(t.sprayDays, 8);   // 399 gal / 50 per day = 8 days (rounded up)
  // spray: 366 x 37 + 33 x 55 + 8 x 2,300 = 15,357 + 18,400 = 33,757; Roxul: 35 packs x 70 = 2,450 (labor and profit included); fireblocking 1,200
  assert.equal(t.fire, 1200); assert.equal(t.original, 33757 + 2450 + 1200);
  assert.equal(Math.round(r.rows.reduce((a, x) => a + x.price, 0)), 33757 + 2450);
  assert.equal(insulationAction(db, owner, {op: 'calc', lines, fire: true, firePrice: 800}).totals.fire, 800);
  assert.equal(insulationAction(db, owner, {op: 'calc', lines}).totals.fire, 0);
});
test('discount, tax and the rule that an extra charge needs a description', () => {
  const {db, owner} = setup(), d = listInsulation(db, owner), OC = byName(d, 'Open Cell');
  const lines = [{materialId: OC, rv: 42, ft: 1000}]; // 10 in x 1,000 ft = 10,000 bd ft / 379 = 26 gal x $37 = 962 + 1 day x 2,300
  const r = insulationAction(db, owner, {op: 'calc', lines, discountPct: 10, taxOn: true, taxRate: 6.25}).totals;
  assert.equal(r.original, 3262); assert.equal(r.discount, 326.2); assert.equal(r.tax, 183.49); assert.equal(r.total, 3119.29);
  assert.throws(() => insulationAction(db, owner, {op: 'calc', lines, extra: 100}), /extra/i);
  assert.ok(r.cost > 0 && r.profit < r.original);
});
test('validation and isolation between companies', () => {
  const {db, owner} = setup(); listInsulation(db, owner);
  assert.throws(() => insulationAction(db, owner, {op: 'save', name: 'x', kind: 'bad'}), /Tipo/);
  assert.throws(() => insulationAction(db, owner, {op: 'calc', lines: [{materialId: 99999, rv: 10, ft: 10}]}), /não encontrado/);
  const other = {id: 2, companyId: partnersAction(db, [], 't', {op: 'saveCompany', name: 'Other'}).id, role: 'owner'};
  const m = listInsulation(db, owner).materials[0];
  assert.throws(() => insulationAction(db, other, {op: 'calc', lines: [{materialId: m.id, rv: 10, ft: 10}]}), /não encontrado/);
});
