// Client channel: what an affiliated company's account may see. Strict rules:
//  - only the cities assigned to the account, only while account and company are active and the portal is switched on;
//  - NEVER any link to a municipal directory/portal, source id or source name: the product is the permit data;
//  - separate cookie and session table, so a client session cannot open any internal route.
import {createHash, randomBytes} from 'node:crypto';
import {digest, checkPassword} from './auth.mjs';
import {getSetting, cutoffDate} from './retention.mjs';
import {timestamp} from './db.mjs';
import {monthKey, monthUsed} from './partners.mjs';
import {tradeKind, groupProjects} from './radar.mjs';

// Trade classification by keywords in the permit type/description. A permit can match several trades; no match = Other.
const TRADE_WORDS = {Roofing: /roof|shingle/, Electrical: /electric|wiring|solar|photovoltaic|\bpv\b|generator|service upgrade/, Plumbing: /plumb|water heater|sewer|septic|backflow/, HVAC: /hvac|heat pump|furnace|boiler|mini[- ]?split|air condition|mechanical|ductwork|\bgas\b/, Insulation: /insulat/, Painting: /\bpaint/, Flooring: /\bfloor/, Framing: /\bfram|\bdeck\b|addition|structural|foundation|\bgarage\b/, Sheetrock: /sheetrock|drywall|gypsum/};
export function tradesOf(rec) {
  const t = [rec.type, rec.description].join(' ').toLowerCase(), hit = Object.keys(TRADE_WORDS).filter(k => TRADE_WORDS[k].test(t));
  return hit.length ? hit : ['Other'];
}

export const CLIENT_COOKIE = 'pf_client';
export const portalEnabled = db => getSetting(db, 'client_portal') === '1';
export const clientCookie = (token, secure = true, maxAge = 28800) => CLIENT_COOKIE + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (secure ? '; Secure' : '');

