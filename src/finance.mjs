// Owner finance: jobs, expenses, invoices (record + send, no payment processing) and the overview. Always scoped to the owner's company.
import {timestamp} from './db.mjs';
import {sendMail, mailConfig} from './mailer.mjs';
import {invoicePdf} from './pdf.mjs';
import {monthKey, monthUsed} from './partners.mjs';

const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const round2 = v => Math.round(v * 100) / 100;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v));
const today = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'America/New_York'});
const mailOk = e => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);
export const EXPENSE_CATEGORIES = ['Materials', 'Labor', 'Subcontractor', 'Equipment', 'Fuel', 'Permits', 'Other'];
export const PAY_METHODS = ['Check', 'Cash', 'Zelle', 'Card', 'ACH', 'Other'];

function parseItems(raw) {
  const items = (Array.isArray(raw) ? raw : []).slice(0, 60).map(i => ({description: clean(i?.description, 300), qty: Number(i?.qty), price: Number(i?.price)})).filter(i => i.description || i.price);
  for (const i of items) { if (!i.description) fail('Cada item precisa de descrição.'); if (!(i.qty > 0 && i.qty <= 100000)) fail('Quantidade inválida.'); if (!(i.price >= 0 && i.price <= 10000000)) fail('Preço inválido.'); }
  return items;
}
const sums = (items, rate) => { const subtotal = round2(items.reduce((t, i) => t + i.qty * i.price, 0)), tax = round2(subtotal * rate / 100); return {subtotal, tax, total: round2(subtotal + tax)}; };

