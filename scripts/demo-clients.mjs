// Demo business accounts for the isolated TEST database only (never loaded in production).
// Passwords here are public fixtures: the test server refuses to run in production.
import {randomBytes, scryptSync} from 'node:crypto';
import {seedDemoData} from './demo-data.mjs';

export const DEMO = {
  company: {name: 'H&M Brothers Insulation', contact: 'Homero Sampaio', trade: 'Insulation'},
  password: process.env.DEMO_PASSWORD || 'Ahesqueci1',
  accounts: [
    {user: 'homerosampaio', name: 'Homero Sampaio', role: 'owner'},
    {user: 'hmbrothersinsulation', name: 'H&M Brothers Insulation', role: 'owner'},
    {user: 'johnhmbrothersinsulation', name: 'John', role: 'seller'}
  ]
};

export function seedDemoClients(db, demo = DEMO) {
  const hash = () => { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(demo.password, salt, 64, {N: 32768, r: 8, p: 1, maxmem: 67108864}).toString('hex'); };
  const now = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('client_portal','1')").run();
  db.prepare('INSERT OR IGNORE INTO companies(name,contact_name,joined_on,created_at) VALUES(?,?,?,?)').run(demo.company.name, demo.company.contact, now.slice(0, 10), now);
  const co = db.prepare('SELECT id FROM companies WHERE name=?').get(demo.company.name).id;
  const trade = db.prepare('SELECT id FROM trades WHERE name=?').get(demo.company.trade);
  if (trade) db.prepare('INSERT OR IGNORE INTO company_trades VALUES(?,?)').run(co, trade.id);
  for (const a of demo.accounts) {
    db.prepare('INSERT OR IGNORE INTO client_accounts(company_id,email,name,active,created_at,role,password_hash) VALUES(?,?,?,1,?,?,?)').run(co, a.user, a.name, now, a.role, hash());
    db.prepare('UPDATE client_accounts SET password_hash=?,active=1 WHERE email=?').run(hash(), a.user);
    db.prepare('DELETE FROM client_sessions WHERE client_id=(SELECT id FROM client_accounts WHERE email=?)').run(a.user);
  }
  seedDemoData(db, co, {hash});
  return co;
}