export async function clientLogin(db, email, password) {
  if (!portalEnabled(db)) return null;
  const row = db.prepare('SELECT c.id,c.password_hash FROM client_accounts c JOIN companies co ON co.id=c.company_id WHERE c.email=? AND c.active=1 AND co.active=1').get(String(email || '').toLowerCase());
  const ok = await checkPassword(password, row?.password_hash || ''); // same cost whether or not the account exists
  if (!row || !row.password_hash || !ok) return null;
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM client_sessions WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO client_sessions(token_hash,client_id,expires_at) VALUES(?,?,?)').run(digest(token), row.id, Date.now() + 8 * 3600000);
  return token;
}
export function getClientSession(db, req) {
  if (!portalEnabled(db)) return null;
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + CLIENT_COOKIE + '=([a-f0-9]{64})(?:;|$)'));
  if (!m) return null;
  const c = db.prepare('SELECT c.id,c.email,c.name,c.role,c.company_id AS companyId,co.name AS company,s.token_hash FROM client_sessions s JOIN client_accounts c ON c.id=s.client_id JOIN companies co ON co.id=c.company_id WHERE s.token_hash=? AND s.expires_at>? AND c.active=1 AND co.active=1').get(digest(m[1]), Date.now());
  return c || null;
}
export function clientCities(db, clientId, sources) {
  const ids = new Set(db.prepare('SELECT source_id AS s FROM client_cities WHERE client_id=?').all(clientId).map(r => r.s));
  return sources.filter(s => ids.has(s.id)).map(s => ({key: opaque(s.id), city: s.city, state: s.state, id: s.id}));
}
export const opaque = v => createHash('sha256').update('pf-client:' + v).digest('hex').slice(0, 16);
const stripLinks = text => String(text || '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/\s{2,}/g, ' ').trim();

// The only shape that leaves the server for a client.
export function clientPermit(rec) {
  return {key: opaque(rec.id), number: rec.number || '', issued: rec.issued, dateApprox: !!rec.dateApprox, city: rec.city, state: rec.state, address: rec.address || '', type: rec.type || '', value: rec.value || 0,
    description: stripLinks(rec.description), contractor: rec.contractor || '', owner: rec.applicant || '', status: String(rec.status || '').trim(), phone: rec.phone || '', email: rec.email || '', kind: tradeKind((rec.type || '') + ' ' + (rec.description || ''))};
}

export function clientPermits(db, client, query, sources) {
  const allowed = clientCities(db, client.id, sources), cutoff = cutoffDate(new Date(), Number(getSetting(db, 'retention_months')) || 12);
  let ids = allowed.map(c => c.id);
  const wanted = String(query.city || '').split(',').filter(Boolean).map(k => allowed.find(c => c.key === k)?.id).filter(Boolean);
  if (wanted.length) ids = wanted;
  if (query.state && ['MA', 'CT', 'RI'].includes(query.state)) ids = ids.filter(id => sources.find(s => s.id === id)?.state === query.state);
  const from = /^\d{4}-\d{2}$/.test(query.from || '') ? query.from + '-01' : cutoff, to = /^\d{4}-\d{2}$/.test(query.to || '') ? query.to + '-31' : '9999-12-31';
  if (!ids.length) return {total: 0, page: 1, pages: 1, cities: allowed.map(({id, ...c}) => c), trades: [], limits: emptyLimits(db, client, allowed.length), permits: []};
  const rows = db.prepare('SELECT data FROM permits WHERE source_id IN (' + ids.map(() => '?').join(',') + ') AND issued>=? AND issued>=? AND issued<=? ORDER BY issued DESC,id LIMIT 30001').all(...ids, cutoff, from, to);
  let list = rows.slice(0, 30000).map(r => JSON.parse(r.data));
  if (query.q) { const q = String(query.q).toLowerCase(); list = list.filter(r => [r.address, r.description, r.type, r.contractor, r.number].join(' ').toLowerCase().includes(q)); }
  const companyTrades = db.prepare('SELECT t.name FROM company_trades ct JOIN trades t ON t.id=ct.trade_id WHERE ct.company_id=? AND t.active=1 ORDER BY t.name').all(client.companyId).map(r => r.name);
  const allTrades = String(query.scope || '') === 'all';
  if (companyTrades.length && !allTrades) list = list.filter(r => tradesOf(r).some(t => companyTrades.includes(t)));
  const wantTrade = String(query.trade || '');
  if (wantTrade && !allTrades && (!companyTrades.length || companyTrades.includes(wantTrade))) list = list.filter(r => tradesOf(r).includes(wantTrade));
  // Same project classification as the master radar (New house, Gut renovation, ADU, ...), counted per project.
  const kindOf = new Map(), kinds = {};
  for (const g of groupProjects(list)) { kinds[g.kind] = (kinds[g.kind] || 0) + 1; for (const r of g.records) kindOf.set(r.id, g.kind); }
  const wantKind = String(query.kind || ''); if (wantKind && kinds[wantKind]) list = list.filter(r => kindOf.get(r.id) === wantKind);
  if (query.keys) { const ks = new Set(String(query.keys).split(',').filter(Boolean)); list = list.filter(r => ks.has(opaque(r.id))); }
  const favs = favoriteKeys(db, client);
  if (query.fav === '1') list = list.filter(r => favs.has(opaque(r.id)));
  const total = list.length, page = Math.max(1, Math.floor(Number(query.page)) || 1), exp = query.export === '1';
  const slice = exp ? list.slice(0, 5000) : list.slice((page - 1) * 50, page * 50);
  // Monthly allowance: each permit counts once per company per month.
  const month = monthKey(), co = db.prepare('SELECT max_cities AS maxCities,monthly_permits AS cap FROM companies WHERE id=?').get(client.companyId);
  const keyOf = r => opaque(r.id), seen = new Set(db.prepare('SELECT permit_key AS k FROM permit_seen WHERE company_id=? AND month=?').all(client.companyId, month).map(r => r.k));
  let left = Math.max(0, Number(co.cap) - seen.size);
  const visible = [], fresh = [];
  for (const r of slice) { const k = keyOf(r); if (seen.has(k)) visible.push(r); else if (left > 0) { left--; visible.push(r); fresh.push(k); } }
  for (const k of fresh) db.prepare('INSERT OR IGNORE INTO permit_seen VALUES(?,?,?)').run(client.companyId, month, k);
  const used = monthUsed(db, client.companyId, month);
  return {total, page, pages: Math.max(1, Math.ceil(total / 50)), cities: allowed.map(({id, ...c}) => c), trades: companyTrades, limits: {cities: allowed.length, maxCities: Number(co.maxCities), monthlyLimit: Number(co.cap), used, remaining: Math.max(0, Number(co.cap) - used), month, capped: visible.length < slice.length}, kinds, permits: visible.map(r => ({...clientPermit(r), kind: kindOf.get(r.id) || clientPermit(r).kind, fav: favs.has(opaque(r.id))})), role: client.role};
}
export function recordClientUsage(db, client, kind, permits) {
  if (permits > 0) db.prepare('INSERT INTO usage_events(company_id,kind,permits,created_at) VALUES(?,?,?,?)').run(client.companyId, kind, permits, timestamp());
}

function emptyLimits(db, client, cities) {
  const co = db.prepare('SELECT max_cities AS maxCities,monthly_permits AS cap FROM companies WHERE id=?').get(client.companyId), month = monthKey(), used = monthUsed(db, client.companyId, month);
  return {cities, maxCities: Number(co.maxCities), monthlyLimit: Number(co.cap), used, remaining: Math.max(0, Number(co.cap) - used), month, capped: false};
}

// ---------- Business roles: owner (everything), seller (permits of allowed cities, favorites, site visits), employee (time clock; later) ----------
export const EMPLOYEE_SPOTS = 5;
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
export const isOwner = c => c.role === 'owner';

export function permitByKey(db, client, key, sources) {
  const ids = clientCities(db, client.id, sources).map(c => c.id);
  if (!ids.length) return null;
  const rows = db.prepare('SELECT data FROM permits WHERE source_id IN (' + ids.map(() => '?').join(',') + ') LIMIT 30000').all(...ids);
  for (const r of rows) { const p = JSON.parse(r.data); if (opaque(p.id) === key) return p; }
  return null;
}
export function setFavorite(db, client, key, on) {
  if (!/^[a-f0-9]{16}$/.test(String(key))) fail('Permit inválido.');
  if (on) db.prepare('INSERT OR IGNORE INTO client_favorites VALUES(?,?,?)').run(client.id, key, timestamp());
  else db.prepare('DELETE FROM client_favorites WHERE client_id=? AND permit_key=?').run(client.id, key);
  return {ok: true};
}
export function favoriteKeys(db, client) { return new Set(db.prepare('SELECT permit_key AS k FROM client_favorites WHERE client_id=?').all(client.id).map(r => r.k)); }

const IMG = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
export function addVisit(db, client, sources, b) {
  if (client.role === 'employee') fail('Seu perfil não pode registrar visitas.', 403);
  const p = permitByKey(db, client, String(b.permitKey), sources); if (!p) fail('Permit fora das suas cidades.', 403);
  const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
  const notes = clean(b.notes, 4000), meas = clean(b.measurements, 4000), photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 6);
  if (!notes && !meas && !photos.length) fail('Informe medidas, observações ou fotos.');
  const parsed = photos.map(x => { const m = IMG.exec(String(x)); if (!m || m[2].length > 400000) fail('Foto inválida ou grande demais.'); return {mime: m[1], buf: Buffer.from(m[2], 'base64')}; });
  const id = Number(db.prepare('INSERT INTO site_visits(company_id,client_id,permit_key,address,notes,measurements,created_at) VALUES(?,?,?,?,?,?,?)').run(client.companyId, client.id, String(b.permitKey), clean(p.address, 200), notes, meas, timestamp()).lastInsertRowid);
  for (const ph of parsed) db.prepare('INSERT INTO site_photos(visit_id,mime,data) VALUES(?,?,?)').run(id, ph.mime, ph.buf);
  return {id};
}
// Owner sees every visit of the company; a seller only their own.
export function listVisits(db, client, key = '') {
  const where = ['v.company_id=?'], args = [client.companyId];
  if (!isOwner(client)) { where.push('v.client_id=?'); args.push(client.id); }
  if (key) { where.push('v.permit_key=?'); args.push(String(key)); }
  return db.prepare('SELECT v.id,v.permit_key AS permitKey,v.address,v.notes,v.measurements,v.created_at AS createdAt,c.name AS byName,c.email AS byEmail FROM site_visits v JOIN client_accounts c ON c.id=v.client_id WHERE ' + where.join(' AND ') + ' ORDER BY v.id DESC LIMIT 200').all(...args)
    .map(v => ({...v, photos: db.prepare('SELECT id FROM site_photos WHERE visit_id=? ORDER BY id').all(v.id).map(r => r.id)}));
}
export function photoFor(db, client, id) {
  const row = db.prepare('SELECT p.mime,p.data,v.company_id AS co,v.client_id AS cl FROM site_photos p JOIN site_visits v ON v.id=p.visit_id WHERE p.id=?').get(Number(id));
  if (!row || row.co !== client.companyId || (!isOwner(client) && row.cl !== client.id)) return null;
  return row;
}

