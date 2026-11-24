import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {hashPassword} from '../src/auth.mjs';
import {partnersAction} from '../src/partners.mjs';
import {getProfile, saveProfile} from '../src/client-api.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
async function setup() {
  const db = openDatabase(':memory:');
  const co = partnersAction(db, [], 't', {op: 'saveCompany', name: 'Acme'}).id;
  const id = partnersAction(db, [], 't', {op: 'saveClient', email: 'o@a.co', companyId: co}).id;
  db.prepare('UPDATE client_accounts SET password_hash=? WHERE id=?').run(await hashPassword('old-password-12345'), id);
  const mk = (role, i) => ({id: i, companyId: co, role, token_hash: 'x'});
  return {db, co, owner: mk('owner', id), id};
}
test('profile: owner edits personal + company data and photo', async () => {
  const {db, owner} = await setup();
  const r = await saveProfile(db, owner, {name: 'Homero', phone: '555', title: 'Owner', photo: PNG, company: {name: 'H&M Brothers', contactEmail: 'a@b.co', address: '1 Main St', logo: PNG}}, hashPassword);
  assert.equal(r.me.name, 'Homero'); assert.equal(r.me.photo, PNG); assert.equal(r.company.name, 'H&M Brothers'); assert.equal(r.company.logo, PNG);
  await assert.rejects(saveProfile(db, owner, {name: 'x', photo: 'javascript:alert(1)'}, hashPassword), /imagem/);
  await assert.rejects(saveProfile(db, owner, {name: 'x', company: {name: 'Y', contactEmail: 'bad'}}, hashPassword), /E-mail/);
});
test('profile: a seller cannot change company data; password change needs the current one', async () => {
  const {db, co} = await setup();
  const sid = partnersAction(db, [], 't', {op: 'saveClient', email: 's@a.co', companyId: co}).id;
  db.prepare("UPDATE client_accounts SET role='seller',password_hash=? WHERE id=?").run(await hashPassword('old-password-12345'), sid);
  const seller = {id: sid, companyId: co, role: 'seller', token_hash: 'x'};
  await saveProfile(db, seller, {name: 'John', company: {name: 'Hacked'}}, hashPassword);
  assert.equal(getProfile(db, seller).company.name, 'Acme'); assert.equal(getProfile(db, seller).canEditCompany, false);
  await assert.rejects(saveProfile(db, seller, {op: 'password', current: 'wrong', password: 'new-password-12345'}, hashPassword), /atual/);
  await assert.rejects(saveProfile(db, seller, {op: 'password', current: 'old-password-12345', password: 'short'}, hashPassword), /16 caracteres/);
  await saveProfile(db, seller, {op: 'password', current: 'old-password-12345', password: 'new-password-12345'}, hashPassword);
});
