import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {partnersAction} from '../src/partners.mjs';
import {listCustomers, customerDetail, customerAction, touchCustomerFromEstimate} from '../src/crm.mjs';
import {listPrices, pricesAction, calculate} from '../src/pricing.mjs';
import {invoiceAction, jobAction} from '../src/finance.mjs';

function setup() {
  const db = openDatabase(':memory:');
  const mk = n => { const co = partnersAction(db, [], 't', {op: 'saveCompany', name: n}).id; const o = partnersAction(db, [], 't', {op: 'saveClient', email: n + '@a.co', companyId: co}).id; return {id: o, companyId: co, role: 'owner'}; };
  return {db, a: mk('A'), b: mk('B')};
}
test('CRM: customers, notes, timeline, isolation and estimate hook', async () => {
  const {db, a, b} = setup();
  const {id} = customerAction(db, a, {op: 'save', name: 'Pat Lee', email: 'PAT@x.co', phone: '555', status: 'lead'});
  customerAction(db, a, {op: 'note', id, text: 'Called, wants quote'}, 'Homero');
  assert.equal(touchCustomerFromEstimate(db, a.companyId, {name: 'Pat Lee', email: 'pat@x.co', address: '1 Elm'}), id);
  assert.equal(customerDetail(db, a, id).customer.status, 'quoted');
  const {id: inv} = await invoiceAction(db, a, {op: 'save', customerId: id, toName: 'Pat', toEmail: 'pat@x.co', items: [{description: 'W', qty: 1, price: 100}]});
  jobAction(db, a, {op: 'save', name: 'Pat attic', customerId: id});
  const kinds = customerDetail(db, a, id).timeline.map(t => t.kind); for (const k of ['note', 'invoice', 'job', 'created']) assert.ok(kinds.includes(k), k);
  assert.equal(listCustomers(db, a, {q: 'pat'}).customers.length, 1); assert.equal(listCustomers(db, a, {status: 'past'}).customers.length, 0);
  assert.equal(listCustomers(db, b).customers.length, 0); assert.throws(() => customerDetail(db, b, id), /não encontrado/); assert.throws(() => customerAction(db, a, {op: 'save', name: 'X', email: 'bad'}), /inválido/);
  assert.ok(inv);
});
test('pricing: seeded per company, editable, calculator with markup keeps cost/profit', () => {
  const {db, a, b} = setup();
  const l = listPrices(db, a); assert.ok(l.trades.includes('Insulation') && l.items.length > 20);
  const attic = l.items.find(i => i.name.startsWith('Blown-in'));
  const r = calculate(db, a, {lines: [{itemId: attic.id, qty: 1000}], markup: 10, taxRate: 6.25});
  assert.equal(r.items[0].price, 2.31); assert.equal(r.subtotal, 2310); assert.equal(r.internalCost, 950); assert.equal(r.profit, 1360); assert.equal(r.total, 2454.38);
  pricesAction(db, a, {op: 'save', id: attic.id, trade: 'Insulation', name: attic.name, unit: 'sq ft', price: 3, cost: 1});
  assert.equal(calculate(db, a, {lines: [{itemId: attic.id, qty: 10}]}).subtotal, 30);
  listPrices(db, b); assert.throws(() => calculate(db, b, {lines: [{itemId: attic.id, qty: 1}]}), /não encontrado/);
  assert.throws(() => pricesAction(db, a, {op: 'save', trade: 'HVAC', name: 'x', price: -1}), /inválidos/);
  pricesAction(db, a, {op: 'reset'}); assert.equal(listPrices(db, a).items.find(i => i.name.startsWith('Blown-in')).price, 2.1);
});
