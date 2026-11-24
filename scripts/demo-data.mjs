// Demo business data for the H&M Brothers Insulation test company (TEST database only; never loaded in production).
// Idempotent: does nothing when the company already has customers. Dates are relative to "now".
import {opaque} from '../src/client-api.mjs';

const day = (n, base = new Date()) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const iso = (n, h, m = 0, base = new Date()) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); d.setUTCHours(h, m, 0, 0); return d.toISOString(); };

export function seedDemoData(db, companyId, {hash, base = new Date()}) {
  if (db.prepare('SELECT 1 FROM customers WHERE company_id=? LIMIT 1').get(companyId)) return false;
  const now = base.toISOString(), q = (sql, ...a) => db.prepare(sql).run(...a), id = r => Number(r.lastInsertRowid);
  // cities (company limit is 3): owners see all, the seller a subset
  const owners = db.prepare("SELECT id FROM client_accounts WHERE company_id=? AND role='owner'").all(companyId), seller = db.prepare("SELECT id FROM client_accounts WHERE company_id=? AND role='seller'").get(companyId);
  for (const o of owners) for (const c of ['brookline', 'cambridge', 'newton']) q('INSERT OR IGNORE INTO client_cities VALUES(?,?)', o.id, c);
  if (seller) for (const c of ['brookline', 'newton']) q('INSERT OR IGNORE INTO client_cities VALUES(?,?)', seller.id, c);
  const owner = owners[0]?.id;
  // crew
  const crew = [['carlosmendeshm', 'Carlos Mendes', 28], ['anasouzahm', 'Ana Souza', 26]].map(([user, name, rate]) => {
    q("INSERT OR IGNORE INTO client_accounts(company_id,email,name,active,created_at,role,password_hash,hourly_rate) VALUES(?,?,?,1,?,'employee',?,?)", companyId, user, name, now, hash(), rate);
    return db.prepare('SELECT id FROM client_accounts WHERE email=?').get(user).id;
  });
  crew.forEach((cid, k) => {
    for (let d = -4; d <= -1; d++) q('INSERT INTO crew_punches(company_id,client_id,in_at,out_at,in_lat,in_lng,out_lat,out_lng) VALUES(?,?,?,?,?,?,?,?)', companyId, cid, iso(d, 12, 30 + k * 10, base), iso(d, 21, 5 + k * 10, base), 42.1015 + d * 0.003, -72.5898 + k * 0.004, 42.1015 + d * 0.003, -72.5898 + k * 0.004);
  });
  q('INSERT INTO crew_punches(company_id,client_id,in_at,in_lat,in_lng) VALUES(?,?,?,?,?)', companyId, crew[1], new Date(base.getTime() - 3 * 3600000).toISOString(), 42.3398, -71.1465);
  q('INSERT INTO field_reports(company_id,client_id,note,lat,lng,created_at) VALUES(?,?,?,?,?,?)', companyId, crew[0], 'Attic at Oak St is done. Need 12 more baffles and 20 bags of cellulose for tomorrow.', 42.1015, -72.5898, iso(-1, 20, 40, base));
  q('INSERT INTO field_reports(company_id,client_id,note,lat,lng,created_at) VALUES(?,?,?,?,?,?)', companyId, crew[1], 'Found knob-and-tube wiring in the Brookline basement. Stopped before spraying. Need the owner to decide.', 42.3398, -71.1465, new Date(base.getTime() - 1.5 * 3600000).toISOString());
  // sample permits for the assigned cities when the test database has none (clearly marked DEMO-, no municipal links)
  const SAMPLE = [['Install attic insulation and air sealing', 'Building Permit', 12000], ['Spray foam insulation in basement rim joists', 'Building Permit', 9800], ['Blown-in cellulose insulation for exterior walls', 'Building Permit', 14200], ['Weatherization: insulation upgrade and air sealing', 'Building Permit', 8600], ['Re-roof with insulation and ventilation upgrade', 'Building Permit', 18500], ['Addition: framing, insulation and drywall', 'Building Permit', 46000]];
  const CITY = {brookline: ['Brookline', ['12 Main St', '88 Beacon St', '5 Walnut Ave', '203 Harvard St', '41 Cypress Rd', '17 Winchester St']], cambridge: ['Cambridge', ['9 Hill St', '30 Garden St', '112 Broadway', '4 Linnaean St', '77 Oak Ave', '21 Pearl St']], newton: ['Newton', ['9 Elm Rd', '150 Centre St', '36 Maple Ave', '12 Lake Ave', '60 Walnut St', '8 Church St']]};
  for (const [src, [city, addrs]] of Object.entries(CITY)) {
    if (db.prepare('SELECT COUNT(*) n FROM permits WHERE source_id=?').get(src).n >= 5) continue;
    addrs.forEach((address, k) => { const [description, type, value] = SAMPLE[k], pid = src + ':DEMO-' + (100 + k), d = {id: pid, address, number: 'DEMO-' + (100 + k), issued: day(-2 - k * 4, base), description, type, status: 'Issued', contractor: k % 2 ? 'Northeast Home Pros' : 'Bay State Builders', applicant: '', value, city, state: 'MA', sourceUrl: ''};
      q('INSERT OR IGNORE INTO permits(id,source_id,issued,project_key,data,first_seen,updated_at) VALUES(?,?,?,?,?,?,?)', pid, src, d.issued, pid, JSON.stringify(d), now, now); });
  }
  // customers
  const cust = Object.fromEntries([['pat', 'Pat Lee', 'pat.lee@example.com', '413-555-0142', '48 Oak St, Springfield, MA', 'active', 'Referral'], ['maria', 'Maria Gomez', 'maria.gomez@example.com', '617-555-0177', '12 Main St, Brookline, MA', 'quoted', 'Permit'], ['dan', 'Dan Whitfield', 'dan.w@example.com', '617-555-0199', '9 Elm Rd, Newton, MA', 'lead', 'Website'], ['sue', 'Sue Park', 'sue.park@example.com', '508-555-0111', '31 Maple Ave, Worcester, MA', 'past', 'Referral'], ['ben', 'Ben Carter', 'ben.carter@example.com', '617-555-0123', '77 Hill St, Cambridge, MA', 'lead', 'Permit']]
    .map(([k, n, e, p, a, s, src]) => [k, id(q('INSERT INTO customers(company_id,name,email,phone,address,status,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', companyId, n, e, p, a, s, src, iso(-20, 15, 0, base), iso(-2, 15, 0, base)))]));
  q('INSERT INTO customer_notes(customer_id,text,by_name,created_at) VALUES(?,?,?,?)', cust.maria, 'Wants spray foam in the basement rim joists. Call back Friday.', 'Homero Sampaio', iso(-3, 16, 0, base));
  q('INSERT INTO customer_notes(customer_id,text,by_name,created_at) VALUES(?,?,?,?)', cust.dan, 'Asked about rebates (Mass Save). Sent info.', 'Homero Sampaio', iso(-1, 14, 0, base));
  // jobs
  const job = Object.fromEntries([['oak', 'Oak St attic insulation', '48 Oak St, Springfield, MA', 'active', 'pat', 6800, -12], ['brk', 'Brookline basement spray foam', '12 Main St, Brookline, MA', 'planned', 'maria', 4200, 5], ['maple', 'Maple Ave wall batts', '31 Maple Ave, Worcester, MA', 'done', 'sue', 2900, -45]]
    .map(([k, n, a, s, c, amt, off]) => [k, id(q('INSERT INTO biz_jobs(company_id,customer_id,name,address,status,contract_amount,start_date,created_at) VALUES(?,?,?,?,?,?,?,?)', companyId, cust[c], n, a, s, amt, day(off, base), iso(off - 3, 15, 0, base)))]));
  // invoices (sent ones are marked sent without e-mailing: demo only)
  const inv = (num, c, j, name, email, items, tax, status, issued, due, sent) => id(q('INSERT INTO invoices(company_id,number,customer_id,job_id,to_name,to_email,items,tax_rate,status,issued_on,due_on,notes,sent_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', companyId, num, c, j, name, email, JSON.stringify(items), tax, status, issued, due, '', sent ? iso(-1, 15, 0, base) : null, iso(-1, 15, 0, base)));
  const pay = (i, amount, method, on) => q('INSERT INTO invoice_payments(invoice_id,amount,method,paid_on,note,created_at) VALUES(?,?,?,?,?,?)', i, amount, method, on, '', now);
  const oak = [{description: 'Blown-in attic insulation R-38 (sq ft)', qty: 1400, price: 2.1}, {description: 'Air sealing (hour)', qty: 6, price: 95}, {description: 'Attic baffles (each)', qty: 24, price: 12}];
  const i1 = inv('INV-0001', cust.pat, job.oak, 'Pat Lee', 'pat.lee@example.com', oak, 0, 'sent', day(-10, base), day(-3, base), true); pay(i1, 3800, 'Check', day(-8, base));
  const i2 = inv('INV-0002', cust.pat, job.oak, 'Pat Lee', 'pat.lee@example.com', [{description: 'Second phase: knee walls and access hatch', qty: 1, price: 3000}], 0, 'sent', day(-9, base), day(-2, base), true); pay(i2, 1000, 'Zelle', day(-5, base));
  const i3 = inv('INV-0003', cust.sue, job.maple, 'Sue Park', 'sue.park@example.com', [{description: 'Fiberglass batts R-19 walls (sq ft)', qty: 1700, price: 1.6}], 6.25, 'sent', day(-44, base), day(-30, base), true); pay(i3, 2890.5, 'Check', day(-35, base));
  inv('INV-0004', cust.maria, job.brk, 'Maria Gomez', 'maria.gomez@example.com', [{description: 'Deposit (30%) Brookline basement spray foam', qty: 1, price: 1260}], 0, 'draft', day(0, base), day(14, base), false);
  // expenses
  for (const [j, cat, amt, vendor, off] of [['oak', 'Materials', 1180, 'Home Depot Pro', -11], ['oak', 'Materials', 420, 'Insulation supply', -7], ['oak', 'Labor', 1560, 'Crew (Carlos + Ana)', -6], ['oak', 'Fuel', 85, 'Shell', -10], ['maple', 'Materials', 1190, 'Lowe\'s', -42], ['maple', 'Labor', 880, 'Crew', -40], [null, 'Equipment', 640, 'Blower rental', -15], ['brk', 'Permits', 120, 'City of Brookline', -2]])
    q('INSERT INTO expenses(company_id,job_id,category,amount,spent_on,vendor,note,created_at) VALUES(?,?,?,?,?,?,?,?)', companyId, j ? job[j] : null, cat, amt, day(off, base), vendor, '', now);
  // estimates by the seller on real Brookline permits
  if (seller) {
    const permits = db.prepare("SELECT id,data FROM permits WHERE source_id='brookline' ORDER BY issued DESC LIMIT 3").all();
    const sts = [['with_owner', 'Dan Whitfield', 'dan.w@example.com', 0, []], ['review_requested', 'Maria Gomez', 'maria.gomez@example.com', 6.25, [{description: 'Closed-cell spray foam 2" rim joists (sq ft)', qty: 320, price: 3.25}, {description: 'Air sealing (hour)', qty: 4, price: 95}]], ['sent', 'Ben Carter', 'ben.carter@example.com', 6.25, [{description: 'Blown-in attic insulation R-38 (sq ft)', qty: 900, price: 2.1}]]];
    permits.forEach((p, k) => { const d = JSON.parse(p.data), [st, name, email, tax, items] = sts[k] || sts[0]; q('INSERT INTO estimate_requests(company_id,client_id,permit_key,address,city,state,prospect_name,prospect_email,scope,measurements,status,description,total,created_at,updated_at,sent_at,line_items,internal_cost,tax_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', companyId, seller.id, opaque(p.id), d.address || '', 'Brookline', 'MA', name, email, 'Insulation scope from the site visit.', 'Attic ~900 sq ft', st, '', items.reduce((t, i) => t + i.qty * i.price, 0) * (1 + tax / 100), iso(-3 - k, 15, 0, base), iso(-1 - k, 15, 0, base), st === 'sent' ? iso(-1, 15, 0, base) : '', JSON.stringify(items), items.reduce((t, i) => t + i.qty * i.price, 0) * 0.45, tax); });
    for (const p of db.prepare("SELECT id FROM permits WHERE source_id='brookline' ORDER BY issued DESC LIMIT 5").all()) q('INSERT OR IGNORE INTO client_favorites VALUES(?,?,?)', seller.id, opaque(p.id), now);
  }
  return {owner};
}
