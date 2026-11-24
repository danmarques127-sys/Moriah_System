// Time clock + field reports. Employees (and sellers) clock in/out with geolocation and send photos/notes to the office.
// The owner sees crew status, hours, locations and reports for the own company only.
import {isOwner} from './client-api.mjs';

const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const IMG = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const geo = (lat, lng) => {
  const a = Number(lat), o = Number(lng);
  return lat == null || lng == null || lat === '' || !Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180 ? [null, null] : [Math.round(a * 1e5) / 1e5, Math.round(o * 1e5) / 1e5];
};
const hoursBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 3600000);
const round2 = v => Math.round(v * 100) / 100;
const weekStart = (now = new Date()) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString(); };

export function clockStatus(db, client, now = new Date()) {
  const open = db.prepare('SELECT id,in_at AS inAt FROM crew_punches WHERE client_id=? AND out_at IS NULL ORDER BY id DESC LIMIT 1').get(client.id) || null;
  const entries = db.prepare('SELECT id,in_at AS inAt,out_at AS outAt FROM crew_punches WHERE client_id=? ORDER BY id DESC LIMIT 14').all(client.id).map(r => ({...r, hours: round2(hoursBetween(r.inAt, r.outAt || now.toISOString()))}));
  const ws = weekStart(now), week = db.prepare('SELECT in_at,out_at FROM crew_punches WHERE client_id=? AND in_at>=?').all(client.id, ws).reduce((t, r) => t + hoursBetween(r.in_at, r.out_at || now.toISOString()), 0);
  return {open, entries, weekHours: round2(week), reports: db.prepare('SELECT COUNT(*) n FROM field_reports WHERE client_id=? AND created_at>=?').get(client.id, ws).n};
}
export function clockAction(db, client, b, now = new Date()) {
  const open = db.prepare('SELECT id FROM crew_punches WHERE client_id=? AND out_at IS NULL ORDER BY id DESC LIMIT 1').get(client.id), [lat, lng] = geo(b.lat, b.lng);
  if (b.op === 'in') {
    if (open) fail('Você já está com o ponto aberto.');
    db.prepare('INSERT INTO crew_punches(company_id,client_id,in_at,in_lat,in_lng) VALUES(?,?,?,?,?)').run(client.companyId, client.id, now.toISOString(), lat, lng);
  } else if (b.op === 'out') {
    if (!open) fail('Você não está com o ponto aberto.');
    db.prepare('UPDATE crew_punches SET out_at=?,out_lat=?,out_lng=? WHERE id=?').run(now.toISOString(), lat, lng, open.id);
  } else fail('Operação inválida.');
  return clockStatus(db, client, now);
}
export function addReport(db, client, b, now = new Date()) {
  const note = clean(b.note, 2000), photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 6), [lat, lng] = geo(b.lat, b.lng);
  if (!note && !photos.length) fail('Escreva uma observação ou anexe fotos.');
  const parsed = photos.map(x => { const m = IMG.exec(String(x)); if (!m || m[2].length > 400000) fail('Foto inválida ou grande demais.'); return {mime: m[1], buf: Buffer.from(m[2], 'base64')}; });
  const id = Number(db.prepare('INSERT INTO field_reports(company_id,client_id,note,lat,lng,created_at) VALUES(?,?,?,?,?,?)').run(client.companyId, client.id, note, lat, lng, now.toISOString()).lastInsertRowid);
  for (const p of parsed) db.prepare('INSERT INTO field_report_photos(report_id,mime,data) VALUES(?,?,?)').run(id, p.mime, p.buf);
  return {id};
}
export function reportPhoto(db, client, id) {
  const r = db.prepare('SELECT p.mime,p.data,f.company_id AS co,f.client_id AS cl FROM field_report_photos p JOIN field_reports f ON f.id=p.report_id WHERE p.id=?').get(Number(id));
  if (!r || r.co !== client.companyId || (r.cl !== client.id && !isOwner(client))) return null;
  return {mime: r.mime, data: r.data};
}
export function timeOverview(db, owner, now = new Date()) {
  const ws = weekStart(now), people = db.prepare("SELECT id,name,email,role,active,hourly_rate AS rate FROM client_accounts WHERE company_id=? AND role IN ('employee','seller') ORDER BY role DESC,name").all(owner.companyId);
  const rows = people.map(p => {
    const open = db.prepare('SELECT in_at AS inAt,in_lat AS lat,in_lng AS lng FROM crew_punches WHERE client_id=? AND out_at IS NULL ORDER BY id DESC LIMIT 1').get(p.id) || null;
    const last = db.prepare('SELECT in_lat,in_lng,out_lat,out_lng,in_at,out_at FROM crew_punches WHERE client_id=? ORDER BY id DESC LIMIT 1').get(p.id);
    const week = db.prepare('SELECT in_at,out_at FROM crew_punches WHERE client_id=? AND in_at>=?').all(p.id, ws).reduce((t, r) => t + hoursBetween(r.in_at, r.out_at || now.toISOString()), 0);
    const loc = open ? {lat: open.lat, lng: open.lng} : last ? {lat: last.out_lat ?? last.in_lat, lng: last.out_lng ?? last.in_lng} : null;
    return {id: p.id, name: p.name || p.email, email: p.email, role: p.role, active: !!p.active, rate: p.rate, clockedIn: !!open, since: open?.inAt || null, weekHours: round2(week), weekCost: round2(week * p.rate), location: loc && loc.lat != null ? loc : null};
  });
  const reports = db.prepare('SELECT f.id,f.note,f.lat,f.lng,f.created_at AS createdAt,a.name,a.email FROM field_reports f JOIN client_accounts a ON a.id=f.client_id WHERE f.company_id=? ORDER BY f.id DESC LIMIT 30').all(owner.companyId)
    .map(r => ({id: r.id, note: r.note, lat: r.lat, lng: r.lng, createdAt: r.createdAt, by: r.name || r.email, photos: db.prepare('SELECT id FROM field_report_photos WHERE report_id=? ORDER BY id').all(r.id).map(x => x.id)}));
  return {people: rows, reports, weekCost: round2(rows.reduce((t, r) => t + r.weekCost, 0)), weekHours: round2(rows.reduce((t, r) => t + r.weekHours, 0))};
}
export function setRate(db, owner, b) {
  const rate = Number(b.rate); if (!(rate >= 0 && rate <= 1000)) fail('Valor por hora inválido.');
  if (!db.prepare('UPDATE client_accounts SET hourly_rate=? WHERE id=? AND company_id=?').run(Math.round(rate * 100) / 100, Number(b.id), owner.companyId).changes) fail('Pessoa não encontrada.', 404);
  return {ok: true};
}