// Team management by the business owner. Sellers get a subset of the owner's cities; employees take one of 5 spots.
export function listTeam(db, owner, sources) {
  const mineC = clientCities(db, owner.id, sources), keyOfId = new Map(mineC.map(c => [c.id, c.key]));
  const cities = new Map(); for (const r of db.prepare('SELECT client_id AS c,source_id AS s FROM client_cities WHERE client_id IN (SELECT id FROM client_accounts WHERE company_id=?)').all(owner.companyId)) (cities.get(r.c) || cities.set(r.c, []).get(r.c)).push(r.s);
  const members = db.prepare("SELECT id,email,name,role,active FROM client_accounts WHERE company_id=? AND role<>'owner' ORDER BY role,email").all(owner.companyId).map(m => ({...m, active: !!m.active, cities: (cities.get(m.id) || []).map(id => keyOfId.get(id)).filter(Boolean)}));
  return {members, cities: mineC.map(({id, ...c}) => c), spots: {employees: members.filter(m => m.role === 'employee' && m.active).length, max: EMPLOYEE_SPOTS}};
}
export async function saveTeamMember(db, owner, sources, b, hash) {
  const email = String(b.email || '').trim().toLowerCase(); if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail('E-mail inválido.');
  const role = b.role; if (!['seller', 'employee'].includes(role)) fail('Papel inválido.');
  const name = String(b.name || '').trim().slice(0, 120);
  const mine = new Map(clientCities(db, owner.id, sources).map(c => [c.key, c.id])), cities = role === 'seller' ? [...new Set((Array.isArray(b.cities) ? b.cities : []).map(String))].map(k => mine.get(k)).filter(Boolean) : [];
  let id = Number(b.id) || 0;
  if (id) { const row = db.prepare('SELECT role FROM client_accounts WHERE id=? AND company_id=?').get(id, owner.companyId); if (!row || row.role === 'owner') fail('Conta não encontrada.', 404); }
  if (role === 'employee') {
    const used = db.prepare("SELECT COUNT(*) n FROM client_accounts WHERE company_id=? AND role='employee' AND active=1 AND id<>?").get(owner.companyId, id).n;
    if (used >= EMPLOYEE_SPOTS) fail('Limite de ' + EMPLOYEE_SPOTS + ' funcionários atingido.');
  }
  try {
    if (id) db.prepare('UPDATE client_accounts SET email=?,name=?,role=? WHERE id=?').run(email, name, role, id);
    else {
      if (!b.password) fail('Defina uma senha inicial.');
      id = Number(db.prepare('INSERT INTO client_accounts(company_id,email,name,active,created_at,password_hash,role) VALUES(?,?,?,1,?,?,?)').run(owner.companyId, email, name, timestamp(), await hash(b.password), role).lastInsertRowid);
    }
  } catch (e) { if (/UNIQUE/.test(e.message)) fail('Já existe uma conta com esse e-mail.'); throw e; }
  db.prepare('DELETE FROM client_cities WHERE client_id=?').run(id);
  for (const c of cities) db.prepare('INSERT INTO client_cities VALUES(?,?)').run(id, c);
  return {id};
}
export async function teamAction(db, owner, b, hash) {
  const row = db.prepare('SELECT id,role FROM client_accounts WHERE id=? AND company_id=?').get(Number(b.id), owner.companyId);
  if (!row || row.role === 'owner') fail('Conta não encontrada.', 404);
  if (b.op === 'setActive') {
    if (b.active && row.role === 'employee' && db.prepare("SELECT COUNT(*) n FROM client_accounts WHERE company_id=? AND role='employee' AND active=1").get(owner.companyId).n >= EMPLOYEE_SPOTS) fail('Limite de ' + EMPLOYEE_SPOTS + ' funcionários atingido.');
    db.prepare('UPDATE client_accounts SET active=? WHERE id=?').run(b.active ? 1 : 0, row.id); if (!b.active) db.prepare('DELETE FROM client_sessions WHERE client_id=?').run(row.id);
  } else if (b.op === 'setPassword') {
    db.prepare('UPDATE client_accounts SET password_hash=? WHERE id=?').run(await hash(b.password), row.id); db.prepare('DELETE FROM client_sessions WHERE client_id=?').run(row.id);
  } else fail('Operação inválida.');
  return {ok: true};
}

