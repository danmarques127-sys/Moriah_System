// Admin data for affiliated companies, trades, client accounts, coverage, freshness, usage and audit log.
import {audit, timestamp} from './db.mjs';
import {getSetting, setSetting, retentionStatus} from './retention.mjs';
import {validEmail} from './auth.mjs';

const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const fail = msg => { const e = new Error(msg); e.status = 400; throw e; };
export const monthKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit'}).format(d);
export const monthUsed = (db, companyId, month = monthKey()) => Number(db.prepare('SELECT COUNT(*) AS n FROM permit_seen WHERE company_id=? AND month=?').get(companyId, month).n);
const today = () => new Date().toISOString().slice(0, 10);

export function settingsOverview(db) {
  return {retention_months: Number(getSetting(db, 'retention_months')), stale_days: Number(getSetting(db, 'stale_days')), client_portal: getSetting(db, 'client_portal') === '1'};
}

export function freshness(db, sources, now = new Date()) {
  const staleDays = Number(getSetting(db, 'stale_days')) || 45;
  const last = new Map(db.prepare('SELECT source_id AS id,MAX(issued) AS lastPermit,COUNT(*) AS permits FROM permits GROUP BY source_id').all().map(r => [r.id, r]));
  const collected = new Map(db.prepare("SELECT source_id AS id,MAX(checked_at) AS at FROM coverage WHERE status IN ('complete','partial') GROUP BY source_id").all().map(r => [r.id, r.at]));
  const manual = new Map(db.prepare('SELECT source_id AS id,MAX(imported_at) AS at FROM manual_imports GROUP BY source_id').all().map(r => [r.id, r.at]));
  return sources.map(src => {
    const l = last.get(src.id), lastPermit = l?.lastPermit || null;
    const lastCollection = [collected.get(src.id), manual.get(src.id)].filter(Boolean).sort().at(-1) || null;
    const days = lastPermit ? Math.floor((now - new Date(lastPermit + 'T00:00:00Z')) / 86400000) : null;
    return {sourceId: src.id, city: src.city, state: src.state, permits: Number(l?.permits || 0), lastPermit, lastCollection, daysSincePermit: days, stale: days === null || days > staleDays};
  });
}

export function partnersOverview(db, sources) {
  const trades = db.prepare('SELECT id,name,active FROM trades ORDER BY name').all().map(t => ({...t, active: !!t.active}));
  const tradeLinks = db.prepare('SELECT company_id AS c,trade_id AS t FROM company_trades').all();
  const clients = db.prepare("SELECT id,company_id AS companyId,email,name,active,created_at AS createdAt,(password_hash<>'') AS hasPassword FROM client_accounts ORDER BY id").all();
  const cityLinks = db.prepare('SELECT client_id AS c,source_id AS s FROM client_cities').all();
  const companies = db.prepare('SELECT id,name,contact_name AS contactName,contact_email AS contactEmail,contact_phone AS contactPhone,active,joined_on AS joinedOn,max_cities AS maxCities,monthly_permits AS monthlyPermits FROM companies ORDER BY name').all().map(c => ({...c, active: !!c.active, usedThisMonth: monthUsed(db, c.id), tradeIds: tradeLinks.filter(l => l.c === c.id).map(l => l.t)}));
  const clientRows = clients.map(c => ({...c, active: !!c.active, hasPassword: !!c.hasPassword, cities: cityLinks.filter(l => l.c === c.id).map(l => l.s)}));
  const coverage = companies.map(c => {
    const cities = [...new Set(clientRows.filter(x => x.companyId === c.id && x.active).flatMap(x => x.cities))];
    return {companyId: c.id, name: c.name, active: c.active, trades: c.tradeIds.map(id => trades.find(t => t.id === id)?.name).filter(Boolean), cities};
  });
  const usage = companies.map(c => {
    const r = db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='seen' THEN permits END),0) AS seen,COALESCE(SUM(CASE WHEN kind='exported' THEN permits END),0) AS exported,MAX(created_at) AS lastAt FROM usage_events WHERE company_id=?").get(c.id);
    return {companyId: c.id, name: c.name, seen: Number(r.seen), exported: Number(r.exported), lastAt: r.lastAt};
  });
  const auditLog = db.prepare('SELECT id,created_at AS createdAt,actor,kind,event FROM audit ORDER BY id DESC LIMIT 300').all();
  return {trades, companies, clients: clientRows, coverage, usage, freshness: freshness(db, sources), retention: retentionStatus(db), settings: settingsOverview(db), audit: auditLog};
}

