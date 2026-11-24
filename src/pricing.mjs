// Price lists and job-cost calculators per trade. Starting values are EDITABLE PLACEHOLDERS, not market quotes.
// (Later: pull Home Depot / Lowe's material prices into `cost`.)
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const round2 = v => Math.round(v * 100) / 100;
export const DEFAULTS = {
  Insulation: [['Blown-in attic insulation (R-38)', 'sq ft', 2.1, 0.95], ['Closed-cell spray foam (2")', 'sq ft', 3.25, 1.4], ['Fiberglass batts (R-19 walls)', 'sq ft', 1.6, 0.7], ['Air sealing', 'hour', 95, 30], ['Attic baffles / ventilation', 'each', 12, 4], ['Old insulation removal', 'sq ft', 1.25, 0.45]],
  Electrical: [['Outlet / switch install', 'each', 95, 18], ['Recessed light install', 'each', 140, 35], ['Panel upgrade (200A)', 'each', 3200, 1400], ['EV charger circuit', 'each', 850, 280], ['Electrician labor', 'hour', 105, 45]],
  HVAC: [['Mini-split install (1 zone)', 'each', 4200, 2300], ['Furnace replacement', 'each', 6200, 3300], ['Ductwork', 'linear ft', 38, 14], ['Thermostat install', 'each', 180, 70], ['HVAC technician labor', 'hour', 120, 50]],
  Framing: [['Wall framing', 'linear ft', 22, 9], ['Deck framing', 'sq ft', 14, 6], ['Header / beam install', 'each', 650, 240], ['Carpenter labor', 'hour', 85, 38]],
  Plumbing: [['Fixture install (sink / toilet)', 'each', 320, 90], ['Water heater replacement', 'each', 2100, 950], ['Pipe repair / re-pipe', 'linear ft', 28, 9], ['Plumber labor', 'hour', 115, 50]],
  Roofing: [['Asphalt shingle roof', 'sq (100 sq ft)', 520, 230], ['Roof tear-off', 'sq (100 sq ft)', 120, 40], ['Flashing / vent boots', 'each', 85, 20]],
  Painting: [['Interior paint (walls)', 'sq ft', 2.4, 0.8], ['Exterior paint', 'sq ft', 3.1, 1.1], ['Trim painting', 'linear ft', 3.5, 0.9]],
  Flooring: [['LVP flooring install', 'sq ft', 6.5, 3.2], ['Hardwood refinish', 'sq ft', 5.5, 1.5], ['Tile install', 'sq ft', 12, 4.8]],
  Sheetrock: [['Drywall hang + finish', 'sq ft', 3.4, 1.2], ['Drywall patch / repair', 'each', 160, 25], ['Skim coat', 'sq ft', 2.2, 0.6]]
};
function seed(db, co) {
  if (db.prepare('SELECT 1 FROM price_items WHERE company_id=? LIMIT 1').get(co)) return;
  for (const [trade, list] of Object.entries(DEFAULTS)) for (const [name, unit, price, cost] of list) db.prepare('INSERT INTO price_items(company_id,trade,name,unit,price,cost) VALUES(?,?,?,?,?,?)').run(co, trade, name, unit, price, cost);
}
export function listPrices(db, owner) {
  seed(db, owner.companyId);
  const own = db.prepare('SELECT t.name FROM company_trades ct JOIN trades t ON t.id=ct.trade_id WHERE ct.company_id=?').all(owner.companyId).map(r => r.name);
  const items = db.prepare('SELECT id,trade,name,unit,price,cost,note FROM price_items WHERE company_id=? ORDER BY trade,id').all(owner.companyId);
  return {items, trades: [...new Set(items.map(i => i.trade))], myTrades: own, disclaimer: 'Starting prices are editable placeholders. Set your own prices and costs.'};
}
export function pricesAction(db, owner, b) {
  if (b.op === 'save') {
    const name = clean(b.name, 120), trade = clean(b.trade, 40); if (!name || !trade) fail('Informe o trade e o nome do item.');
    const price = round2(Number(b.price)), cost = round2(Number(b.cost || 0)); if (!(price >= 0 && price <= 10000000) || !(cost >= 0 && cost <= 10000000)) fail('Valores inválidos.');
    const v = [trade, name, clean(b.unit, 20) || 'ea', price, cost, clean(b.note, 200)];
    if (b.id) { if (!db.prepare('UPDATE price_items SET trade=?,name=?,unit=?,price=?,cost=?,note=? WHERE id=? AND company_id=?').run(...v, Number(b.id), owner.companyId).changes) fail('Item não encontrado.', 404); return {id: Number(b.id)}; }
    return {id: Number(db.prepare('INSERT INTO price_items(company_id,trade,name,unit,price,cost,note) VALUES(?,?,?,?,?,?,?)').run(owner.companyId, ...v.slice(0, 6)).lastInsertRowid)};
  }
  if (b.op === 'delete') { db.prepare('DELETE FROM price_items WHERE id=? AND company_id=?').run(Number(b.id), owner.companyId); return {ok: true}; }
  if (b.op === 'reset') { db.prepare('DELETE FROM price_items WHERE company_id=?').run(owner.companyId); seed(db, owner.companyId); return {ok: true}; }
  fail('Operação inválida.');
}
// lines: [{itemId, qty}] -> estimate/invoice line items + internal cost + margin (cost stays owner-only)
export function calculate(db, owner, b) {
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 60), markup = Number(b.markup || 0), taxRate = Number(b.taxRate || 0);
  if (!(markup >= 0 && markup <= 500) || !(taxRate >= 0 && taxRate <= 30)) fail('Markup ou imposto inválido.');
  const items = []; let cost = 0;
  for (const l of lines) {
    const qty = Number(l.qty); if (!(qty > 0)) continue; if (qty > 100000) fail('Quantidade inválida.');
    const it = db.prepare('SELECT name,unit,price,cost FROM price_items WHERE id=? AND company_id=?').get(Number(l.itemId), owner.companyId); if (!it) fail('Item não encontrado.', 404);
    const price = round2(it.price * (1 + markup / 100)); items.push({description: it.name + ' (' + it.unit + ')', qty, price}); cost += qty * it.cost;
  }
  const subtotal = round2(items.reduce((t, i) => t + i.qty * i.price, 0)), tax = round2(subtotal * taxRate / 100), total = round2(subtotal + tax);
  return {items, subtotal, tax, total, internalCost: round2(cost), profit: round2(subtotal - cost), margin: subtotal > 0 ? round2((subtotal - cost) / subtotal * 100) : 0};
}
