// Insulation proposal lines (PPU), modeled on the tool the business already uses.
//   foam:   inches = target R / R per inch;  board feet = FT x inches;  price = board feet x unit price (sell price per board foot)
//   batts / blown-in: price = FT x unit price (per sq ft);  R is fixed by the product
//   materials list: foam gallons = total board feet / Factor M (yield, bd ft per gallon); batts = total FT / Factor M (sq ft per pack)
//   proposal total: original price - discount % + extra to be charged (may be negative) + optional sales tax
// Private side (never shown to customers): cost per gallon / pack + crew productivity give cost, profit and margin.
// Starting values are EDITABLE and come from the existing proposals' unit prices and yields; confirm with the spec sheet.
import {listExtras, priceExtras, extrasOp} from './extras.mjs';
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const round2 = v => Math.round(v * 100) / 100;
const KINDS = ['foam_open', 'foam_closed', 'batt', 'blown'];
export const PLACES = ['UNDER SIDE OF ROOF', 'EXTERIOR WALLS', 'ATTIC FLOOR', 'GARAGE CEILING', 'GARAGE WALLS', 'GARAGE HOUSE WALLS', 'IN BETWEEN UNIT WALLS', 'BASEMENT WALLS', 'RIM JOIST', 'CRAWL SPACE', 'KNEE WALLS', 'FLOOR OVER GARAGE'];
// [name, kind, pack, unit_cost, pack_gal(unused), pack_cover (Factor M), r_per_inch, r_fixed, note, unit_price]
export const DEFAULT_MATERIALS = [
  ['Open Cell Spray Foam', 'foam_open', 'gal', 37, 1, 379, 4.2, 0, 'Sell $/bd ft, yield (Factor M) in bd ft per gallon, R per inch. Private cost per gallon.', 0.35],
  ['Closed Cell Spray Foam', 'foam_closed', 'gal', 55, 1, 95, 7.5, 0, 'Sell $/bd ft, yield (Factor M) in bd ft per gallon, R per inch.', 1.3],
  ['Fiberglass batt R-13', 'batt', 'pack', 106, 0, 195.2, 0, 13, '2x4 walls. Store price of a 13-batt pack (195 sq ft), Nov 2026: set your all-in pack price.', 1.25],
  ['Fiberglass batt R-19', 'batt', 'pack', 117, 0, 118.83, 0, 19, '2x6 walls / floors. Store price of a bag (118.83 sq ft), Nov 2026: set your all-in pack price.', 1.66],
  ['Fiberglass batt R-30', 'batt', 'pack', 88.82, 0, 53.33, 0, 30, 'Attics / floors. Store price of a bag (53.33 sq ft), Nov 2026: set your all-in pack price.', 2.25],
  ['Roxul 3 inches 3x15', 'batt', 'pack', 70, 0, 80, 0, 15, 'Factor M = sq ft per pack.', 1.85],
  ['Roxul 5.5 inches R-23', 'batt', 'pack', 1.5, 0, 60, 0, 23, 'Factor M = sq ft per pack.', 2.6],
  ['Blown-in fiberglass R-38 (attic)', 'blown', 'bag', 38, 0, 55, 0, 38, 'Factor M = sq ft per bag (check the label).', 2.1]
];
export const DEFAULT_SETTINGS = {crewSize: 2, galPerDay: 50, crewDayCost: 1100, dayProfit: 1200, firePrice: 1200, wastePct: 0, markupPct: 0, sqftPerDay: 1500, barrelGal: 45};

