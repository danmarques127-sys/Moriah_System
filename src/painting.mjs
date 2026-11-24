// Painting: paint is bought by the gallon or the 5-gallon bucket; the job is priced as
//   material (buckets + loose gallons, cheapest combination) + crew hours x (hour cost + hour profit) + extras (rollers, drop cloths...).
// Crew hours = square feet painted (area x coats) / sq ft per crew-hour, rounded up to the whole hour. Cost and profit stay private.
import {listExtras, priceExtras, extrasOp} from './extras.mjs';
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const round2 = v => Math.round(v * 100) / 100;
const KINDS = ['interior', 'ceiling', 'trim', 'exterior', 'primer'];
export const PAINT_PLACES = ['LIVING ROOM', 'BEDROOMS', 'KITCHEN', 'BATHROOMS', 'HALLWAYS', 'CEILINGS', 'TRIM AND DOORS', 'EXTERIOR WALLS', 'EXTERIOR TRIM', 'GARAGE', 'BASEMENT'];
// [name, kind, coverage (sq ft per gallon, one coat), gal_price, bucket_price (5 gal), note] - typical label values; confirm with your paint's can
export const DEFAULT_PAINT = [
  ['Interior wall paint', 'interior', 350, 45, 190, 'Smooth walls, one coat. Rough or porous walls cover less (200-250).'],
  ['Ceiling paint', 'ceiling', 350, 38, 160, 'Flat white.'],
  ['Trim and door enamel', 'trim', 400, 55, 250, 'Semi-gloss.'],
  ['Exterior paint', 'exterior', 300, 55, 240, 'Siding; 250-350 depending on surface.'],
  ['Primer', 'primer', 275, 32, 140, 'Bare, patched or stained surfaces.']
];
export const DEFAULT_PAINT_SETTINGS = {crewSize: 2, sqftPerHour: 150, hourCost: 70, hourProfit: 60, bucketGal: 5};
function seed(db, co) {
  if (!db.prepare('SELECT 1 FROM paint_products WHERE company_id=? LIMIT 1').get(co)) for (const m of DEFAULT_PAINT) db.prepare('INSERT INTO paint_products(company_id,name,kind,coverage,gal_price,bucket_price,note) VALUES(?,?,?,?,?,?,?)').run(co, ...m);
  db.prepare('INSERT OR IGNORE INTO paint_settings(company_id) VALUES(?)').run(co);
}
const shapeP = r => ({id: r.id, name: r.name, kind: r.kind, coverage: r.coverage, galPrice: r.gal_price, bucketPrice: r.bucket_price, note: r.note});
const settings = (db, co) => { const s = db.prepare('SELECT * FROM paint_settings WHERE company_id=?').get(co); return {crewSize: s.crew_size, sqftPerHour: s.sqft_per_hour, hourCost: s.hour_cost, hourProfit: s.hour_profit, bucketGal: s.bucket_gal}; };
export function listPainting(db, owner) {
  seed(db, owner.companyId);
  return {products: db.prepare('SELECT * FROM paint_products WHERE company_id=? ORDER BY id').all(owner.companyId).map(shapeP), settings: settings(db, owner.companyId), places: PAINT_PLACES, extras: listExtras(db, owner.companyId, 'Painting')};
}
const num = (v, lo, hi, label) => { const n = Number(v); if (!(n >= lo && n <= hi)) fail(label + ' inválido.'); return n; };
// whole buckets + loose gallons, taking a bucket instead of the loose gallons when it is cheaper
export function buy(gallons, p, bucketGal) {
  const need = Math.ceil(gallons - 1e-9); let buckets = Math.floor(need / bucketGal), loose = need - buckets * bucketGal;
  if (p.bucket_price > 0 && loose * p.gal_price > p.bucket_price) { buckets++; loose = 0; }
  return {buckets, loose, cost: buckets * p.bucket_price + loose * p.gal_price};
}
export function calcPainting(db, owner, b) {
  seed(db, owner.companyId);
  const st = settings(db, owner.companyId), rows = [], groups = new Map(); let sqftCoats = 0;
  for (const [i, l] of (Array.isArray(b.lines) ? b.lines : []).slice(0, 60).entries()) {
    const area = Number(l.area); if (!(area > 0)) continue; if (area > 10000000) fail('Área inválida.');
    const p = db.prepare('SELECT * FROM paint_products WHERE id=? AND company_id=?').get(Number(l.productId), owner.companyId); if (!p) fail('Produto não encontrado.', 404);
    const coats = num(l.coats || 2, 1, 6, 'Demãos'), gallons = area * coats / Math.max(p.coverage, 0.0001);
    sqftCoats += area * coats; const g = groups.get(p.id) || {p, gallons: 0}; g.gallons += gallons; groups.set(p.id, g);
    rows.push({order: Number(l.order) || i + 1, place: clean(l.place, 80), noteCustomer: clean(l.noteCustomer, 400), noteCrew: clean(l.noteCrew, 400), productId: p.id, product: p.name, area, coats, gallons: round2(gallons)});
  }
  rows.sort((x, y) => x.order - y.order);
  const materials = []; let mat = 0, galsTotal = 0;
  for (const g of groups.values()) { const r = buy(g.gallons, g.p, st.bucketGal), need = Math.ceil(g.gallons - 1e-9); mat += r.cost; galsTotal += need; materials.push({product: g.p.name, gallons: need, buckets: r.buckets, loose: r.loose, cost: round2(r.cost)}); }
  const hours = sqftCoats ? Math.ceil(sqftCoats / Math.max(st.sqftPerHour, 1)) : 0, labor = hours * (st.hourCost + st.hourProfit);
  const ex = priceExtras(db, owner.companyId, 'Painting', b.extras);
  // each line's price: its share of paint (by gallons) + its share of crew hours (by sq ft x coats)
  for (const r of rows) { const g = groups.get(r.productId), share = g.gallons ? r.gallons / g.gallons : 0, m = materials.find(x => x.product === g.p.name).cost * share; r.price = round2(m + (sqftCoats ? labor * r.area * r.coats / sqftCoats : 0)); }
  const original = mat + labor + ex.price, discountPct = num(b.discountPct || 0, 0, 100, 'Desconto'), extra = Number(b.extra || 0); if (!(Math.abs(extra) <= 100000000)) fail('Valor extra inválido.');
  const extraNote = clean(b.extraNote, 200); if (extra && !extraNote) fail('Descreva o valor extra ("Extra to be charged").');
  const discount = original * discountPct / 100, subtotal = original - discount + extra, taxRate = b.taxOn ? num(b.taxRate || 0, 0, 30, 'Imposto') : 0, tax = subtotal * taxRate / 100, total = subtotal + tax, cost = mat + hours * st.hourCost + ex.cost;
  return {rows, materials, extras: ex.rows, totals: {material: round2(mat), labor: round2(labor), extrasPrice: ex.price, original: round2(original), discount: round2(discount), extra: round2(extra), extraNote, subtotal: round2(subtotal), taxRate, tax: round2(tax), total: round2(total), cost: round2(cost), profit: round2(subtotal - cost), margin: subtotal > 0 ? round2((subtotal - cost) / subtotal * 100) : 0, hours, gallons: galsTotal}, settings: st};
}
export function paintingAction(db, owner, b) {
  seed(db, owner.companyId); const co = owner.companyId;
  if (b.op === 'calc') return calcPainting(db, owner, b);
  const x = extrasOp(db, co, 'Painting', b); if (x) return x;
  if (b.op === 'settings') { db.prepare('UPDATE paint_settings SET crew_size=?,sqft_per_hour=?,hour_cost=?,hour_profit=?,bucket_gal=? WHERE company_id=?').run(Math.round(num(b.crewSize, 1, 20, 'Equipe')), num(b.sqftPerHour, 1, 100000, 'Sq ft por hora'), num(b.hourCost, 0, 100000, 'Custo por hora'), num(b.hourProfit, 0, 100000, 'Lucro por hora'), num(b.bucketGal || 5, 1, 100, 'Galões por balde'), co); return {ok: true}; }
  if (b.op === 'save') {
    const name = clean(b.name, 120); if (!name) fail('Informe o nome da tinta.'); if (!KINDS.includes(b.kind)) fail('Tipo inválido.');
    const v = [name, b.kind, num(b.coverage, 1, 5000, 'Cobertura'), num(b.galPrice || 0, 0, 100000, 'Preço do galão'), num(b.bucketPrice || 0, 0, 100000, 'Preço do balde'), clean(b.note, 300)];
    if (b.id) { if (!db.prepare('UPDATE paint_products SET name=?,kind=?,coverage=?,gal_price=?,bucket_price=?,note=? WHERE id=? AND company_id=?').run(...v, Number(b.id), co).changes) fail('Produto não encontrado.', 404); return {id: Number(b.id)}; }
    return {id: Number(db.prepare('INSERT INTO paint_products(company_id,name,kind,coverage,gal_price,bucket_price,note) VALUES(?,?,?,?,?,?,?)').run(co, ...v).lastInsertRowid)};
  }
  if (b.op === 'delete') { db.prepare('DELETE FROM paint_products WHERE id=? AND company_id=?').run(Number(b.id), co); return {ok: true}; }
  if (b.op === 'reset') { db.prepare('DELETE FROM paint_products WHERE company_id=?').run(co); db.prepare('DELETE FROM paint_settings WHERE company_id=?').run(co); seed(db, co); return {ok: true}; }
  fail('Operação inválida.');
}
