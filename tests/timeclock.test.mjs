import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {partnersAction} from '../src/partners.mjs';
import {clockStatus, clockAction, addReport, reportPhoto, timeOverview, setRate} from '../src/timeclock.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
function setup() {
  const db = openDatabase(':memory:');
  const mk = n => { const co = partnersAction(db, [], 't', {op: 'saveCompany', name: n}).id; const o = partnersAction(db, [], 't', {op: 'saveClient', email: n + '-o@a.co', companyId: co}).id; const e = partnersAction(db, [], 't', {op: 'saveClient', email: n + '-e@a.co', companyId: co}).id; db.prepare("UPDATE client_accounts SET role='employee' WHERE id=?").run(e); return {owner: {id: o, companyId: co, role: 'owner'}, emp: {id: e, companyId: co, role: 'employee'}}; };
  return {db, a: mk('A'), b: mk('B')};
}
test('clock in/out records hours and geolocation, blocks double punches', () => {
  const {db, a} = setup(), t0 = new Date('2026-11-23T13:00:00Z'), t1 = new Date('2026-11-23T21:30:00Z');
  clockAction(db, a.emp, {op: 'in', lat: 42.1, lng: -72.5}, t0);
  assert.throws(() => clockAction(db, a.emp, {op: 'in'}, t0), /aberto/);
  const s = clockAction(db, a.emp, {op: 'out', lat: 'abc', lng: 1}, t1);
  assert.equal(s.open, null); assert.equal(s.entries[0].hours, 8.5); assert.equal(s.weekHours, 8.5);
  assert.throws(() => clockAction(db, a.emp, {op: 'out'}, t1), /não está/);
  const row = db.prepare('SELECT in_lat,out_lat FROM crew_punches').get(); assert.equal(row.in_lat, 42.1); assert.equal(row.out_lat, null);
});
test('owner overview, hourly rate cost, company isolation and report photos', () => {
  const {db, a, b} = setup(), t0 = new Date('2026-11-23T13:00:00Z');
  clockAction(db, a.emp, {op: 'in', lat: 42, lng: -72}, t0); clockAction(db, a.emp, {op: 'out'}, new Date('2026-11-23T17:00:00Z'));
  setRate(db, a.owner, {id: a.emp.id, rate: 25});
  assert.throws(() => setRate(db, b.owner, {id: a.emp.id, rate: 99}), /não encontrada/);
  const o = timeOverview(db, a.owner, new Date('2026-11-24T12:00:00Z'));
  assert.equal(o.people.length, 1); assert.equal(o.people[0].weekHours, 4); assert.equal(o.people[0].weekCost, 100); assert.deepEqual(o.people[0].location, {lat: 42, lng: -72});
  assert.equal(timeOverview(db, b.owner).people[0].weekHours, 0);
  assert.throws(() => addReport(db, a.emp, {}), /observação/);
  assert.throws(() => addReport(db, a.emp, {photos: ['data:text/html;base64,AAAA']}), /Foto inválida/);
  addReport(db, a.emp, {note: 'Attic done', photos: [PNG], lat: 42, lng: -72});
  const pid = db.prepare('SELECT id FROM field_report_photos').get().id;
  assert.ok(reportPhoto(db, a.owner, pid)); assert.ok(reportPhoto(db, a.emp, pid));
  assert.equal(reportPhoto(db, b.owner, pid), null); assert.equal(timeOverview(db, a.owner).reports[0].photos[0], pid);
});
