// Job extras: small items always added to a job (rollers, drop cloths, plastic sheeting...). Each has a private cost and a price charged per unit.
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const round2 = v => Math.round(v * 100) / 100;
// [name, unit, cost, price] - starting examples, all editable
export const DEFAULT_EXTRAS = {
  Painting: [['Roller covers', 'each', 4, 6], ['Brushes', 'each', 8, 12], ['Drop cloths', 'each', 12, 18], ['Painter\'s tape', 'roll', 6, 9], ['Caulk', 'tube', 5, 8], ['Sandpaper / sanding sponges', 'pack', 10, 15], ['Spackle / patching compound', 'tub', 12, 18]],
  Insulation: [['Plastic sheeting (poly)', 'roll', 45, 65], ['Spray foam sealant cans', 'can', 9, 14], ['Tape / seam sealant', 'roll', 7, 11], ['Staples / fasteners', 'box', 8, 12], ['Vapor barrier / baffles', 'each', 3, 5], ['Disposable suits and masks', 'set', 15, 22]]
};
export function seedExtras(db, co, trade) {
  if (db.prepare('SELECT 1 FROM job_extras WHERE company_id=? AND trade=? LIMIT 1').get(co, trade)) return;
  for (const x of DEFAULT_EXTRAS[trade] || []) db.prepare('INSERT INTO job_extras(company_id,trade,name,unit,unit_cost,unit_price) VALUES(?,?,?,?,?,?)').run(co, trade, ...x);
}
const shape = r => ({id: r.id, name: r.name, unit: r.unit, unitCost: r.unit_cost, unitPrice: r.unit_price});
export const listExtras = (db, co, trade) => { seedExtras(db, co, trade); return db.prepare('SELECT * FROM job_extras WHERE company_id=? AND trade=? ORDER BY id').all(co, trade).map(shape); };
// items: [{id, qty}] -> {rows, price, cost}
export function priceExtras(db, co, trade, items) {
  const rows = []; let price = 0, cost = 0;
  for (const i of Array.isArray(items) ? items.slice(0, 60) : []) {
    const q = Number(i.qty); if (!(q > 0)) continue; if (q > 100000) fail('Quantidade do extra inválida.');
    const x = db.prepare('SELECT * FROM job_extras WHERE id=? AND company_id=? AND trade=?').get(Number(i.id), co, trade); if (!x) fail('Extra não encontrado.', 404);
    rows.push({id: x.id, name: x.name, unit: x.unit, qty: q, price: round2(q * x.unit_price), cost: round2(q * x.unit_cost)}); price += q * x.unit_price; cost += q * x.unit_cost;
  }
  return {rows, price: round2(price), cost: round2(cost)};
}
// shared by the trade actions: ops xsave / xdel / xreset
export function extrasOp(db, co, trade, b) {
  const n = (v, l) => { const x = Number(v); if (!(x >= 0 && x <= 1000000)) fail(l + ' inválido.'); return x; };
  if (b.op === 'xsave') {
    const name = clean(b.name, 120); if (!name) fail('Informe o nome do extra.');
    const v = [name, clean(b.unit, 30) || 'each', n(b.unitCost || 0, 'Custo'), n(b.unitPrice || 0, 'Preço')];
    if (b.id) { if (!db.prepare('UPDATE job_extras SET name=?,unit=?,unit_cost=?,unit_price=? WHERE id=? AND company_id=? AND trade=?').run(...v, Number(b.id), co, trade).changes) fail('Extra não encontrado.', 404); return {id: Number(b.id)}; }
    return {id: Number(db.prepare('INSERT INTO job_extras(company_id,trade,name,unit,unit_cost,unit_price) VALUES(?,?,?,?,?,?)').run(co, trade, ...v).lastInsertRowid)};
  }
  if (b.op === 'xdel') { db.prepare('DELETE FROM job_extras WHERE id=? AND company_id=? AND trade=?').run(Number(b.id), co, trade); return {ok: true}; }
  if (b.op === 'xreset') { db.prepare('DELETE FROM job_extras WHERE company_id=? AND trade=?').run(co, trade); seedExtras(db, co, trade); return {ok: true}; }
  return null;
}
