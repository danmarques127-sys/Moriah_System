// Insulation proposal lines (PPU), modeled on the tool the business already uses.
//   foam:   inches = target R / R per inch;  board feet = FT x inches;  price = board feet x unit price (sell price per board foot)
//   batts / blown-in: price = FT x unit price (per sq ft);  R is fixed by the product
//   materials list: foam gallons = total board feet / Factor M (yield, bd ft per gallon); batts = total FT / Factor M (sq ft per pack)
//   proposal total: original price - discount % + extra to be charged (may be negative) + optional sales tax
// Private side (never shown to customers): cost per gallon / pack + crew productivity give cost, profit and margin.
// Starting values are EDITABLE and come from the existing proposals' unit prices and yields; confirm with the spec sheet.
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const round2 = v => Math.round(v * 100) / 100;
const KINDS = ['foam_open', 'foam_closed', 'batt', 'blown'];
export const PLACES = ['UNDER SIDE OF ROOF', 'EXTERIOR WALLS', 'ATTIC FLOOR', 'GARAGE CEILING', 'GARAGE WALLS', 'GARAGE HOUSE WALLS', 'IN BETWEEN UNIT WALLS', 'BASEMENT WALLS', 'RIM JOIST', 'CRAWL SPACE', 'KNEE WALLS', 'FLOOR OVER GARAGE'];
// [name, kind, pack, unit_cost, pack_gal(unused), pack_cover (Factor M), r_per_inch, r_fixed, note, unit_price]
export const DEFAULT_MATERIALS = [
  ['Open Cell Spray Foam', 'foam_open', 'gal', 37, 1, 379, 4.2, 0, 'Sell $/bd ft, yield (Factor M) in bd ft per gallon, R per inch. Private cost per gallon.', 0.35],
  ['Closed Cell Spray Foam', 'foam_closed', 'gal', 50, 1, 95, 7.5, 0, 'Sell $/bd ft, yield (Factor M) in bd ft per gallon, R per inch.', 1.3],
  ['Fiberglass batt R-13', 'batt', 'sq ft', 0.45, 0, 1, 0, 13, '2x4 walls.', 1.25],
  ['Fiberglass batt R-19', 'batt', 'sq ft', 0.7, 0, 1, 0, 19, '2x6 walls / floors.', 1.66],
  ['Fiberglass batt R-30', 'batt', 'sq ft', 0.95, 0, 1, 0, 30, 'Attics / floors.', 2.25],
  ['Roxul 3 inches 3x15', 'batt', 'pack', 1.0, 0, 80, 0, 15, 'Factor M = sq ft per pack.', 1.85],
  ['Roxul 5.5 inches R-23', 'batt', 'pack', 1.5, 0, 60, 0, 23, 'Factor M = sq ft per pack.', 2.6],
  ['Blown-in fiberglass R-38 (attic)', 'blown', 'bag', 38, 0, 55, 0, 38, 'Factor M = sq ft per bag (check the label).', 2.1]
];
export const DEFAULT_SETTINGS = {crewSize: 2, galPerDay: 60, crewDayCost: 800, wastePct: 10, markupPct: 0, sqftPerDay: 1500, barrelGal: 45};