// ---- Profile: personal details + photo for every account; company details + logo for the owner. ----
const IMGDATA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const img = (v, cur) => { if (v === undefined) return cur; const s = String(v || ''); if (s && (!IMGDATA.test(s) || s.length > 200000)) fail('A imagem deve ser PNG, JPEG ou WebP de até 150 KB.'); return s; };
export function getProfile(db, client) {
  const me = db.prepare('SELECT name,email,phone,title,photo,role FROM client_accounts WHERE id=?').get(client.id);
  const company = db.prepare('SELECT name,contact_name AS contactName,contact_email AS contactEmail,contact_phone AS contactPhone,address,website,logo FROM companies WHERE id=?').get(client.companyId);
  return {me, company, canEditCompany: isOwner(client)};
}
export async function saveProfile(db, client, b, hash) {
  if (b.op === 'password') {
    const row = db.prepare('SELECT password_hash FROM client_accounts WHERE id=?').get(client.id);
    if (!(await checkPassword(String(b.current || ''), row.password_hash))) fail('A senha atual está incorreta.');
    if (String(b.password || '').length < 16) fail('A nova senha precisa ter pelo menos 16 caracteres.');
    db.prepare('UPDATE client_accounts SET password_hash=? WHERE id=?').run(await hash(b.password), client.id);
    db.prepare('DELETE FROM client_sessions WHERE client_id=? AND token_hash<>?').run(client.id, client.token_hash);
    return {ok: true};
  }
  const cur = db.prepare('SELECT photo FROM client_accounts WHERE id=?').get(client.id);
  db.prepare('UPDATE client_accounts SET name=?,phone=?,title=?,photo=? WHERE id=?').run(txt(b.name, 120), txt(b.phone, 40), txt(b.title, 80), img(b.photo, cur.photo), client.id);
  if (b.company && isOwner(client)) {
    const c = b.company, old = db.prepare('SELECT logo,name FROM companies WHERE id=?').get(client.companyId);
    const name = txt(c.name, 120) || old.name, email = txt(c.contactEmail, 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('E-mail de contato inválido.');
    try { db.prepare('UPDATE companies SET name=?,contact_name=?,contact_email=?,contact_phone=?,address=?,website=?,logo=? WHERE id=?').run(name, txt(c.contactName, 120), email, txt(c.contactPhone, 40), txt(c.address, 200), txt(c.website, 200), img(c.logo, old.logo), client.companyId); }
    catch (e) { if (/UNIQUE/.test(e.message)) fail('Já existe uma empresa com esse nome.'); throw e; }
  }
  return getProfile(db, client);
}