function seed(db, co) {
  if (!db.prepare('SELECT 1 FROM ins_materials WHERE company_id=? LIMIT 1').get(co)) for (const m of DEFAULT_MATERIALS) db.prepare('INSERT INTO ins_materials(company_id,name,kind,pack,unit_cost,pack_gal,pack_cover,r_per_inch,r_fixed,note,unit_price) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(co, ...m);
  db.prepare('INSERT OR IGNORE INTO ins_settings(company_id,crew_size,gal_per_day,crew_day_cost,day_profit,fire_price,waste_pct,markup_pct,sqft_per_day,barrel_gal) VALUES(?,?,?,?,?,?,?,?,?,?)').run(co, ...Object.values(DEFAULT_SETTINGS).slice(0, 9));
}
const shapeMat = r => ({id: r.id, name: r.name, kind: r.kind, pack: r.pack, unitCost: r.unit_cost, packGal: r.pack_gal, packCover: r.pack_cover, rPerInch: r.r_per_inch, rFixed: r.r_fixed, note: r.note, unitPrice: r.unit_price});
function settings(db, co) {
  const s = db.prepare('SELECT * FROM ins_settings WHERE company_id=?').get(co);
  return {crewSize: s.crew_size, galPerDay: s.gal_per_day, crewDayCost: s.crew_day_cost, dayProfit: s.day_profit, firePrice: s.fire_price, wastePct: s.waste_pct, markupPct: s.markup_pct, sqftPerDay: s.sqft_per_day, barrelGal: s.barrel_gal};
}
export function listInsulation(db, owner) {
  seed(db, owner.companyId);
  return {materials: db.prepare('SELECT * FROM ins_materials WHERE company_id=? ORDER BY id').all(owner.companyId).map(shapeMat), settings: settings(db, owner.companyId), places: PLACES, extras: listExtras(db, owner.companyId, 'Insulation')};
}
const num = (v, lo, hi, label) => { const n = Number(v); if (!(n >= lo && n <= hi)) fail(label + ' inválido.'); return n; };

export function calcInsulation(db, owner, b) {
  seed(db, owner.companyId);
  const st = settings(db, owner.companyId), raw = [], groups = new Map();
  for (const [i, l] of (Array.isArray(b.lines) ? b.lines : []).slice(0, 60).entries()) {
    const ft = Number(l.ft); if (!(ft > 0)) continue; if (ft > 10000000) fail('Quantidade (ft) inválida.');
    const m = db.prepare('SELECT * FROM ins_materials WHERE id=? AND company_id=?').get(Number(l.materialId), owner.companyId); if (!m) fail('Material não encontrado.', 404);
    const foam = m.kind.startsWith('foam'); let rv, inches = 0, bf = 0;
    if (foam) { rv = num(l.rv, 1, 200, 'RV (R-value)'); if (!(m.r_per_inch > 0)) fail('Defina o R por polegada do produto.'); inches = rv / m.r_per_inch; bf = ft * inches; } else rv = m.r_fixed;
    const amount = (foam ? bf : ft) / Math.max(m.pack_cover, 0.0001);   // gallons, or packs
    const g = groups.get(m.id) || {m, foam, bf: 0, ft: 0, amount: 0}; g.bf += bf; g.ft += ft; g.amount += amount; groups.set(m.id, g);
    raw.push({l, i, m, foam, rv, inches, bf, ft, amount});
  }
  // Job level: quantities round UP; spray days = total gallons / gallons per day (up). Batts / Roxul: price = packs x pack price (labor and profit included).
  const qtyOf = g => g.foam ? Math.round(g.amount) : Math.ceil(g.amount - 1e-9);   // gallons as the reference tool counts them; packs round up
  let gals = 0, battFt = 0; for (const g of groups.values()) { if (g.foam) gals += qtyOf(g); else battFt += g.ft; }
  const sprayDays = gals ? Math.ceil(gals / Math.max(st.galPerDay, 1)) : 0, battDays = 0, crewDays = sprayDays + battDays;
  const perDay = st.crewDayCost + st.dayProfit;
  const rows = []; let original = 0, mcostAll = 0;
  for (const r of raw) {
    const g = groups.get(r.m.id), share = r.amount / Math.max(g.amount, 1e-9), q = qtyOf(g) * share;
    const mat = q * r.m.unit_cost, labor = r.foam ? (gals ? sprayDays * perDay * (qtyOf(g) * share) / gals : 0) : 0, price = mat + labor;
    original += price; mcostAll += mat;
    rows.push({order: Number(r.l.order) || r.i + 1, place: clean(r.l.place, 80), depth: clean(r.l.depth, 20), workplace: clean(r.l.workplace, 80), noteCustomer: clean(r.l.noteCustomer, 400), noteCrew: clean(r.l.noteCrew, 400), materialId: r.m.id, product: r.m.name, kind: r.m.kind, inches: round2(r.inches), rPerInch: r.m.r_per_inch, unitPrice: r.ft > 0 ? round2(price / (r.foam ? Math.max(r.bf, 1e-9) : r.ft) * 100) / 100 : 0, rv: round2(r.rv), ft: r.ft, boardFeet: round2(r.bf), price: round2(price), cost: round2(mat + (r.foam && gals ? sprayDays * st.crewDayCost * (qtyOf(g) * share) / gals : 0))});
  }
  rows.sort((x, y) => x.order - y.order);
  const ex = priceExtras(db, owner.companyId, 'Insulation', b.extras); original += ex.price;
  const fire = b.fire ? num(b.firePrice ?? st.firePrice, 0, 1000000, 'Fireblocking') : 0; original += fire;
  const cost = mcostAll + crewDays * st.crewDayCost + ex.cost;   // batts: the pack price already covers labor and profit
  const discountPct = num(b.discountPct || 0, 0, 100, 'Desconto'), extra = Number(b.extra || 0); if (!(Math.abs(extra) <= 100000000)) fail('Valor extra inválido.');
  const extraNote = clean(b.extraNote, 200); if (extra && !extraNote) fail('Descreva o valor extra ("Extra to be charged").');
  const discount = original * discountPct / 100, subtotal = original - discount + extra, taxRate = b.taxOn ? num(b.taxRate || 0, 0, 30, 'Imposto') : 0, tax = subtotal * taxRate / 100, total = subtotal + tax;
  const materials = [...groups.values()].map(g => { const qty = qtyOf(g); return {material: g.m.name, unit: g.foam ? 'GL' : (g.m.pack === 'sq ft' ? 'SF' : g.m.pack.toUpperCase()), qty, barrels: g.foam ? round2(qty / st.barrelGal) : 0, ft: round2(g.ft), cost: round2(qty * g.m.unit_cost)}; });
  return {rows, materials, extras: ex.rows, totals: {extrasPrice: ex.price, original: round2(original), fire: round2(fire), discount: round2(discount), extra: round2(extra), extraNote, subtotal: round2(subtotal), taxRate, tax: round2(tax), total: round2(total), cost: round2(cost), profit: round2(subtotal - cost), margin: subtotal > 0 ? round2((subtotal - cost) / subtotal * 100) : 0, crewDays, sprayDays, battDays, gallons: gals}, settings: st};
}

export function insulationAction(db, owner, b) {
  seed(db, owner.companyId);
  if (b.op === 'calc') return calcInsulation(db, owner, b);
  const xo = extrasOp(db, owner.companyId, 'Insulation', b); if (xo) return xo;
  if (b.op === 'settings') {
    const v = [Math.round(num(b.crewSize, 1, 20, 'Equipe')), num(b.galPerDay, 1, 5000, 'Galões por dia'), num(b.crewDayCost, 0, 100000, 'Custo do dia'), num(b.wastePct ?? 0, 0, 100, 'Desperdício'), num(b.markupPct ?? 0, 0, 500, 'Markup'), num(b.sqftPerDay, 1, 100000, 'Produtividade'), num(b.barrelGal || 45, 1, 500, 'Galões por barril'), num(b.dayProfit ?? 1200, 0, 100000, 'Lucro por dia'), num(b.firePrice ?? 1200, 0, 100000, 'Fireblocking')];
    db.prepare('UPDATE ins_settings SET crew_size=?,gal_per_day=?,crew_day_cost=?,waste_pct=?,markup_pct=?,sqft_per_day=?,barrel_gal=?,day_profit=?,fire_price=? WHERE company_id=?').run(...v, owner.companyId); return {ok: true};
  }
  if (b.op === 'save') {
    const name = clean(b.name, 120); if (!name) fail('Informe o nome do material.'); if (!KINDS.includes(b.kind)) fail('Tipo inválido.');
    const foam = b.kind.startsWith('foam');
    const v = [name, b.kind, clean(b.pack, 60) || (foam ? 'gal' : 'pack'), num(b.unitCost || 0, 0, 1000000, 'Custo'), foam ? 1 : 0, num(b.packCover, 0.01, 10000000, 'Rendimento'), foam ? num(b.rPerInch, 0, 20, 'R por polegada') : 0, foam ? 0 : num(b.rFixed || 0, 0, 100, 'R-value'), clean(b.note, 300), num(b.unitPrice, 0, 1000000, 'Preço de venda')];
    if (b.id) { if (!db.prepare('UPDATE ins_materials SET name=?,kind=?,pack=?,unit_cost=?,pack_gal=?,pack_cover=?,r_per_inch=?,r_fixed=?,note=?,unit_price=? WHERE id=? AND company_id=?').run(...v, Number(b.id), owner.companyId).changes) fail('Material não encontrado.', 404); return {id: Number(b.id)}; }
    return {id: Number(db.prepare('INSERT INTO ins_materials(company_id,name,kind,pack,unit_cost,pack_gal,pack_cover,r_per_inch,r_fixed,note,unit_price) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(owner.companyId, ...v).lastInsertRowid)};
  }
  if (b.op === 'delete') { db.prepare('DELETE FROM ins_materials WHERE id=? AND company_id=?').run(Number(b.id), owner.companyId); return {ok: true}; }
  if (b.op === 'reset') { db.prepare('DELETE FROM ins_materials WHERE company_id=?').run(owner.companyId); db.prepare('DELETE FROM ins_settings WHERE company_id=?').run(owner.companyId); seed(db, owner.companyId); return {ok: true}; }
  fail('Operação inválida.');
}
