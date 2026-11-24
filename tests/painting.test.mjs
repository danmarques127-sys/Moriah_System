import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {partnersAction} from '../src/partners.mjs';
import {listPainting, paintingAction, buy} from '../src/painting.mjs';
import {listInsulation, insulationAction} from '../src/insulation.mjs';

function setup() {
  const db = openDatabase(':memory:'), co = partnersAction(db, [{id: 'a', city: 'A', state: 'MA'}], 't', {op: 'saveCompany', name: 'Acme'}).id;
  return {db, owner: {id: 1, companyId: co, role: 'owner'}};
}
test('paint is bought as buckets plus gallons, whichever costs less', () => {
  const p = {gal_price: 45, bucket_price: 190};
  assert.deepEqual(buy(12, p, 5), {buckets: 2, loose: 2, cost: 380 + 90});
  assert.deepEqual(buy(14, p, 5), {buckets: 2, loose: 4, cost: 380 + 180});   // 4 loose gallons (180) beat a third bucket (190)
  assert.deepEqual(buy(14, {gal_price: 50, bucket_price: 190}, 5), {buckets: 3, loose: 0, cost: 570});
});
test('painting: gallons from area x coats / coverage, crew hours rounded up, extras, private cost', () => {
  const {db, owner} = setup(), d = listPainting(db, owner), wall = d.products.find(x => x.kind === 'interior').id, ceil = d.products.find(x => x.kind === 'ceiling').id;
  assert.ok(d.extras.length >= 5);   // rollers, drop cloths... come as examples
  const roller = d.extras.find(x => /Roller/.test(x.name)), cloth = d.extras.find(x => /Drop/.test(x.name));
  const r = paintingAction(db, owner, {op: 'calc', lines: [{place: 'LIVING ROOM', productId: wall, area: 1400, coats: 2}, {place: 'CEILINGS', productId: ceil, area: 700, coats: 1}], extras: [{id: roller.id, qty: 4}, {id: cloth.id, qty: 2}]});
  const m = Object.fromEntries(r.materials.map(x => [x.product, x]));
  assert.equal(m['Interior wall paint'].gallons, 8);   // 2,800 / 350
  assert.equal(m['Ceiling paint'].gallons, 2);         // 700 / 350
  assert.equal(r.totals.hours, 24);                    // 3,500 coat-sq ft / 150 per hour = 23.3 -> 24
  assert.equal(r.totals.labor, 24 * 130);
  assert.equal(r.totals.extrasPrice, 4 * roller.unitPrice + 2 * cloth.unitPrice);
  assert.equal(r.totals.original, r.totals.material + r.totals.labor + r.totals.extrasPrice);
  assert.ok(r.totals.cost < r.totals.original);
  assert.throws(() => paintingAction(db, owner, {op: 'calc', lines: [{productId: wall, area: 100}], extras: [{id: 99999, qty: 1}]}), /não encontrado/);
});
test('extras are editable and also feed the insulation total', () => {
  const {db, owner} = setup(), d = listInsulation(db, owner), plastic = d.extras.find(x => /Plastic/.test(x.name)), OC = d.materials.find(m => m.name.startsWith('Open')).id;
  const base = insulationAction(db, owner, {op: 'calc', lines: [{materialId: OC, rv: 21, ft: 500}]}).totals.original;
  const withX = insulationAction(db, owner, {op: 'calc', lines: [{materialId: OC, rv: 21, ft: 500}], extras: [{id: plastic.id, qty: 2}]}).totals.original;
  assert.equal(Math.round((withX - base) * 100) / 100, 2 * plastic.unitPrice);
  insulationAction(db, owner, {op: 'xsave', id: plastic.id, name: 'Poly', unit: 'roll', unitCost: 50, unitPrice: 80});
  assert.equal(listInsulation(db, owner).extras.find(x => x.id === plastic.id).unitPrice, 80);
  const other = {id: 2, companyId: partnersAction(db, [], 't', {op: 'saveCompany', name: 'Other'}).id, role: 'owner'};
  assert.throws(() => insulationAction(db, other, {op: 'calc', lines: [{materialId: listInsulation(db, other).materials[0].id, rv: 10, ft: 10}], extras: [{id: plastic.id, qty: 1}]}), /não encontrado/);
});
