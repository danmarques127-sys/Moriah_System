import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {hashPassword} from '../src/auth.mjs';
import {partnersAction} from '../src/partners.mjs';
import {saveTeamMember, teamAction, listTeam, setFavorite, favoriteKeys, addVisit, listVisits, photoFor, clientCities, clientPermits} from '../src/client-api.mjs';

const SRC = ['a', 'b', 'c'].map(id => ({id, city: id.toUpperCase(), state: 'MA'}));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
async function setup() {
  const db = openDatabase(':memory:');
  const co = partnersAction(db, SRC, 't', {op: 'saveCompany', name: 'Acme', maxCities: 3}).id;
  const oid = partnersAction(db, SRC, 't', {op: 'saveClient', email: 'o@a.co', companyId: co, cities: ['a', 'b']}).id;
  const owner = {id: oid, companyId: co, role: 'owner'};
  const today = new Date().toISOString().slice(0, 10);
  for (const [i, src] of [['1', 'a'], ['2', 'b'], ['3', 'c']]) db.prepare('INSERT INTO permits(id,source_id,issued,project_key,data,first_seen,updated_at) VALUES(?,?,?,?,?,?,?)').run('p' + i, src, today, 'k' + i, JSON.stringify({id: 'p' + i, number: i, issued: today, city: src, state: 'MA', address: i + ' Main St', type: 'Roof', description: 'x', value: 1}), 'x', 'x');
  return {db, owner, co};
}
const h = hashPassword;
const pw = 'a-long-password-123';

test('owner creates a seller limited to a subset of own cities; seller sees only those', async () => {
  const {db, owner, co} = await setup();
  const keys = clientCities(db, owner.id, SRC).map(c => c.key);
  const sid = (await saveTeamMember(db, owner, SRC, {name: 'Sam', email: 's@a.co', role: 'seller', password: pw, cities: [keys[0], 'not-a-key']}, h)).id;
  const seller = {id: sid, companyId: co, role: 'seller'};
  assert.equal(clientCities(db, sid, SRC).length, 1);
  const r = clientPermits(db, seller, {}, SRC); assert.equal(r.total, 1);
  assert.equal(listTeam(db, owner, SRC).members.length, 1);
});
test('only 5 active employee spots', async () => {
  const {db, owner} = await setup();
  for (let i = 0; i < 5; i++) await saveTeamMember(db, owner, SRC, {name: 'E' + i, email: 'e' + i + '@a.co', role: 'employee', password: pw}, h);
  await assert.rejects(saveTeamMember(db, owner, SRC, {name: 'X', email: 'x@a.co', role: 'employee', password: pw}, h), /Limite de 5/);
  const m = listTeam(db, owner, SRC).members[0];
  await teamAction(db, owner, {op: 'setActive', id: m.id, active: false}, h);
  await saveTeamMember(db, owner, SRC, {name: 'X', email: 'x@a.co', role: 'employee', password: pw}, h);
});
test('a business cannot touch another business team', async () => {
  const {db, owner} = await setup();
  const co2 = partnersAction(db, SRC, 't', {op: 'saveCompany', name: 'Other'}).id;
  const other = {id: partnersAction(db, SRC, 't', {op: 'saveClient', email: 'o@b.co', companyId: co2, cities: ['c']}).id, companyId: co2, role: 'owner'};
  const sid = (await saveTeamMember(db, owner, SRC, {name: 'Sam', email: 's@a.co', role: 'seller', password: pw}, h)).id;
  await assert.rejects(teamAction(db, other, {op: 'setActive', id: sid, active: false}, h), /não encontrada/);
});
test('favorites and site visits: seller sees own, owner sees all, photos are private to the company', async () => {
  const {db, owner, co} = await setup();
  const keys = clientCities(db, owner.id, SRC).map(c => c.key);
  const sid = (await saveTeamMember(db, owner, SRC, {name: 'Sam', email: 's@a.co', role: 'seller', password: pw, cities: keys}, h)).id;
  const seller = {id: sid, companyId: co, role: 'seller'};
  const list = clientPermits(db, seller, {}, SRC), key = list.permits[0].key;
  setFavorite(db, seller, key, true); assert.ok(favoriteKeys(db, seller).has(key));
  assert.equal(clientPermits(db, seller, {fav: '1'}, SRC).total, 1);
  const v = addVisit(db, seller, SRC, {permitKey: key, notes: 'n', measurements: '10x10', photos: [PNG]});
  assert.equal(listVisits(db, owner).length, 1); assert.equal(listVisits(db, seller).length, 1);
  const photoId = listVisits(db, owner)[0].photos[0];
  assert.ok(photoFor(db, owner, photoId)); assert.ok(photoFor(db, seller, photoId));
  const stranger = {id: 999, companyId: co + 1, role: 'owner'}; assert.equal(photoFor(db, stranger, photoId), null);
  assert.throws(() => addVisit(db, seller, SRC, {permitKey: 'ffffffffffffffff', notes: 'x'}), /fora das suas cidades/);
  assert.throws(() => addVisit(db, seller, SRC, {permitKey: key, photos: ['data:text/html;base64,AAAA']}), /Foto inválida/);
  assert.ok(v.id);
});

import {seedDemoClients} from '../scripts/demo-clients.mjs';
import {clientLogin} from '../src/client-api.mjs';
test('demo clients can sign in with a user name, are idempotent, and have the right roles', async () => {
  const db = openDatabase(':memory:');
  seedDemoClients(db); seedDemoClients(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM client_accounts').get().n, 3);
  assert.equal(db.prepare("SELECT role FROM client_accounts WHERE email='johnhmbrothersinsulation'").get().role, 'seller');
  assert.ok(await clientLogin(db, 'HomeroSampaio', 'Ahesqueci1'));
  assert.equal(await clientLogin(db, 'homerosampaio', 'wrong-password-xx'), null);
});
