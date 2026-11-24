import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {partnersAction, monthKey} from '../src/partners.mjs';
import {clientPermits, tradesOf} from '../src/client-api.mjs';
import {removeMember, updateMember} from '../src/service.mjs';

const SOURCES = ['a', 'b', 'c', 'd'].map(id => ({id, city: id.toUpperCase(), state: 'MA'}));
function setup() {
  const db = openDatabase(':memory:');
  const {id: company} = partnersAction(db, SOURCES, 't', {op: 'saveCompany', name: 'Acme', maxCities: 2, monthlyPermits: 10, tradeIds: [8]});
  return {db, company};
}
const permit = (id, type, description = '') => ({id, number: id, issued: new Date().toISOString().slice(0, 10), city: 'A', state: 'MA', address: id, type, description, value: 1});
function seed(db, n, type = 'Roof replacement') { for (let i = 0; i < n; i++) db.prepare('INSERT INTO permits(id,source_id,issued,project_key,data,first_seen,updated_at) VALUES(?,?,?,?,?,?,?)').run('p' + i, 'a', new Date().toISOString().slice(0, 10), 'k' + i, JSON.stringify(permit('p' + i, type)), 'x', 'x'); }

test('company city limit is enforced across all of its accounts', () => {
  const {db, company} = setup();
  partnersAction(db, SOURCES, 't', {op: 'saveClient', email: 'x@y.co', companyId: company, cities: ['a', 'b']});
  assert.throws(() => partnersAction(db, SOURCES, 't', {op: 'saveClient', email: 'z@y.co', companyId: company, cities: ['c']}), /no máximo 2/);
  partnersAction(db, SOURCES, 't', {op: 'saveClient', email: 'z@y.co', companyId: company, cities: ['a']});
});
test('monthly permit limit counts each permit once and hides the rest', () => {
  const {db, company} = setup();
  const cid = partnersAction(db, SOURCES, 't', {op: 'saveClient', email: 'x@y.co', companyId: company, cities: ['a']}).id;
  db.prepare('UPDATE companies SET monthly_permits=5 WHERE id=?').run(company);
  db.prepare('DELETE FROM company_trades').run();
  const cols = db.prepare('PRAGMA table_info(permits)').all().map(c => c.name);
  assert.ok(cols.includes('data'));
  seed(db, 8);
  const client = {id: cid, companyId: company};
  const first = clientPermits(db, client, {}, SOURCES);
  assert.equal(first.permits.length, 5); assert.equal(first.limits.used, 5); assert.equal(first.limits.capped, true); assert.equal(first.total, 8);
  const again = clientPermits(db, client, {}, SOURCES);
  assert.equal(again.limits.used, 5); assert.equal(again.permits.length, 5);
  assert.match(monthKey(), /^\d{4}-\d{2}$/);
});
test('trade classification and company trade restriction', () => {
  assert.deepEqual(tradesOf({type: 'Roof tear-off'}), ['Roofing']);
  assert.ok(tradesOf({type: 'Electrical', description: 'solar panels'}).includes('Electrical'));
  assert.deepEqual(tradesOf({type: 'Sign'}), ['Other']);
});
test('workspace owner cannot be removed or demoted; members can', async () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO workspaces(id,name,settings,created_at) VALUES('w','W','{}','x')").run();
  const ins = (id, role, sa) => db.prepare('INSERT INTO users(id,workspace_id,email,password_hash,role,system_admin,created_at) VALUES(?,?,?,?,?,?,?)').run(id, 'w', id + '@x.co', 'h', role, sa, 'x');
  ins('boss', 'owner', 1); ins('mate', 'viewer', 0);
  const boss = {id: 'boss', workspace_id: 'w', email: 'boss@x.co'};
  assert.throws(() => removeMember(db, boss, {id: 'boss'}), /si mesmo/);
  await assert.rejects(updateMember(db, {id: 'mate', workspace_id: 'w', email: 'm'}, {id: 'boss', role: 'viewer'}), /rebaixado/);
  await updateMember(db, boss, {id: 'mate', role: 'owner'});
  assert.equal(db.prepare("SELECT role FROM users WHERE id='mate'").get().role, 'owner');
  removeMember(db, boss, {id: 'mate'});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE id='mate'").get().n, 0);
});

test('company-level cities go to owners and trim sellers', () => {
  const {db, company} = setup();
  const o = partnersAction(db, SOURCES, 't', {op: 'saveClient', email: 'o@y.co', companyId: company}).id;
  db.prepare("UPDATE client_accounts SET role='owner' WHERE id=?").run(o);
  const s = partnersAction(db, SOURCES, 't', {op: 'saveClient', email: 's@y.co', companyId: company}).id;
  db.prepare("UPDATE client_accounts SET role='seller' WHERE id=?").run(s);
  const co = {op: 'saveCompany', id: company, name: 'Acme'};
  partnersAction(db, SOURCES, 't', {...co, cities: ['a', 'b']});
  const of = id => db.prepare('SELECT source_id AS s FROM client_cities WHERE client_id=? ORDER BY 1').all(id).map(r => r.s);
  assert.deepEqual(of(o), ['a', 'b']); assert.deepEqual(of(s), ['a', 'b']);
  db.prepare('DELETE FROM client_cities WHERE client_id=? AND source_id=?').run(s, 'a');
  partnersAction(db, SOURCES, 't', {...co, cities: ['a', 'b']});
  assert.deepEqual(of(s), ['b']);
  partnersAction(db, SOURCES, 't', {...co, cities: ['b', 'c']});
  assert.deepEqual(of(o), ['b', 'c']); assert.deepEqual(of(s), ['b', 'c']);
  partnersAction(db, SOURCES, 't', {...co, cities: ['c']});
  assert.deepEqual(of(o), ['c']); assert.deepEqual(of(s), ['c']);
  assert.throws(() => partnersAction(db, SOURCES, 't', {...co, cities: ['a', 'b', 'c']}), /no máximo 2/);
});
