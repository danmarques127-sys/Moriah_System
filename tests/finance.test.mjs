import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {partnersAction} from '../src/partners.mjs';
import {invoiceAction, listInvoices, jobAction, listJobs, overview} from '../src/finance.mjs';

function setup() {
  const db = openDatabase(':memory:');
  const mk = n => { const co = partnersAction(db, [], 't', {op: 'saveCompany', name: n}).id; const o = partnersAction(db, [], 't', {op: 'saveClient', email: n + '@a.co', companyId: co}).id; return {id: o, companyId: co, role: 'owner'}; };
  return {db, a: mk('A'), b: mk('B')};
}
const sent = []; const send = async m => { sent.push(m); return {sent: true}; };
const cfg = {host: 'x'};
const items = [{description: 'Attic insulation', qty: 2, price: 500}, {description: 'Baffles', qty: 10, price: 20}];

test('invoice lifecycle: draft, send with PDF, record partial then full payment, receipt', async () => {
  const {db, a} = setup(), now = '2026-11-24';
  const {id} = await invoiceAction(db, a, {op: 'save', toName: 'Sam', toEmail: 'sam@x.co', items, taxRate: 6.25, dueOn: '2026-12-01'}, {now});
  await assert.rejects(invoiceAction(db, a, {op: 'payment', id, amount: 10}, {now}), /Envie/);
  await invoiceAction(db, a, {op: 'send', id}, {send, config: cfg, now});
  assert.match(sent[0].subject, /INV-0001/); assert.equal(sent[0].attachments[0].mime, 'application/pdf'); assert.ok(sent[0].attachments[0].data.length > 200);
  let inv = listInvoices(db, a, now).invoices[0]; assert.equal(inv.total, 1275); assert.equal(inv.status, 'sent'); assert.equal(inv.balance, 1275);
  await assert.rejects(invoiceAction(db, a, {op: 'payment', id, amount: 5000}, {now}), /saldo/);
  await invoiceAction(db, a, {op: 'payment', id, amount: 275, method: 'Zelle', paidOn: now}, {now});
  inv = listInvoices(db, a, now).invoices[0]; assert.equal(inv.status, 'partial'); assert.equal(inv.balance, 1000);
  await invoiceAction(db, a, {op: 'receipt', id}, {send, config: cfg, now}); assert.match(sent.at(-1).subject, /receipt/i);
  await invoiceAction(db, a, {op: 'payment', id, amount: 1000, method: 'Check'}, {now});
  inv = listInvoices(db, a, now).invoices[0]; assert.equal(inv.status, 'paid'); assert.equal(inv.balance, 0);
  await assert.rejects(invoiceAction(db, a, {op: 'void', id}, {now}), /pagamentos/);
});
test('a failed e-mail leaves the invoice as draft; overdue is flagged; companies are isolated', async () => {
  const {db, a, b} = setup(), now = '2026-11-24';
  const {id} = await invoiceAction(db, a, {op: 'save', toName: 'Sam', toEmail: 'sam@x.co', items, dueOn: '2026-11-01'}, {now});
  await assert.rejects(invoiceAction(db, a, {op: 'send', id}, {send: async () => ({sent: false, reason: 'smtp down'}), config: cfg, now}), /smtp down/);
  assert.equal(listInvoices(db, a, now).invoices[0].status, 'draft');
  await invoiceAction(db, a, {op: 'send', id}, {send, config: cfg, now});
  assert.equal(listInvoices(db, a, now).invoices[0].overdue, true); assert.equal(listInvoices(db, a, now).totals.overdue, 1200);
  assert.equal(listInvoices(db, b, now).invoices.length, 0);
  await assert.rejects(invoiceAction(db, b, {op: 'send', id}, {send, config: cfg, now}), /não encontrada/);
  await assert.rejects(invoiceAction(db, b, {op: 'save', items, jobId: 999}, {now}), /Referência/);
});
test('jobs: financials from invoices, payments and expenses; estimate converts once; overview totals', async () => {
  const {db, a} = setup(), now = '2026-11-24';
  const {id: job} = jobAction(db, a, {op: 'save', name: 'Smith attic', contract: 5000, status: 'active'}, now);
  const {id} = await invoiceAction(db, a, {op: 'save', toName: 'Smith', toEmail: 's@x.co', items: [{description: 'Work', qty: 1, price: 2000}], jobId: job}, {now});
  await invoiceAction(db, a, {op: 'send', id}, {send, config: cfg, now}); await invoiceAction(db, a, {op: 'payment', id, amount: 1500, paidOn: now}, {now});
  jobAction(db, a, {op: 'expense', jobId: job, amount: 600, category: 'Materials', spentOn: now}, now); jobAction(db, a, {op: 'expense', amount: 100, category: 'Fuel', spentOn: now}, now);
  const j = listJobs(db, a).jobs[0]; assert.equal(j.invoiced, 2000); assert.equal(j.received, 1500); assert.equal(j.spent, 600); assert.equal(j.profit, 1400); assert.equal(j.cash, 900); assert.equal(j.margin, 70);
  const o = overview(db, a, new Date('2026-11-24T15:00:00Z'));
  assert.equal(o.cash.received, 1500); assert.equal(o.cash.spent, 700); assert.equal(o.cash.balance, 800); assert.equal(o.cash.outstanding, 500); assert.equal(o.flow.at(-1).in, 1500); assert.equal(o.jobs.active, 1);
  const cl = db.prepare("INSERT INTO client_accounts(company_id,email,name,created_at) VALUES(?,?,?,?)").run(a.companyId, 'sl@a.co', 'S', 'x').lastInsertRowid;
  const est = db.prepare("INSERT INTO estimate_requests(company_id,client_id,permit_key,address,prospect_name,prospect_email,status,total,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(a.companyId, cl, 'k', '9 Elm', 'Pat', 'pat@x.co', 'sent', 3200, 'x', 'x').lastInsertRowid;
  const j1 = jobAction(db, a, {op: 'fromEstimate', estimateId: est}, now), j2 = jobAction(db, a, {op: 'fromEstimate', estimateId: est}, now);
  assert.equal(j1.id, j2.id); assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n, 1); assert.equal(listJobs(db, a).jobs.find(x => x.id === j1.id).contract, 3200);
});
