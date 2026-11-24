// Client channel: what an affiliated company's account may see. Strict rules:
//  - only the cities assigned to the account, only while account and company are active and the portal is switched on;
//  - NEVER any link to a municipal directory/portal, source id or source name: the product is the permit data;
//  - separate cookie and session table, so a client session cannot open any internal route.
import {createHash, randomBytes} from 'node:crypto';
import {digest, checkPassword} from './auth.mjs';
import {getSetting, cutoffDate} from './retention.mjs';
import {timestamp} from './db.mjs';
import {monthKey, monthUsed} from './partners.mjs';

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
  const c = db.prepare('SELECT c.id,c.email,c.name,c.company_id AS companyId,co.name AS company,s.token_hash FROM client_sessions s JOIN client_accounts c ON c.id=s.client_id JOIN companies co ON co.id=c.company_id WHERE s.token_hash=? AND s.expires_at>? AND c.active=1 AND co.active=1').get(digest(m[1]), Date.now());
  return c || null;
}
export function clientCities(db, clientId, sources) {
  const ids = new Set(db.prepare('SELECT source_id AS s FROM client_cities WHERE client_id=?').all(clientId).map(r => r.s));
  return sources.filter(s => ids.has(s.id)).map(s => ({key: opaque(s.id), city: s.city, state: s.state, id: s.id}));
}
const opaque = v => createHash('sha256').update('pf-client:' + v).digest('hex').slice(0, 16);
const stripLinks = text => String(text || '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/\s{2,}/g, ' ').trim();

// The only shape that leaves the server for a client.
export function clientPermit(rec) {
  return {key: opaque(rec.id), number: rec.number || '', issued: rec.issued, dateApprox: !!rec.dateApprox, city: rec.city, state: rec.state, address: rec.address || '', type: rec.type || '', value: rec.value || 0,
    description: stripLinks(rec.description), contractor: rec.contractor || '', owner: rec.applicant || ''};
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
  if (companyTrades.length) list = list.filter(r => tradesOf(r).some(t => companyTrades.includes(t)));
  const wantTrade = String(query.trade || '');
  if (wantTrade && (!companyTrades.length || companyTrades.includes(wantTrade))) list = list.filter(r => tradesOf(r).includes(wantTrade));
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
  return {total, page, pages: Math.max(1, Math.ceil(total / 50)), cities: allowed.map(({id, ...c}) => c), trades: companyTrades, limits: {cities: allowed.length, maxCities: Number(co.maxCities), monthlyLimit: Number(co.cap), used, remaining: Math.max(0, Number(co.cap) - used), month, capped: visible.length < slice.length}, permits: visible.map(clientPermit)};
}
export function recordClientUsage(db, client, kind, permits) {
  if (permits > 0) db.prepare('INSERT INTO usage_events(company_id,kind,permits,created_at) VALUES(?,?,?,?)').run(client.companyId, kind, permits, timestamp());
}

function emptyLimits(db, client, cities) {
  const co = db.prepare('SELECT max_cities AS maxCities,monthly_permits AS cap FROM companies WHERE id=?').get(client.companyId), month = monthKey(), used = monthUsed(db, client.companyId, month);
  return {cities, maxCities: Number(co.maxCities), monthlyLimit: Number(co.cap), used, remaining: Math.max(0, Number(co.cap) - used), month, capped: false};
}
