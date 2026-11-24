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
test('proposal lines reproduce the reference tool: line prices, original price, extra, materials list', () => {
  const {db, owner} = setup(), d = listInsulation(db, owner), OC = byName(d, 'Open Cell'), CC = byName(d, 'Closed Cell'), RX = byName(d, 'Roxul 3');
  const lines = [
    {place: 'UNDER SIDE OF ROOF', depth: '2x12', materialId: OC, rv: 60, ft: 3608}, {place: 'EXTERIOR WALLS', depth: '2x12', materialId: OC, rv: 28, ft: 9604},
    {place: 'IN BETWEEN UNIT WALLS', depth: '2x4', materialId: RX, ft: 2772}, {place: 'GARAGE CEILING', depth: '2x12', materialId: OC, rv: 30, ft: 1680},
    {place: 'GARAGE HOUSE WALLS', depth: '2x4', materialId: CC, rv: 28, ft: 840}, {place: 'GARAGE WALLS', depth: '2x6', materialId: OC, rv: 21, ft: 2230}
  ];
  const r = insulationAction(db, owner, {op: 'calc', lines, extra: -10685.75, extraNote: 'Adjustment'});
  assert.deepEqual(r.rows.map(x => x.price), [18040, 22409.33, 5128.2, 4200, 4076.8, 3902.5]);
  assert.deepEqual(r.rows.map(x => x.inches), [14.29, 6.67, 0, 7.14, 3.73, 5]);
  assert.equal(r.totals.original, 57756.83); assert.equal(r.totals.total, 47071.08);
  const m = Object.fromEntries(r.materials.map(x => [x.material, x]));
  assert.equal(m['Open Cell Spray Foam'].qty, 366); assert.equal(m['Open Cell Spray Foam'].unit, 'GL');
  assert.equal(m['Closed Cell Spray Foam'].qty, 33); assert.equal(m['Roxul 3 inches 3x15'].qty, 35);
});
test('discount, tax and the rule that an extra charge needs a description', () => {
  const {db, owner} = setup(), d = listInsulation(db, owner), OC = byName(d, 'Open Cell');
  const lines = [{materialId: OC, rv: 42, ft: 1000}]; // 10 in x 1,000 ft x $0.35 = $3,500
  const r = insulationAction(db, owner, {op: 'calc', lines, discountPct: 10, taxOn: true, taxRate: 6.25}).totals;
  assert.equal(r.original, 3500); assert.equal(r.discount, 350); assert.equal(r.tax, 196.88); assert.equal(r.total, 3346.88);
  assert.throws(() => insulationAction(db, owner, {op: 'calc', lines, extra: 100}), /extra/i);
  assert.ok(r.cost > 0 && r.profit < r.original); // private cost side: gallons x cost + crew days
});
test('validation and isolation between companies', () => {
  const {db, owner} = setup(); listInsulation(db, owner);
  assert.throws(() => insulationAction(db, owner, {op: 'save', name: 'x', kind: 'bad'}), /Tipo/);
  assert.throws(() => insulationAction(db, owner, {op: 'calc', lines: [{materialId: 99999, rv: 10, ft: 10}]}), /não encontrado/);
  const other = {id: 2, companyId: partnersAction(db, [], 't', {op: 'saveCompany', name: 'Other'}).id, role: 'owner'};
  const m = listInsulation(db, owner).materials[0];
  assert.throws(() => insulationAction(db, other, {op: 'calc', lines: [{materialId: m.id, rv: 10, ft: 10}]}), /não encontrado/);
});
