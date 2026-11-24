// Production readiness check: run before giving real clients access.  npm run readiness
// Read-only. Reads the PRODUCTION database (DATABASE_PATH or data/permit-finder.sqlite).
import {DEMO} from './demo-clients.mjs';
import {TEST_DEFAULT_PASSWORD} from './test-server.mjs';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {checkPassword} from '../src/auth.mjs';
import {mailConfig} from '../src/mailer.mjs';
import {alertEmail} from '../src/maintenance.mjs';

const path = process.env.DATABASE_PATH || 'data/permit-finder.sqlite';
const results = [], add = (ok, critical, label, fix = '') => results.push({ok, critical, label, fix});
if (!existsSync(path)) { console.log('Banco de produção não encontrado em ' + path + '. Rode o sistema uma vez (npm start) ou defina DATABASE_PATH.'); process.exit(1); }
const db = openDatabase(path);
const KNOWN = [TEST_DEFAULT_PASSWORD, DEMO.password, process.env.TEST_PASSWORD, 'password', '12345678', 'admin'].filter(Boolean);

// 1) known test passwords on any account
const accounts = [...db.prepare('SELECT email,password_hash FROM users').all().map(r => ({kind: 'admin', ...r})), ...db.prepare('SELECT email,password_hash FROM client_accounts').all().map(r => ({kind: 'cliente', ...r}))];
const weak = [];
for (const a of accounts) { if (!a.password_hash) continue; for (const pw of KNOWN) if (await checkPassword(pw, a.password_hash).catch(() => false)) { weak.push(a.kind + ' ' + a.email); break; } }
add(!weak.length, true, 'Nenhuma conta usa senha de teste conhecida', weak.length ? 'Troque a senha destas contas: ' + weak.join(', ') : '');
// 2) demo company/accounts still present
const demo = db.prepare("SELECT COUNT(*) n FROM companies WHERE name=?").get(DEMO.company.name).n + db.prepare("SELECT COUNT(*) n FROM permits WHERE id LIKE '%:DEMO-%'").get().n;
add(!demo, false, 'Sem dados de demonstração (empresa demo, permits DEMO-)', demo ? 'Desative a empresa demo em Partners e apague os permits DEMO-.' : '');
// 3) e-mail
add(!!mailConfig(), true, 'E-mail SMTP configurado (estimates, invoices e alertas)', 'Defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e SMTP_FROM.');
add(!!alertEmail(db), true, 'E-mail de alertas definido', 'Em Partners > Settings, preencha "E-mail for alerts".');
// 4) backups
const dir = join(dirname(path), 'backups'), files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.sqlite')) : [];
const newest = files.map(f => statSync(join(dir, f)).mtimeMs).sort((a, b) => b - a)[0];
const age = newest ? (Date.now() - newest) / 3600000 : Infinity;
add(age < 48, true, 'Backup recente (menos de 48 h)', files.length ? 'Último backup há ' + Math.round(age) + ' h. Rode: npm run backup -- backups/manual.sqlite' : 'Nenhum backup encontrado em ' + dir + '. Rode: npm run backup -- backups/manual.sqlite');
// 5) environment
add(process.env.NODE_ENV === 'production' || process.env.PRODUCTION === '1', true, 'Servidor em modo produção (cookies Secure)', 'Rode com NODE_ENV=production atrás de HTTPS.');
add(!process.env.TEST_PASSWORD && !process.env.DEMO_PASSWORD, true, 'Variáveis TEST_PASSWORD/DEMO_PASSWORD ausentes', 'Remova estas variáveis do ambiente de produção.');
add(db.prepare("SELECT value FROM app_settings WHERE key='client_portal'").get()?.value === '1', false, 'Portal do cliente ligado (só quando for abrir para clientes)', 'Partners > Settings > Client channel enabled.');
// 6) at least one real client, passwords of 16+ chars cannot be verified (hashed): remind
add(true, false, 'Senhas novas: mínimo 16 caracteres (o sistema já exige)');

let fails = 0;
for (const r of results) { console.log((r.ok ? '[OK]  ' : r.critical ? '[FALTA]' : '[AVISO]') + ' ' + r.label + (r.ok || !r.fix ? '' : '\n        -> ' + r.fix)); if (!r.ok && r.critical) fails++; }
console.log('\n' + (fails ? fails + ' item(ns) críticos pendentes. NÃO abra para clientes reais ainda.' : 'Tudo crítico OK.'));
process.exit(fails ? 1 : 0);
