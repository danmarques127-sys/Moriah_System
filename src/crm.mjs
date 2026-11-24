// CRM for the owner: customers/leads, notes and a timeline built from estimates, invoices and jobs. Scoped to the owner's company.
import {timestamp} from './db.mjs';

const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const mailOk = e => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);
export const STATUSES = ['lead', 'quoted', 'active', 'past'];
const round2 = v => Math.round(v * 100) / 100;
const invTotal = i => { const items = JSON.parse(i.items || '[]'); const sub = items.reduce((t, x) => t + x.qty * x.price, 0); return round2(sub + sub * Number(i.tax_rate) / 100); };

// called when an estimate is sent: the prospect becomes (or stays) a customer record
export function touchCustomerFromEstimate(db, companyId, {name, email, address}) {
  const mail = clean(email, 254).toLowerCase(); if (!mail) return null; const ts = timestamp();
  const cur = db.prepare('SELECT id,status FROM customers WHERE company_id=? AND lower(email)=?').get(companyId, mail);
  if (cur) { if (cur.status === 'lead') db.prepare("UPDATE customers SET status='quoted',updated_at=? WHERE id=?").run(ts, cur.id); return cur.id; }
  return Number(db.prepare("INSERT INTO customers(company_id,name,email,address,status,source,created_at,updated_at) VALUES(?,?,?,?,'quoted','Estimate',?,?)").run(companyId, clean(name, 120) || 'Prospect', mail, clean(address, 200), ts, ts).lastInsertRowid);
}
export function listCustomers(db, owner, {q = '', status = ''} = {}) {
  const w = ['c.company_id=?'], a = [owner.companyId];
  if (STATUSES.includes(status)) { w.push('c.status=?'); a.push(status); }
  if (q) { w.push("(lower(c.name) LIKE ? OR lower(c.email) LIKE ? OR c.phone LIKE ? OR lower(c.address) LIKE ?)"); const like = '%' + String(q).toLowerCase().slice(0, 60) + '%'; a.push(like, like, '%' + String(q).slice(0, 30) + '%', like); }
  const rows = db.prepare('SELECT c.* FROM customers c WHERE ' + w.join(' AND ') + ' ORDER BY c.updated_at DESC LIMIT 300').all(...a);
  const customers = rows.map(c => {
    const invs = db.prepare("SELECT items,tax_rate,id,status FROM invoices WHERE customer_id=? AND status<>'void'").all(c.id), sent = invs.filter(i => i.status === 'sent');
    const paid = sent.reduce((t, i) => t + (db.prepare('SELECT COALESCE(SUM(amount),0) s FROM invoice_payments WHERE invoice_id=?').get(i.id).s), 0), billed = sent.reduce((t, i) => t + invTotal(i), 0);
    return {id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address, status: c.status, source: c.source, notes: c.notes, updatedAt: c.updated_at, billed: round2(billed), balance: round2(billed - paid), jobs: db.prepare('SELECT COUNT(*) n FROM biz_jobs WHERE customer_id=?').get(c.id).n};
  });
  const counts = Object.fromEntries(STATUSES.map(s => [s, db.prepare('SELECT COUNT(*) n FROM customers WHERE company_id=? AND status=?').get(owner.companyId, s).n]));
  return {customers, counts, statuses: STATUSES};
}
export function customerDetail(db, owner, id) {
  const c = db.prepare('SELECT * FROM customers WHERE id=? AND company_id=?').get(Number(id), owner.companyId); if (!c) fail('Cliente não encontrado.', 404);
  const tl = [];
  for (const n of db.prepare('SELECT text,by_name,created_at FROM customer_notes WHERE customer_id=?').all(c.id)) tl.push({at: n.created_at, kind: 'note', text: n.text, by: n.by_name});
  if (c.email) for (const e of db.prepare("SELECT address,status,total,updated_at FROM estimate_requests WHERE company_id=? AND lower(prospect_email)=? AND status<>'draft'").all(owner.companyId, c.email.toLowerCase())) tl.push({at: e.updated_at, kind: 'estimate', text: 'Estimate for ' + e.address + ' (' + e.status.replace('_', ' ') + ')', amount: e.total});
  for (const i of db.prepare('SELECT number,status,items,tax_rate,created_at FROM invoices WHERE customer_id=?').all(c.id)) tl.push({at: i.created_at, kind: 'invoice', text: 'Invoice ' + i.number + ' (' + i.status + ')', amount: invTotal(i)});
  for (const j of db.prepare('SELECT name,status,contract_amount,created_at FROM biz_jobs WHERE customer_id=?').all(c.id)) tl.push({at: j.created_at, kind: 'job', text: 'Job: ' + j.name + ' (' + j.status + ')', amount: j.contract_amount});
  tl.push({at: c.created_at, kind: 'created', text: 'Added' + (c.source ? ' from ' + c.source : '')});
  return {customer: {id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address, status: c.status, source: c.source, notes: c.notes}, timeline: tl.sort((a, b) => String(b.at).localeCompare(String(a.at)))};
}
export function customerAction(db, owner, b, by = '') {
  const ts = timestamp();
  if (b.op === 'save') {
    const name = clean(b.name, 120); if (!name) fail('Informe o nome.'); const email = clean(b.email, 254).toLowerCase(); if (email && !mailOk(email)) fail('E-mail inválido.');
    const status = STATUSES.includes(b.status) ? b.status : 'lead', v = [name, email, clean(b.phone, 40), clean(b.address, 200), status, clean(b.source, 60), clean(b.notes, 2000)];
    if (b.id) { if (!db.prepare('UPDATE customers SET name=?,email=?,phone=?,address=?,status=?,source=?,notes=?,updated_at=? WHERE id=? AND company_id=?').run(...v, ts, Number(b.id), owner.companyId).changes) fail('Cliente não encontrado.', 404); return {id: Number(b.id)}; }
    return {id: Number(db.prepare('INSERT INTO customers(company_id,name,email,phone,address,status,source,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(owner.companyId, ...v, ts, ts).lastInsertRowid)};
  }
  if (b.op === 'note') {
    const c = db.prepare('SELECT id FROM customers WHERE id=? AND company_id=?').get(Number(b.id), owner.companyId); if (!c) fail('Cliente não encontrado.', 404);
    const text = clean(b.text, 2000); if (!text) fail('Escreva a nota.');
    db.prepare('INSERT INTO customer_notes(customer_id,text,by_name,created_at) VALUES(?,?,?,?)').run(c.id, text, by, ts); db.prepare('UPDATE customers SET updated_at=? WHERE id=?').run(ts, c.id); return {ok: true};
  }
  if (b.op === 'delete') { db.prepare('DELETE FROM customers WHERE id=? AND company_id=?').run(Number(b.id), owner.companyId); return {ok: true}; }
  fail('Operação inválida.');
}
