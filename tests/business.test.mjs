import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {hashPassword} from '../src/auth.mjs';
import {partnersAction} from '../src/partners.mjs';
import {saveTeamMember, clientCities, clientPermits} from '../src/client-api.mjs';
import {listLists, listAction, listKeys, permitDetail, saveNote, listFollowups, followupAction, listEstimates, estimateAction} from '../src/business.mjs';

const SRC = [{id: 'a', city: 'A', state: 'MA'}];
async function setup() {
  const db = openDatabase(':memory:');
  const co = partnersAction(db, SRC, 't', {op: 'saveCompany', name: 'Acme'}).id;
  const oid = partnersAction(db, SRC, 't', {op: 'saveClient', email: 'o@a.co', companyId: co, cities: ['a']}).id;
  const owner = {id: oid, companyId: co, role: 'owner', name: 'Olga'};
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO permits(id,source_id,issued,project_key,data,first_seen,updated_at) VALUES(?,?,?,?,?,?,?)').run('p1', 'a', today, 'k', JSON.stringify({id: 'p1', number: '1', issued: today, city: 'A', state: 'MA', address: '1 Main St', type: 'Addition', description: 'x', value: 1}), 'x', 'x');
  const sid = (await saveTeamMember(db, owner, SRC, {name: 'Sam', email: 's@a.co', role: 'seller', password: 'a-long-password-123', cities: clientCities(db, oid, SRC).map(c => c.key)}, hashPassword)).id;
  const seller = {id: sid, companyId: co, role: 'seller', name: 'Sam', email: 's@a.co'};
  const key = clientPermits(db, seller, {}, SRC).permits[0].key;
  return {db, owner, seller, key};
}
test('lists, notes and detail', async () => {
  const {db, seller, key} = await setup();
  const id = listAction(db, seller, {op: 'create', name: 'Newton'}).id;
  listAction(db, seller, {op: 'item', id, permitKey: key, on: true});
  assert.deepEqual(listKeys(db, seller, id), [key]);
  assert.equal(clientPermits(db, seller, {keys: listKeys(db, seller, id).join(',')}, SRC).total, 1);
  assert.equal(listLists(db, seller).lists.length, 2);
  saveNote(db, seller, {permitKey: key, note: 'call builder'});
  const d = permitDetail(db, seller, SRC, key); assert.equal(d.note, 'call builder'); assert.deepEqual(d.lists, [id]);
  assert.throws(() => listAction(db, seller, {op: 'delete', id: 999}), /não encontrada/);
});
test('follow-ups bucket by day and can be completed', async () => {
  const {db, seller} = await setup();
  followupAction(db, seller, {op: 'save', task: 'Call', kind: 'call', dueAt: '2026-11-23T10:00'});
  followupAction(db, seller, {op: 'save', task: 'Old', dueAt: '2026-11-01T10:00'});
  followupAction(db, seller, {op: 'save', task: 'Later', dueAt: '2026-12-01T10:00'});
  const b = listFollowups(db, seller, '2026-11-23T08:00').followups.map(f => f.bucket + ':' + f.task);
  assert.deepEqual(b.sort(), ['overdue:Old', 'today:Call', 'upcoming:Later']);
  const id = listFollowups(db, seller, '2026-11-23T08:00').followups[0].id; followupAction(db, seller, {op: 'complete', id});
  assert.equal(listFollowups(db, seller, '2026-11-23T08:00').followups.filter(f => f.bucket === 'completed').length, 1);
});
test('estimate flow: seller submits, owner prepares and asks review, seller approves, owner sends to customer', async () => {
  const {db, owner, seller, key} = await setup();
  const sent = [], send = async m => { sent.push(m); return {sent: true}; };
  const {id} = await estimateAction(db, seller, SRC, {op: 'save', permitKey: key, prospectName: 'Jo', prospectEmail: 'jo@x.co', scope: 'Insulate', submit: true}, {send});
  assert.equal(listEstimates(db, owner).estimates.length, 1);
  await assert.rejects(estimateAction(db, seller, SRC, {op: 'prepare', id, total: 10}, {send}), /Somente o owner/);
  await estimateAction(db, owner, SRC, {op: 'prepare', id, total: 2200, description: 'R-30 attic', ownerNote: 'Please confirm', requestReview: true}, {send});
  await assert.rejects(estimateAction(db, seller, SRC, {op: 'feedback', id, approve: false, text: ''}, {send}), /mudanças/);
  await estimateAction(db, seller, SRC, {op: 'feedback', id, approve: true}, {send});
  await estimateAction(db, owner, SRC, {op: 'send', id, companyName: 'Acme'}, {send});
  assert.equal(sent.length, 2); assert.equal(sent[0].to, 'jo@x.co'); assert.match(sent[0].text, /\$2,200\.00/);
  const e = listEstimates(db, seller).estimates[0]; assert.equal(e.status, 'sent'); assert.ok(e.events.length >= 4);
  await assert.rejects(estimateAction(db, owner, SRC, {op: 'send', id}, {send}), /já foi enviado/);
});
test('a failed e-mail never marks the estimate as sent', async () => {
  const {db, owner, seller, key} = await setup();
  const {id} = await estimateAction(db, seller, SRC, {op: 'save', permitKey: key, prospectName: 'Jo', prospectEmail: 'jo@x.co', submit: true}, {send: async () => ({sent: true})});
  await estimateAction(db, owner, SRC, {op: 'prepare', id, total: 100}, {});
  await assert.rejects(estimateAction(db, owner, SRC, {op: 'send', id}, {send: async () => ({sent: false, reason: 'smtp down'})}), /smtp down/);
  assert.equal(listEstimates(db, owner).estimates[0].status, 'with_owner');
});