function seed(db, co) {
  if (!db.prepare('SELECT 1 FROM ins_materials WHERE company_id=? LIMIT 1').get(co)) for (const m of DEFAULT_MATERIALS) db.prepare('INSERT INTO ins_materials(company_id,name,kind,pack,unit_cost,pack_gal,pack_cover,r_per_inch,r_fixed,note,unit_price) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(co, ...m);
  db.prepare('INSERT OR IGNORE INTO ins_settings(company_id) VALUES(?)').run(co);
}
const shapeMat = r => ({id: r.id, name: r.name, kind: r.kind, pack: r.pack, unitCost: r.unit_cost, packGal: r.pack_gal, packCover: r.pack_cover, rPerInch: r.r_per_inch, rFixed: r.r_fixed, note: r.note, unitPrice: r.unit_price});
function settings(db, co) {
  const s = db.prepare('SELECT * FROM ins_settings WHERE company_id=?').get(co);
  return {crewSize: s.crew_size, galPerDay: s.gal_per_day, crewDayCost: s.crew_day_cost, wastePct: s.waste_pct, markupPct: s.markup_pct, sqftPerDay: s.sqft_per_day, barrelGal: s.barrel_gal};
}
export function listInsulation(db, owner) {
  seed(db, owner.companyId);
  return {materials: db.prepare('SELECT * FROM ins_materials WHERE company_id=? ORDER BY id').all(owner.companyId).map(shapeMat), settings: settings(db, owner.companyId), places: PLACES};
}
const num = (v, lo, hi, label) => { const n = Number(v); if (!(n >= lo && n <= hi)) fail(label + ' inválido.'); return n; };

export function calcInsulation(db, owner, b) {
  seed(db, owner.companyId);
  const st = settings(db, owner.companyId), waste = 1 + st.wastePct / 100;
  const rows = [], groups = new Map(); let original = 0, cost = 0, crewDays = 0;
  for (const [i, l] of (Array.isArray(b.lines) ? b.lines : []).slice(0, 60).entries()) {
    const ft = Number(l.ft); if (!(ft > 0)) continue; if (ft > 10000000) fail('Quantidade (ft) inválida.');
    const m = db.prepare('SELECT * FROM ins_materials WHERE id=? AND company_id=?').get(Number(l.materialId), owner.companyId); if (!m) fail('Material não encontrado.', 404);
    const foam = m.kind.startsWith('foam'); let rv, inches = 0, bf = 0;
    if (foam) { rv = num(l.rv, 1, 200, 'RV (R-value)'); if (!(m.r_per_inch > 0)) fail('Defina o R por polegada do produto.'); inches = rv / m.r_per_inch; bf = ft * inches; } else rv = m.r_fixed;
    const price = foam ? bf * m.unit_price : ft * m.unit_price;
    const amount = foam ? bf / Math.max(m.pack_cover, 0.0001) : ft / Math.max(m.pack_cover, 0.0001);   // gallons, or packs
    const mcost = amount * waste * m.unit_cost, days = foam ? amount * waste / Math.max(st.galPerDay, 1) : ft / Math.max(st.sqftPerDay, 1);
    const lcost = mcost + days * st.crewDayCost;
    original += price; cost += lcost; crewDays += days;
    const g = groups.get(m.id) || {material: m.name, kind: m.kind, unit: foam ? 'GL' : (m.pack === 'sq ft' ? 'SF' : m.pack.toUpperCase()), bf: 0, ft: 0, factor: m.pack_cover}; g.bf += bf; g.ft += ft; groups.set(m.id, g);
    rows.push({order: Number(l.order) || i + 1, place: clean(l.place, 80), depth: clean(l.depth, 20), workplace: clean(l.workplace, 80), noteCustomer: clean(l.noteCustomer, 400), noteCrew: clean(l.noteCrew, 400), materialId: m.id, product: m.name, kind: m.kind, inches: round2(inches), rPerInch: m.r_per_inch, unitPrice: m.unit_price, rv: round2(rv), ft, boardFeet: round2(bf), price: round2(price), cost: round2(lcost)});
  }
  rows.sort((x, y) => x.order - y.order);
  const discountPct = num(b.discountPct || 0, 0, 100, 'Desconto'), extra = Number(b.extra || 0); if (!(Math.abs(extra) <= 100000000)) fail('Valor extra inválido.');
  const extraNote = clean(b.extraNote, 200); if (extra && !extraNote) fail('Descreva o valor extra ("Extra to be charged").');
  const discount = original * discountPct / 100, subtotal = original - discount + extra, taxRate = b.taxOn ? num(b.taxRate || 0, 0, 30, 'Imposto') : 0, tax = subtotal * taxRate / 100, total = subtotal + tax;
  const materials = [...groups.values()].map(g => { const foam = g.kind.startsWith('foam'), qty = Math.round(foam ? g.bf / Math.max(g.factor, 0.0001) : g.ft / Math.max(g.factor, 0.0001)); return {material: g.material, unit: g.unit, qty, barrels: foam ? round2(qty / st.barrelGal) : 0, ft: round2(g.ft)}; });
  return {rows, materials, totals: {original: round2(original), discount: round2(discount), extra: round2(extra), extraNote, subtotal: round2(subtotal), taxRate, tax: round2(tax), total: round2(total), cost: round2(cost), profit: round2(subtotal - cost), margin: subtotal > 0 ? round2((subtotal - cost) / subtotal * 100) : 0, crewDays: round2(crewDays)}, settings: st};
}

export function insulationAction(db, owner, b) {
  seed(db, owner.companyId);
  if (b.op === 'calc') return calcInsulation(db, owner, b);
  if (b.op === 'settings') {
    const v = [Math.round(num(b.crewSize, 1, 20, 'Equipe')), num(b.galPerDay, 1, 5000, 'Galões por dia'), num(b.crewDayCost, 0, 100000, 'Custo do dia'), num(b.wastePct, 0, 100, 'Desperdício'), num(b.markupPct ?? 0, 0, 500, 'Markup'), num(b.sqftPerDay, 1, 100000, 'Produtividade'), num(b.barrelGal || 45, 1, 500, 'Galões por barril')];
    db.prepare('UPDATE ins_settings SET crew_size=?,gal_per_day=?,crew_day_cost=?,waste_pct=?,markup_pct=?,sqft_per_day=?,barrel_gal=? WHERE company_id=?').run(...v, owner.companyId); return {ok: true};
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