function ids(list) { return [...new Set((Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger))]; }

export function partnersAction(db, sources, actor, b) {
  const log = (event, kind = 'config') => audit(db, null, event, actor, kind);
  const op = String(b.op || '');
  if (op === 'saveCompany') {
    const name = clean(b.name, 120); if (!name) fail('Informe o nome da empresa.');
    const email = clean(b.contactEmail, 254); if (email && !validEmail(email)) fail('E-mail de contato inválido.');
    const maxCities = b.maxCities === undefined ? undefined : Math.floor(Number(b.maxCities)), monthly = b.monthlyPermits === undefined ? undefined : Math.floor(Number(b.monthlyPermits));
    if (maxCities !== undefined && !(maxCities >= 1 && maxCities <= 100)) fail('O limite de cidades deve ficar entre 1 e 100.');
    if (monthly !== undefined && !(monthly >= 10 && monthly <= 1000000)) fail('O limite mensal de permits deve ficar entre 10 e 1.000.000.');
    const vals = [name, clean(b.contactName, 120), email, clean(b.contactPhone, 40), b.active === false || b.active === '0' ? 0 : 1];
    let id = Number(b.id) || 0;
    try {
      if (id) { if (!db.prepare('SELECT 1 FROM companies WHERE id=?').get(id)) fail('Empresa não encontrada.'); db.prepare('UPDATE companies SET name=?,contact_name=?,contact_email=?,contact_phone=?,active=? WHERE id=?').run(...vals, id); }
      else id = Number(db.prepare('INSERT INTO companies(name,contact_name,contact_email,contact_phone,active,joined_on,created_at) VALUES(?,?,?,?,?,?,?)').run(...vals, clean(b.joinedOn, 10) || today(), timestamp()).lastInsertRowid);
    } catch (e) { if (/UNIQUE/.test(e.message)) fail('Já existe uma empresa com esse nome.'); throw e; }
    if (maxCities !== undefined) db.prepare('UPDATE companies SET max_cities=? WHERE id=?').run(maxCities, id);
    if (monthly !== undefined) db.prepare('UPDATE companies SET monthly_permits=? WHERE id=?').run(monthly, id);
    if (b.tradeIds !== undefined) {
      const valid = new Set(db.prepare('SELECT id FROM trades').all().map(r => r.id));
      db.prepare('DELETE FROM company_trades WHERE company_id=?').run(id);
      for (const t of ids(b.tradeIds).filter(t => valid.has(t))) db.prepare('INSERT INTO company_trades VALUES(?,?)').run(id, t);
    }
    log('Empresa afiliada salva: ' + name); return {id};
  }
  if (op === 'setCompanyActive') {
    const r = db.prepare('UPDATE companies SET active=? WHERE id=?').run(b.active ? 1 : 0, Number(b.id)); if (!r.changes) fail('Empresa não encontrada.');
    if (!b.active) db.prepare('UPDATE client_accounts SET active=0 WHERE company_id=?').run(Number(b.id));
    log('Empresa ' + (b.active ? 'ativada' : 'desativada') + ' #' + Number(b.id)); return {};
  }
  if (op === 'saveTrade') {
    const name = clean(b.name, 60); if (!name) fail('Informe o nome da especialidade.');
    try {
      if (b.id) { if (!db.prepare('UPDATE trades SET name=?,active=? WHERE id=?').run(name, b.active === false ? 0 : 1, Number(b.id)).changes) fail('Especialidade não encontrada.'); }
      else db.prepare('INSERT INTO trades(name) VALUES(?)').run(name);
    } catch (e) { if (/UNIQUE/.test(e.message)) fail('Essa especialidade já existe.'); throw e; }
    log('Especialidade salva: ' + name); return {};
  }
  if (op === 'saveClient') {
    const email = clean(b.email, 254).toLowerCase(); if (!validEmail(email)) fail('E-mail do cliente inválido.');
    const company = Number(b.companyId); if (!db.prepare('SELECT 1 FROM companies WHERE id=?').get(company)) fail('Escolha uma empresa afiliada.');
    const valid = new Set(sources.map(s => s.id)), cities = [...new Set((Array.isArray(b.cities) ? b.cities : []).map(String))].filter(c => valid.has(c));
    let id = Number(b.id) || 0;
    const limit = Number(db.prepare('SELECT max_cities AS m FROM companies WHERE id=?').get(company).m), others = db.prepare('SELECT DISTINCT cc.source_id AS s FROM client_cities cc JOIN client_accounts ca ON ca.id=cc.client_id WHERE ca.company_id=? AND ca.id<>?').all(company, id).map(r => r.s);
    const total = new Set([...others, ...cities]).size;
    if (total > limit) fail('Esta empresa pode ter no máximo ' + limit + ' cidade(s) (já somando as outras contas). Aumente o limite na empresa ou remova cidades.');
    try {
      if (id) { if (!db.prepare('UPDATE client_accounts SET company_id=?,email=?,name=? WHERE id=?').run(company, email, clean(b.name, 120), id).changes) fail('Conta não encontrada.'); }
      else id = Number(db.prepare('INSERT INTO client_accounts(company_id,email,name,active,created_at) VALUES(?,?,?,1,?)').run(company, email, clean(b.name, 120), timestamp()).lastInsertRowid);
    } catch (e) { if (/UNIQUE/.test(e.message)) fail('Já existe uma conta com esse e-mail.'); throw e; }
    db.prepare('DELETE FROM client_cities WHERE client_id=?').run(id);
    for (const c of cities) db.prepare('INSERT INTO client_cities VALUES(?,?)').run(id, c);
    log('Conta de cliente salva: ' + email); return {id};
  }
  if (op === 'setClientActive') {
    const row = db.prepare('SELECT email,company_id AS companyId FROM client_accounts WHERE id=?').get(Number(b.id)); if (!row) fail('Conta não encontrada.');
    if (b.active && !db.prepare('SELECT active FROM companies WHERE id=?').get(row.companyId)?.active) fail('A empresa está inativa. Ative a empresa primeiro.');
    db.prepare('UPDATE client_accounts SET active=? WHERE id=?').run(b.active ? 1 : 0, Number(b.id));
    log('Conta de cliente ' + (b.active ? 'ativada' : 'desativada') + ': ' + row.email); return {};
  }
  if (op === 'saveSettings') {
    const months = Math.floor(Number(b.retention_months)), stale = Math.floor(Number(b.stale_days));
    if (!(months >= 1 && months <= 120)) fail('Prazo de retenção deve ficar entre 1 e 120 meses.');
    if (!(stale >= 1 && stale <= 365)) fail('Limite de dias sem dados deve ficar entre 1 e 365.');
    const email = clean(b.alert_email, 200).toLowerCase(); if (email && !validEmail(email)) fail('E-mail de alerta inválido.');
    const before = settingsOverview(db);
    const portal = b.client_portal === true || b.client_portal === '1' || b.client_portal === 'on';
    setSetting(db, 'retention_months', months); setSetting(db, 'stale_days', stale); setSetting(db, 'client_portal', portal ? '1' : '0'); setSetting(db, 'alert_email', email); setSetting(db, 'alert_level', b.alert_level === 'all' ? 'all' : 'critical');
    log('Configurações alteradas: retenção ' + before.retention_months + '→' + months + ' meses, alerta ' + before.stale_days + '→' + stale + ' dias, portal de clientes ' + (before.client_portal ? 'ligado' : 'desligado') + '→' + (portal ? 'ligado' : 'desligado')); return {};
  }
  if (op === 'recordUsage') {
    if (!db.prepare('SELECT 1 FROM companies WHERE id=?').get(Number(b.companyId))) fail('Empresa não encontrada.');
    if (!['seen', 'exported'].includes(b.kind)) fail('Tipo de uso inválido.');
    db.prepare('INSERT INTO usage_events(company_id,kind,permits,created_at) VALUES(?,?,?,?)').run(Number(b.companyId), b.kind, Math.max(0, Math.floor(Number(b.permits)) || 0), timestamp()); return {};
  }
  fail('Operação inválida.');
}
