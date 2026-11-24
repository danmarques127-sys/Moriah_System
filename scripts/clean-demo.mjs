// Removes the demo BUSINESS data of the H&M Brothers Insulation test company (customers, jobs, expenses, invoices,
// crew punches/reports, estimates, DEMO- permits). Keeps the company, its accounts, cities and price list.
// Usage: npm run limpar-demo            (uses DATABASE_PATH or data/permit-finder-test.sqlite)
import {existsSync} from 'node:fs';
import {openDatabase} from '../src/db.mjs';
import {opaque} from '../src/client-api.mjs';

const path = process.env.DATABASE_PATH || 'data/permit-finder-test.sqlite';
if (!existsSync(path)) { console.log('Banco não encontrado em ' + path); process.exit(1); }
const db = openDatabase(path);
const co = db.prepare("SELECT id FROM companies WHERE name='H&M Brothers Insulation'").get()?.id;
const del = (label, sql, ...a) => { const n = db.prepare(sql).run(...a).changes; if (n) console.log('  removidos ' + n + ' ' + label); return n; };
let total = 0;
if (co) {
  const crew = "SELECT id FROM client_accounts WHERE company_id=? AND role='employee'";
  total += del('relatórios de campo', 'DELETE FROM field_reports WHERE company_id=?', co);
  total += del('registros de ponto', 'DELETE FROM crew_punches WHERE company_id=?', co);
  total += del('estimates', 'DELETE FROM estimate_requests WHERE company_id=?', co);
  total += del('invoices (com pagamentos)', 'DELETE FROM invoices WHERE company_id=?', co);
  total += del('despesas', 'DELETE FROM expenses WHERE company_id=?', co);
  total += del('jobs', 'DELETE FROM biz_jobs WHERE company_id=?', co);
  total += del('clientes do CRM', 'DELETE FROM customers WHERE company_id=?', co);
  total += del('contas de funcionários demo', "DELETE FROM client_accounts WHERE company_id=? AND email IN ('carlosmendeshm','anasouzahm')", co);
}
const keys = db.prepare("SELECT id FROM permits WHERE id LIKE '%:DEMO-%'").all().map(r => r.id);
if (keys.length) { for (const id of keys) total += del('favoritos de permits de exemplo', 'DELETE FROM client_favorites WHERE permit_key=?', opaque(id));
  total += del('permits de exemplo (DEMO-)', "DELETE FROM permits WHERE id LIKE '%:DEMO-%'"); }
console.log(total ? 'Limpeza concluída.' : 'Nada para limpar.');
