import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {partnersAction} from '../src/partners.mjs';
import {listInsulation, insulationAction} from '../src/insulation.mjs';

function setup() {
  const db = openDatabase(':memory:'), co = partnersAction(db, [{id: 'a', city: 'A', state: 'MA'}], 't', {op: 'saveCompany', name: 'Acme'}).id;
  return {db, owner: {id: 1, companyId: co, role: 'owner'}};
}
test('spray foam: net area x thickness -> board feet -> gallons -> barrels, cost per gallon', () => {
  const {db, owner} = setup(), {materials} = listInsulation(db, owner), cc = materials.find(m => m.kind === 'foam_closed');
  insulationAction(db, owner, {op: 'settings', crewSize: 2, galPerDay: 60, crewDayCost: 800, wastePct: 0, markupPct: 0, sqftPerDay: 1500, barrelGal: 45});
  const r = insulationAction(db, owner, {op: 'calc', lines: [{materialId: cc.id, sqft: 2112, openings: 100, inches: 2}]}); // 2,012 net sq ft x 2" = 4,024 bd ft (old calibration example)
  const row = r.rows[0];
  assert.equal(row.sqft, 2012); assert.equal(row.boardFeet, 4024); assert.equal(row.gallons, 41.92); assert.equal(row.barrels, 0.93);
  assert.equal(row.materialCost, 2095.83); assert.equal(row.r, 13); assert.equal(r.items[0].qty, 2012);
});
test('hybrid: closed cell layer first, open cell fills the rest of the target R', () => {
  const {db, owner} = setup(), {materials} = listInsulation(db, owner), cc = materials.find(m => m.kind === 'foam_closed'), oc = materials.find(m => m.kind === 'foam_open');
  insulationAction(db, owner, {op: 'settings', crewSize: 2, galPerDay: 60, crewDayCost: 800, wastePct: 0, markupPct: 0, sqftPerDay: 1500, barrelGal: 45});
  const r = insulationAction(db, owner, {op: 'calc', lines: [{materialId: cc.id, sqft: 1000, inches: 2, hybridId: oc.id, targetR: 49}]});
  assert.equal(r.rows.length, 2); assert.equal(r.rows[0].r, 13); assert.equal(r.rows[1].inches, 9.73); // (49-13)/3.7
  assert.equal(r.rows[1].boardFeet, 9729.73); assert.ok(r.rows[1].gallons > 25 && r.rows[1].gallons < 26);
  assert.ok(r.items[0].description.includes('+'));
});
test('batts and blown-in use sq ft coverage and crew productivity; waste and markup apply', () => {
  const {db, owner} = setup(), {materials} = listInsulation(db, owner), b = materials.find(m => m.name.includes('R-19'));
  insulationAction(db, owner, {op: 'settings', crewSize: 2, galPerDay: 60, crewDayCost: 900, wastePct: 10, markupPct: 50, sqftPerDay: 1500});
  const r = insulationAction(db, owner, {op: 'calc', lines: [{materialId: b.id, sqft: 1500}]}).totals;
  assert.equal(r.materialCost, round(1500 * 1.1 * 0.7)); assert.equal(r.laborCost, 900); assert.equal(r.price, round((1500 * 1.1 * 0.7 + 900) * 1.5));
});
test('validation and isolation between companies', () => {
  const {db, owner} = setup(); listInsulation(db, owner);
  assert.throws(() => insulationAction(db, owner, {op: 'save', name: 'x', kind: 'bad'}), /Tipo/);
  assert.throws(() => insulationAction(db, owner, {op: 'calc', lines: [{materialId: 99999, sqft: 10, inches: 2}]}), /não encontrado/);
  const other = {id: 2, companyId: partnersAction(db, [], 't', {op: 'saveCompany', name: 'Other'}).id, role: 'owner'};
  const m = listInsulation(db, owner).materials[0];
  assert.throws(() => insulationAction(db, other, {op: 'calc', lines: [{materialId: m.id, sqft: 10, inches: 2}]}), /não encontrado/);
});
const round = v => Math.round(v * 100) / 100;