// ---------- invoices ----------
function shapeInvoice(db, r, now = today()) {
  const items = JSON.parse(r.items || '[]'), t = sums(items, Number(r.tax_rate)), payments = db.prepare('SELECT id,amount,method,paid_on AS paidOn,note FROM invoice_payments WHERE invoice_id=? ORDER BY paid_on,id').all(r.id);
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0)), balance = round2(t.total - paid);
  let status = r.status; if (r.status === 'sent') status = t.total > 0 && balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'sent';
  const overdue = (status === 'sent' || status === 'partial') && r.due_on && r.due_on < now;
  return {id: r.id, number: r.number, customerId: r.customer_id, jobId: r.job_id, jobName: r.job_name || '', toName: r.to_name, toEmail: r.to_email, items, taxRate: Number(r.tax_rate), ...t, paid, balance, payments, status, overdue: !!overdue, issuedOn: r.issued_on, dueOn: r.due_on, notes: r.notes, sentAt: r.sent_at};
}
const INV_SQL = 'SELECT i.*,j.name AS job_name FROM invoices i LEFT JOIN biz_jobs j ON j.id=i.job_id';
export function listInvoices(db, owner, now = today()) {
  const invoices = db.prepare(INV_SQL + ' WHERE i.company_id=? ORDER BY i.id DESC LIMIT 300').all(owner.companyId).map(r => shapeInvoice(db, r, now));
  const open = invoices.filter(i => ['sent', 'partial'].includes(i.status));
  return {invoices, totals: {outstanding: round2(open.reduce((s, i) => s + i.balance, 0)), overdue: round2(open.filter(i => i.overdue).reduce((s, i) => s + i.balance, 0)), paid: round2(invoices.reduce((s, i) => s + i.paid, 0))}, methods: PAY_METHODS};
}
const mineInv = (db, owner, id) => { const r = db.prepare(INV_SQL + ' WHERE i.id=? AND i.company_id=?').get(Number(id), owner.companyId); if (!r) fail('Invoice não encontrada.', 404); return r; };
function ownedRef(db, table, id, owner) { if (id == null || id === '' || Number(id) === 0) return null; if (!db.prepare('SELECT 1 FROM ' + table + ' WHERE id=? AND company_id=?').get(Number(id), owner.companyId)) fail('Referência inválida.'); return Number(id); }
export async function invoiceAction(db, owner, b, {send = sendMail, config = mailConfig(), now = today()} = {}) {
  const ts = timestamp();
  if (b.op === 'save') {
    const items = parseItems(b.items), rate = Number(b.taxRate || 0), email = clean(b.toEmail, 254);
    if (!(rate >= 0 && rate <= 30)) fail('Taxa inválida.'); if (email && !mailOk(email)) fail('E-mail do cliente inválido.');
    const issued = isDate(b.issuedOn) ? b.issuedOn : now, due = b.dueOn && isDate(b.dueOn) ? b.dueOn : '';
    const customerId = ownedRef(db, 'customers', b.customerId, owner), jobId = ownedRef(db, 'biz_jobs', b.jobId, owner);
    if (b.id) {
      const r = mineInv(db, owner, b.id); if (r.status !== 'draft') fail('Só rascunhos podem ser editados.');
      db.prepare('UPDATE invoices SET customer_id=?,job_id=?,to_name=?,to_email=?,items=?,tax_rate=?,issued_on=?,due_on=?,notes=? WHERE id=?').run(customerId, jobId, clean(b.toName, 120), email, JSON.stringify(items), rate, issued, due, clean(b.notes, 1500), r.id);
      return {id: r.id};
    }
    const n = Number(db.prepare("SELECT COUNT(*) n FROM invoices WHERE company_id=?").get(owner.companyId).n) + 1;
    let number = 'INV-' + String(n).padStart(4, '0'); while (db.prepare('SELECT 1 FROM invoices WHERE company_id=? AND number=?').get(owner.companyId, number)) number = 'INV-' + String(Number(number.slice(4)) + 1).padStart(4, '0');
    return {id: Number(db.prepare('INSERT INTO invoices(company_id,number,customer_id,job_id,to_name,to_email,items,tax_rate,issued_on,due_on,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(owner.companyId, number, customerId, jobId, clean(b.toName, 120), email, JSON.stringify(items), rate, issued, due, clean(b.notes, 1500), ts).lastInsertRowid)};
  }
  const r = mineInv(db, owner, b.id), inv = shapeInvoice(db, r, now);
  if (b.op === 'delete') { if (r.status !== 'draft') fail('Só rascunhos podem ser excluídos. Use "Void".'); db.prepare('DELETE FROM invoices WHERE id=?').run(r.id); return {ok: true}; }
  if (b.op === 'void') { if (inv.paid > 0) fail('Há pagamentos registrados nesta invoice.'); db.prepare("UPDATE invoices SET status='void' WHERE id=?").run(r.id); return {ok: true}; }
  if (b.op === 'payment') {
    if (!['sent'].includes(r.status)) fail('Envie a invoice antes de registrar pagamentos.');
    const amount = round2(Number(b.amount)); if (!(amount > 0) || amount > inv.balance + 0.005) fail('O valor deve ser maior que zero e no máximo o saldo (' + inv.balance + ').');
    const method = PAY_METHODS.includes(b.method) ? b.method : 'Other';
    db.prepare('INSERT INTO invoice_payments(invoice_id,amount,method,paid_on,note,created_at) VALUES(?,?,?,?,?,?)').run(r.id, amount, method, isDate(b.paidOn) ? b.paidOn : now, clean(b.note, 300), ts);
    return {ok: true};
  }
  if (b.op === 'removePayment') { db.prepare('DELETE FROM invoice_payments WHERE id=? AND invoice_id=?').run(Number(b.paymentId), r.id); return {ok: true}; }
  if (b.op === 'send' || b.op === 'receipt') {
    const company = db.prepare('SELECT name FROM companies WHERE id=?').get(owner.companyId).name, fmt = v => '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (!inv.toEmail) fail('Defina o e-mail do cliente.');
    if (b.op === 'send') {
      if (r.status !== 'draft' && r.status !== 'sent') fail('Esta invoice não pode ser enviada.'); if (!(inv.total > 0)) fail('Adicione itens antes de enviar.');
      const text = ['Hello ' + inv.toName + ',', '', 'Here is invoice ' + inv.number + ' from ' + company + (inv.jobName ? ' for ' + inv.jobName : '') + '. A PDF copy is attached.', '', 'Total: ' + fmt(inv.total), 'Amount due: ' + fmt(inv.balance), inv.dueOn ? 'Due date: ' + inv.dueOn : '', '', 'Thank you for your business.'].filter(x => x !== null).join('\n');
      const res = await send({to: inv.toEmail, subject: 'Invoice ' + inv.number + ' from ' + company, text, attachments: [{filename: inv.number + '.pdf', mime: 'application/pdf', data: invoicePdf(inv, company)}]}, config);
      if (!res.sent) fail('Não foi possível enviar: ' + res.reason);
      db.prepare("UPDATE invoices SET status='sent',sent_at=COALESCE(sent_at,?) WHERE id=?").run(ts, r.id); return {ok: true};
    }
    if (!inv.payments.length) fail('Registre um pagamento antes de enviar o comprovante.');
    const last = inv.payments.at(-1), text = ['Hello ' + inv.toName + ',', '', 'We received your payment of ' + fmt(last.amount) + ' (' + last.method + ') on ' + last.paidOn + ' for invoice ' + inv.number + '.', 'Total paid: ' + fmt(inv.paid), 'Remaining balance: ' + fmt(inv.balance), '', 'Thank you!', company].join('\n');
    const res = await send({to: inv.toEmail, subject: 'Payment receipt - invoice ' + inv.number, text, attachments: [{filename: 'Receipt-' + inv.number + '.pdf', mime: 'application/pdf', data: invoicePdf(inv, company, {receipt: true})}]}, config);
    if (!res.sent) fail('Não foi possível enviar: ' + res.reason); return {ok: true};
  }
  fail('Operação inválida.');
}

// ---------- jobs & expenses ----------
export function listJobs(db, owner) {
  const jobs = db.prepare('SELECT j.*,c.name AS customer_name FROM biz_jobs j LEFT JOIN customers c ON c.id=j.customer_id WHERE j.company_id=? ORDER BY CASE j.status WHEN \'active\' THEN 0 WHEN \'planned\' THEN 1 ELSE 2 END,j.id DESC').all(owner.companyId).map(j => {
    const invs = db.prepare(INV_SQL + " WHERE i.job_id=? AND i.status<>'void'").all(j.id).map(r => shapeInvoice(db, r)).filter(i => i.status !== 'draft');
    const invoiced = round2(invs.reduce((s, i) => s + i.total, 0)), received = round2(invs.reduce((s, i) => s + i.paid, 0));
    const expenses = db.prepare('SELECT id,category,amount,spent_on AS spentOn,vendor,note FROM expenses WHERE job_id=? ORDER BY spent_on DESC,id DESC').all(j.id), spent = round2(expenses.reduce((s, e) => s + e.amount, 0));
    return {id: j.id, name: j.name, address: j.address, status: j.status, customerId: j.customer_id, customerName: j.customer_name || '', estimateId: j.estimate_id, contract: j.contract_amount, startDate: j.start_date, endDate: j.end_date, invoiced, received, spent, profit: round2(invoiced - spent), cash: round2(received - spent), margin: invoiced > 0 ? round2((invoiced - spent) / invoiced * 100) : 0, expenses};
  });
  return {jobs, categories: EXPENSE_CATEGORIES};
}
export function jobAction(db, owner, b, now = today()) {
  const ts = timestamp();
  if (b.op === 'save') {
    const name = clean(b.name, 120); if (!name) fail('Informe o nome do job.');
    const status = ['planned', 'active', 'done'].includes(b.status) ? b.status : 'planned', contract = Math.max(0, Number(b.contract) || 0), customerId = ownedRef(db, 'customers', b.customerId, owner);
    const dates = [b.startDate, b.endDate].map(d => d && isDate(d) ? d : '');
    if (b.id) { if (!db.prepare('UPDATE biz_jobs SET name=?,address=?,status=?,contract_amount=?,customer_id=?,start_date=?,end_date=? WHERE id=? AND company_id=?').run(name, clean(b.address, 200), status, contract, customerId, dates[0], dates[1], Number(b.id), owner.companyId).changes) fail('Job não encontrado.', 404); return {id: Number(b.id)}; }
    return {id: Number(db.prepare('INSERT INTO biz_jobs(company_id,customer_id,name,address,status,contract_amount,start_date,end_date,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(owner.companyId, customerId, name, clean(b.address, 200), status, contract, dates[0], dates[1], ts).lastInsertRowid)};
  }
  if (b.op === 'fromEstimate') {
    const e = db.prepare('SELECT * FROM estimate_requests WHERE id=? AND company_id=?').get(Number(b.estimateId), owner.companyId); if (!e) fail('Estimate não encontrado.', 404);
    const dup = db.prepare('SELECT id FROM biz_jobs WHERE company_id=? AND estimate_id=?').get(owner.companyId, e.id); if (dup) return {id: dup.id};
    let cust = e.prospect_email ? db.prepare('SELECT id FROM customers WHERE company_id=? AND lower(email)=?').get(owner.companyId, e.prospect_email.toLowerCase()) : null;
    if (!cust) cust = {id: Number(db.prepare("INSERT INTO customers(company_id,name,email,address,status,source,created_at,updated_at) VALUES(?,?,?,?,'active','Estimate',?,?)").run(owner.companyId, e.prospect_name || 'Customer', e.prospect_email, e.address, ts, ts).lastInsertRowid)};
    else db.prepare("UPDATE customers SET status='active',updated_at=? WHERE id=?").run(ts, cust.id);
    const items = JSON.parse(e.line_items || '[]'), t = items.length ? sums(items, Number(e.tax_rate || 0)).total : Number(e.total || 0);
    return {id: Number(db.prepare("INSERT INTO biz_jobs(company_id,customer_id,estimate_id,name,address,status,contract_amount,created_at) VALUES(?,?,?,?,?,'planned',?,?)").run(owner.companyId, cust.id, e.id, (e.address || 'Job') + (e.prospect_name ? ' · ' + e.prospect_name : ''), [e.address, e.city, e.state].filter(Boolean).join(', '), t, ts).lastInsertRowid)};
  }
  if (b.op === 'expense') {
    const amount = round2(Number(b.amount)); if (!(amount > 0 && amount <= 10000000)) fail('Valor inválido.');
    const jobId = ownedRef(db, 'biz_jobs', b.jobId, owner), cat = EXPENSE_CATEGORIES.includes(b.category) ? b.category : 'Other';
    return {id: Number(db.prepare('INSERT INTO expenses(company_id,job_id,category,amount,spent_on,vendor,note,created_at) VALUES(?,?,?,?,?,?,?,?)').run(owner.companyId, jobId, cat, amount, isDate(b.spentOn) ? b.spentOn : now, clean(b.vendor, 120), clean(b.note, 300), ts).lastInsertRowid)};
  }
  if (b.op === 'delExpense') { db.prepare('DELETE FROM expenses WHERE id=? AND company_id=?').run(Number(b.id), owner.companyId); return {ok: true}; }
  if (b.op === 'delete') { db.prepare('DELETE FROM biz_jobs WHERE id=? AND company_id=?').run(Number(b.id), owner.companyId); return {ok: true}; }
  fail('Operação inválida.');
}

// ---------- overview ----------
export function overview(db, owner, now = new Date()) {
  const co = owner.companyId, d = today(), mk = monthKey(now), months = [];
  for (let i = 5; i >= 0; i--) { const x = new Date(now); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - i); months.push(x.toISOString().slice(0, 7)); }
  const invoices = db.prepare(INV_SQL + " WHERE i.company_id=? AND i.status<>'void'").all(co).map(r => shapeInvoice(db, r, d)).filter(i => i.status !== 'draft');
  const open = invoices.filter(i => i.balance > 0), payments = db.prepare('SELECT p.amount,p.paid_on FROM invoice_payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.company_id=?').all(co), exp = db.prepare('SELECT amount,spent_on FROM expenses WHERE company_id=?').all(co);
  const flow = months.map(m => ({month: m, in: round2(payments.filter(p => p.paid_on.startsWith(m)).reduce((s, p) => s + p.amount, 0)), out: round2(exp.filter(e => e.spent_on.startsWith(m)).reduce((s, e) => s + e.amount, 0))}));
  const est = Object.fromEntries(db.prepare("SELECT status,COUNT(*) n FROM estimate_requests WHERE company_id=? AND status<>'draft' GROUP BY status").all(co).map(r => [r.status, r.n]));
  const jobs = listJobs(db, owner).jobs, ws = new Date(now); ws.setUTCHours(0, 0, 0, 0); ws.setUTCDate(ws.getUTCDate() - ((ws.getUTCDay() + 6) % 7));
  const company = db.prepare('SELECT max_cities AS maxCities,monthly_permits AS monthlyPermits FROM companies WHERE id=?').get(co);
  const received = round2(payments.reduce((s, p) => s + p.amount, 0)), spent = round2(exp.reduce((s, e) => s + e.amount, 0));
  return {
    cash: {balance: round2(received - spent), received, spent, outstanding: round2(open.reduce((s, i) => s + i.balance, 0)), overdue: round2(open.filter(i => i.overdue).reduce((s, i) => s + i.balance, 0)), overdueCount: open.filter(i => i.overdue).length},
    flow, estimates: {with_owner: est.with_owner || 0, review_requested: est.review_requested || 0, changes_requested: est.changes_requested || 0, approved: est.approved || 0, sent: est.sent || 0},
    jobs: {active: jobs.filter(j => j.status === 'active').length, planned: jobs.filter(j => j.status === 'planned').length, top: jobs.filter(j => j.invoiced > 0 || j.spent > 0).sort((a, b) => b.profit - a.profit).slice(0, 5).map(j => ({id: j.id, name: j.name, invoiced: j.invoiced, spent: j.spent, profit: j.profit, margin: j.margin}))},
    crew: {onClock: db.prepare("SELECT COUNT(DISTINCT p.client_id) n FROM crew_punches p WHERE p.company_id=? AND p.out_at IS NULL").get(co).n, weekHours: round2(db.prepare('SELECT in_at,out_at FROM crew_punches WHERE company_id=? AND in_at>=?').all(co, ws.toISOString()).reduce((t, r) => t + Math.max(0, (new Date(r.out_at || now) - new Date(r.in_at)) / 3600000), 0))},
    permits: {used: monthUsed(db, co), limit: company.monthlyPermits, maxCities: company.maxCities}, customers: {total: db.prepare('SELECT COUNT(*) n FROM customers WHERE company_id=?').get(co).n, leads: db.prepare("SELECT COUNT(*) n FROM customers WHERE company_id=? AND status IN ('lead','quoted')").get(co).n}
  };
}
