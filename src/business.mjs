// Seller/owner workspace: lists, notes, follow-ups and the estimate request flow (seller -> owner -> customer).
import {timestamp} from './db.mjs';
import {permitByKey, isOwner, clientPermit, opaque} from './client-api.mjs';
import {sendMail, mailConfig} from './mailer.mjs';

const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const KEY = /^[a-f0-9]{16}$/;
const mail = e => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);

// ---- lists (Favorites is built in: client_favorites) ----
export function listLists(db, client) {
  const fav = db.prepare('SELECT COUNT(*) n FROM client_favorites WHERE client_id=?').get(client.id).n;
  const rows = db.prepare('SELECT l.id,l.name,(SELECT COUNT(*) FROM client_list_items i WHERE i.list_id=l.id) AS count FROM client_lists l WHERE l.client_id=? ORDER BY l.id').all(client.id);
  return {lists: [{id: 'fav', name: 'Favorites', count: fav, builtin: true}, ...rows.map(r => ({...r, count: Number(r.count)}))]};
}
export function listAction(db, client, b) {
  if (b.op === 'create') { const name = clean(b.name, 60); if (!name) fail('Informe o nome da lista.'); return {id: Number(db.prepare('INSERT INTO client_lists(client_id,name,created_at) VALUES(?,?,?)').run(client.id, name, timestamp()).lastInsertRowid)}; }
  const l = db.prepare('SELECT id FROM client_lists WHERE id=? AND client_id=?').get(Number(b.id ?? b.listId), client.id); if (!l) fail('Lista não encontrada.', 404);
  if (b.op === 'delete') { db.prepare('DELETE FROM client_lists WHERE id=?').run(l.id); return {ok: true}; }
  if (b.op === 'item') { if (!KEY.test(String(b.permitKey))) fail('Permit inválido.'); if (b.on) db.prepare('INSERT OR IGNORE INTO client_list_items VALUES(?,?)').run(l.id, b.permitKey); else db.prepare('DELETE FROM client_list_items WHERE list_id=? AND permit_key=?').run(l.id, b.permitKey); return {ok: true}; }
  fail('Operação inválida.');
}
export function listKeys(db, client, id) {
  if (id === 'fav') return db.prepare('SELECT permit_key AS k FROM client_favorites WHERE client_id=?').all(client.id).map(r => r.k);
  const l = db.prepare('SELECT id FROM client_lists WHERE id=? AND client_id=?').get(Number(id), client.id); if (!l) fail('Lista não encontrada.', 404);
  return db.prepare('SELECT permit_key AS k FROM client_list_items WHERE list_id=?').all(l.id).map(r => r.k);
}

// ---- permit detail: note, lists, follow-ups ----
export function permitDetail(db, client, sources, key) {
  const p = permitByKey(db, client, String(key), sources); if (!p) fail('Permit fora das suas cidades.', 403);
  const note = db.prepare('SELECT note FROM client_notes WHERE client_id=? AND permit_key=?').get(client.id, key)?.note || '';
  const lists = db.prepare('SELECT list_id AS id FROM client_list_items WHERE permit_key=? AND list_id IN (SELECT id FROM client_lists WHERE client_id=?)').all(key, client.id).map(r => r.id);
  const fav = !!db.prepare('SELECT 1 FROM client_favorites WHERE client_id=? AND permit_key=?').get(client.id, key);
  const next = db.prepare("SELECT due_at AS dueAt FROM followups WHERE client_id=? AND permit_key=? AND done_at='' ORDER BY due_at LIMIT 1").get(client.id, key)?.dueAt || '';
  return {permit: {...clientPermit(p), fav}, note, lists, nextFollowup: next};
}
export function saveNote(db, client, b) {
  if (!KEY.test(String(b.permitKey))) fail('Permit inválido.');
  db.prepare('INSERT INTO client_notes VALUES(?,?,?,?) ON CONFLICT(client_id,permit_key) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at').run(client.id, b.permitKey, clean(b.note, 2000), timestamp()); return {ok: true};
}

// ---- follow-ups ----
const FKINDS = ['call', 'email', 'meeting', 'task'];
export function listFollowups(db, client, nowIso = new Date().toISOString()) {
  const rows = db.prepare('SELECT id,permit_key AS permitKey,address,task,kind,due_at AS dueAt,notes,done_at AS doneAt FROM followups WHERE client_id=? ORDER BY due_at').all(client.id);
  const today = nowIso.slice(0, 10);
  return {today, followups: rows.map(r => ({...r, bucket: r.doneAt ? 'completed' : r.dueAt.slice(0, 10) < today ? 'overdue' : r.dueAt.slice(0, 10) === today ? 'today' : 'upcoming'}))};
}
export function followupAction(db, client, b) {
  if (b.op === 'save') {
    const task = clean(b.task, 160); if (!task) fail('Informe a tarefa.');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.dueAt))) fail('Data e hora inválidas.');
    const kind = FKINDS.includes(b.kind) ? b.kind : 'task', key = KEY.test(String(b.permitKey || '')) ? b.permitKey : '', notes = clean(b.notes, 1000), address = clean(b.address, 200);
    if (b.id) { if (!db.prepare('UPDATE followups SET task=?,kind=?,due_at=?,notes=? WHERE id=? AND client_id=?').run(task, kind, b.dueAt, notes, Number(b.id), client.id).changes) fail('Follow-up não encontrado.', 404); return {id: Number(b.id)}; }
    return {id: Number(db.prepare('INSERT INTO followups(company_id,client_id,permit_key,address,task,kind,due_at,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(client.companyId, client.id, key, address, task, kind, b.dueAt, notes, timestamp()).lastInsertRowid)};
  }
  const id = Number(b.id);
  if (b.op === 'complete') { db.prepare('UPDATE followups SET done_at=? WHERE id=? AND client_id=?').run(b.undo ? '' : timestamp(), id, client.id); return {ok: true}; }
  if (b.op === 'delete') { db.prepare('DELETE FROM followups WHERE id=? AND client_id=?').run(id, client.id); return {ok: true}; }
  fail('Operação inválida.');
}

// ---- estimate requests ----
const STATUS = ['draft', 'with_owner', 'changes_requested', 'review_requested', 'approved', 'sent'];
const event = (db, id, kind, text, by) => db.prepare('INSERT INTO estimate_events(request_id,kind,text,by_name,created_at) VALUES(?,?,?,?,?)').run(id, kind, clean(text, 1000), by, timestamp());
const who = c => c.name || c.email;
const shape = (db, r) => ({id: r.id, permitKey: r.permit_key, address: r.address, city: r.city, state: r.state, prospectName: r.prospect_name, prospectEmail: r.prospect_email, scope: r.scope, measurements: r.measurements, status: r.status, ownerNote: r.owner_note, sellerFeedback: r.seller_feedback, description: r.description, total: Number(r.total), createdAt: r.created_at, updatedAt: r.updated_at, sentAt: r.sent_at, by: r.byName || '',
  events: db.prepare('SELECT kind,text,by_name AS byName,created_at AS createdAt FROM estimate_events WHERE request_id=? ORDER BY id').all(r.id)});
export function listEstimates(db, client) {
  const where = ['r.company_id=?'], args = [client.companyId];
  if (!isOwner(client)) { where.push('r.client_id=?'); args.push(client.id); } else where.push("r.status<>'draft'");
  return {estimates: db.prepare('SELECT r.*,COALESCE(NULLIF(c.name,\'\'),c.email) AS byName FROM estimate_requests r JOIN client_accounts c ON c.id=r.client_id WHERE ' + where.join(' AND ') + ' ORDER BY r.updated_at DESC LIMIT 200').all(...args).map(r => shape(db, r))};
}
function mine(db, client, id) {
  const r = db.prepare('SELECT * FROM estimate_requests WHERE id=? AND company_id=?').get(Number(id), client.companyId);
  if (!r || (!isOwner(client) && r.client_id !== client.id)) fail('Pedido não encontrado.', 404);
  return r;
}
export async function estimateAction(db, client, sources, b, {send = sendMail, config = mailConfig()} = {}) {
  const now = timestamp();
  if (b.op === 'save') { // seller (or owner) creates/edits a request; submit=true sends it to the owner
    if (client.role === 'employee') fail('Seu perfil não pode pedir estimates.', 403);
    const p = b.id ? null : permitByKey(db, client, String(b.permitKey), sources);
    if (!b.id && !p) fail('Permit fora das suas cidades.', 403);
    const email = clean(b.prospectEmail, 254).toLowerCase(); if (email && !mail(email)) fail('E-mail do cliente inválido.');
    const f = [clean(b.prospectName, 120), email, clean(b.scope, 4000), clean(b.measurements, 2000)];
    if (b.submit && (!f[0] || !email)) fail('Informe nome e e-mail do cliente para enviar ao owner.');
    let id = Number(b.id) || 0;
    if (id) { const r = mine(db, client, id); if (!['draft', 'changes_requested', 'with_owner'].includes(r.status)) fail('Este pedido não pode mais ser editado.'); db.prepare('UPDATE estimate_requests SET prospect_name=?,prospect_email=?,scope=?,measurements=?,updated_at=? WHERE id=?').run(...f, now, id); }
    else id = Number(db.prepare('INSERT INTO estimate_requests(company_id,client_id,permit_key,address,city,state,prospect_name,prospect_email,scope,measurements,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(client.companyId, client.id, b.permitKey, clean(p.address, 200), clean(p.city, 80), clean(p.state, 2), ...f, 'draft', now, now).lastInsertRowid);
    if (b.submit) { db.prepare("UPDATE estimate_requests SET status='with_owner',updated_at=? WHERE id=?").run(now, id); event(db, id, 'submitted', 'Request submitted to the owner', who(client)); }
    return {id};
  }
  const r = mine(db, client, b.id);
  if (b.op === 'feedback') { // seller reviews what the owner prepared
    if (r.status !== 'review_requested') fail('Este pedido não está em revisão.');
    const approve = !!b.approve, text = clean(b.text, 2000);
    if (!approve && !text) fail('Descreva as mudanças pedidas.');
    db.prepare('UPDATE estimate_requests SET status=?,seller_feedback=?,updated_at=? WHERE id=?').run(approve ? 'approved' : 'changes_requested', text, now, r.id);
    event(db, r.id, approve ? 'approved' : 'changes', text || 'Approved for the owner to send', who(client)); return {ok: true};
  }
  if (!isOwner(client)) fail('Somente o owner prepara e envia estimates.', 403);
  if (b.op === 'prepare') {
    const total = Number(b.total); if (!(total >= 0 && total <= 10000000)) fail('Valor inválido.');
    db.prepare('UPDATE estimate_requests SET total=?,description=?,owner_note=?,updated_at=? WHERE id=?').run(total, clean(b.description, 4000), clean(b.ownerNote, 1000), now, r.id);
    if (b.requestReview) { db.prepare("UPDATE estimate_requests SET status='review_requested' WHERE id=?").run(r.id); event(db, r.id, 'review', clean(b.ownerNote, 1000) || 'Review requested by the owner', who(client)); }
    else event(db, r.id, 'prepared', 'Estimate prepared', who(client));
    return {ok: true};
  }
  if (b.op === 'send') {
    if (r.status === 'sent') fail('Este estimate já foi enviado.');
    if (!(r.total > 0) || !r.prospect_email) fail('Defina o valor e o e-mail do cliente antes de enviar.');
    const seller = db.prepare('SELECT email,name FROM client_accounts WHERE id=?').get(r.client_id);
    const text = ['Hello ' + (r.prospect_name || '') + ',', '', 'Here is your estimate from ' + (b.companyName || 'our team') + ' for ' + r.address + ', ' + r.city + ', ' + r.state + '.', '', r.description || r.scope, '', 'Total: $' + Number(r.total).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}), '', 'Reply to this e-mail if you have any questions.'].join('\n');
    const subject = 'Estimate for ' + r.address;
    const res = await send({to: r.prospect_email, subject, text}, config);
    if (!res.sent) fail('Não foi possível enviar: ' + res.reason);
    if (seller?.email) await send({to: seller.email, subject: '[Copy] ' + subject, text}, config).catch(() => {});
    db.prepare("UPDATE estimate_requests SET status='sent',sent_at=?,updated_at=? WHERE id=?").run(now, now, r.id); event(db, r.id, 'sent', 'Sent to ' + r.prospect_email + ' and the salesperson', who(client)); return {ok: true};
  }
  fail('Operação inválida.');
}
