// Insulation job pricing from materials.
// Spray foam: net area (sq ft, minus openings) x thickness (in) = BOARD FEET; gallons = board feet / yield (bd ft per gallon);
// barrels = gallons / barrel size (45 by default); material cost = gallons x price per gallon. Open and closed cell are
// calculated separately, each with its own yield. Hybrid: closed cell first, then open cell fills the rest of the target R.
// Batts and blown-in: sq ft / coverage per pack x pack price.
// Starting values are EDITABLE: yields and prices come from the previous Insulation Estimator calibration; confirm them with the
// client's spec sheet (UPC data sheets) and supplier prices before quoting.
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);
const round2 = v => Math.round(v * 100) / 100;
const KINDS = ['foam_open', 'foam_closed', 'batt', 'blown'];
// [name, kind, pack, unit_cost, pack_gal(unused), pack_cover, r_per_inch, r_fixed, note]   (foam: cost per gallon, cover = bd ft per gallon)
export const DEFAULT_MATERIALS = [
  ['UPC open-cell spray foam (UPC 400)', 'foam_open', 'gal', 37, 1, 382, 3.7, 0, 'Previous calibration: $37/gal, ~382 bd ft/gal. Data sheet: R-4.0/in, up to 20,000 bd ft per set.'],
  ['UPC closed-cell spray foam (UPC 2.0)', 'foam_closed', 'gal', 50, 1, 96, 6.5, 0, 'Previous calibration: $50/gal, ~96 bd ft/gal. Set R/in and yield from the spec sheet.'],
  ['Fiberglass batt R-13 (pink)', 'batt', 'sq ft', 0.45, 0, 1, 0, 13, '2x4 walls.'],
  ['Fiberglass batt R-19 (pink)', 'batt', 'sq ft', 0.7, 0, 1, 0, 19, '2x6 walls / floors.'],
  ['Fiberglass batt R-30 (pink)', 'batt', 'sq ft', 0.95, 0, 1, 0, 30, 'Attics / floors.'],
  ['Rockwool batt R-15', 'batt', 'sq ft', 0.85, 0, 1, 0, 15, 'Mineral wool costs roughly 40-50% more than fiberglass.'],
  ['Rockwool batt R-23', 'batt', 'sq ft', 1.25, 0, 1, 0, 23, ''],
  ['Blown-in fiberglass R-38 (attic)', 'blown', 'bag', 38, 0, 55, 0, 38, 'Coverage per bag depends on R-value; check the bag label.']
];
export const DEFAULT_SETTINGS = {crewSize: 2, galPerDay: 60, crewDayCost: 800, wastePct: 10, markupPct: 35, sqftPerDay: 1500, barrelGal: 45};

function seed(db, co) {
  if (!db.prepare('SELECT 1 FROM ins_materials WHERE company_id=? LIMIT 1').get(co)) for (const m of DEFAULT_MATERIALS) db.prepare('INSERT INTO ins_materials(company_id,name,kind,pack,unit_cost,pack_gal,pack_cover,r_per_inch,r_fixed,note) VALUES(?,?,?,?,?,?,?,?,?,?)').run(co, ...m);
  db.prepare('INSERT OR IGNORE INTO ins_settings(company_id) VALUES(?)').run(co);
}
const shapeMat = r => ({id: r.id, name: r.name, kind: r.kind, pack: r.pack, unitCost: r.unit_cost, packGal: r.pack_gal, packCover: r.pack_cover, rPerInch: r.r_per_inch, rFixed: r.r_fixed, note: r.note});
function settings(db, co) {
  const s = db.prepare('SELECT * FROM ins_settings WHERE company_id=?').get(co);
  return {crewSize: s.crew_size, galPerDay: s.gal_per_day, crewDayCost: s.crew_day_cost, wastePct: s.waste_pct, markupPct: s.markup_pct, sqftPerDay: s.sqft_per_day, barrelGal: s.barrel_gal};
}
export function listInsulation(db, owner) {
  seed(db, owner.companyId);
  return {materials: db.prepare('SELECT * FROM ins_materials WHERE company_id=? ORDER BY id').all(owner.companyId).map(shapeMat), settings: settings(db, owner.companyId)};
}
const num = (v, lo, hi, label) => { const n = Number(v); if (!(n >= lo && n <= hi)) fail(label + ' inválido.'); return n; };

export function calcInsulation(db, owner, b) {
  seed(db, owner.companyId);
  const st = settings(db, owner.companyId), waste = 1 + st.wastePct / 100, markup = 1 + st.markupPct / 100;
  const rows = [], items = []; let material = 0, labor = 0, days = 0;
  const mat = id => { const m = db.prepare('SELECT * FROM ins_materials WHERE id=? AND company_id=?').get(Number(id), owner.companyId); if (!m) fail('Material não encontrado.', 404); return m; };
  // One layer of one product over a net area.
  const layer = (m, net, inches) => {
    const foam = m.kind.startsWith('foam'), covered = net * waste * (foam ? inches : 1);   // board feet (foam) or sq ft
    const packs = covered / Math.max(m.pack_cover, 0.0001), gallons = foam ? packs : 0;
    const mc = packs * m.unit_cost, crewDays = foam ? gallons / Math.max(st.galPerDay, 1) : net / Math.max(st.sqftPerDay, 1), lab = crewDays * st.crewDayCost;
    material += mc; labor += lab; days += crewDays;
    const r = foam ? round2(m.r_per_inch * inches) : m.r_fixed, cost = mc + lab;
    rows.push({material: m.name, kind: m.kind, sqft: round2(net), inches: foam ? round2(inches) : 0, r, boardFeet: foam ? round2(covered) : 0, gallons: round2(gallons), barrels: foam ? round2(gallons / st.barrelGal) : 0, packs: round2(packs), packLabel: m.pack, materialCost: round2(mc), crewDays: round2(crewDays), laborCost: round2(lab), cost: round2(cost), price: round2(cost * markup)});
    return {r, price: cost * markup, label: m.name + (foam ? ' ' + round2(inches) + '"' : '') + (r ? ' (R-' + r + ')' : '')};
  };
  for (const l of (Array.isArray(b.lines) ? b.lines : []).slice(0, 20)) {
    const gross = Number(l.sqft); if (!(gross > 0)) continue; if (gross > 1000000) fail('Área inválida.');
    const net = gross - Math.max(0, Number(l.openings) || 0); if (!(net > 0)) fail('As aberturas não podem ser maiores que a área.');
    const first = mat(l.materialId), parts = [];
    if (first.kind.startsWith('foam')) parts.push(layer(first, net, num(l.inches, 0.25, 24, 'Espessura')));
    else parts.push(layer(first, net, 0));
    if (l.hybridId) { // hybrid: the second foam (open cell) fills what is left of the target R after the first layer
      const second = mat(l.hybridId), target = num(l.targetR, 1, 100, 'R-value alvo'); if (!second.kind.startsWith('foam') || second.r_per_inch <= 0) fail('Escolha uma espuma com R por polegada.');
      const left = target - parts[0].r; if (left > 0) parts.push(layer(second, net, left / second.r_per_inch));
    }
    const total = parts.reduce((t, p) => t + p.price, 0);
    items.push({description: parts.map(p => p.label).join(' + ') + ' — installed, per sq ft', qty: round2(net), price: round2(total / net)});
  }
  const cost = material + labor, price = cost * markup;
  return {rows, items, totals: {materialCost: round2(material), laborCost: round2(labor), crewDays: round2(days), cost: round2(cost), price: round2(price), profit: round2(price - cost), margin: price > 0 ? round2((price - cost) / price * 100) : 0}, settings: st};
}

export function insulationAction(db, owner, b) {
  seed(db, owner.companyId);
  if (b.op === 'calc') return calcInsulation(db, owner, b);
  if (b.op === 'settings') {
    const v = [Math.round(num(b.crewSize, 1, 20, 'Equipe')), num(b.galPerDay, 1, 5000, 'Galões por dia'), num(b.crewDayCost, 0, 100000, 'Custo do dia'), num(b.wastePct, 0, 100, 'Desperdício'), num(b.markupPct, 0, 500, 'Markup'), num(b.sqftPerDay, 1, 100000, 'Produtividade'), num(b.barrelGal || 45, 1, 500, 'Galões por barril')];
    db.prepare('UPDATE ins_settings SET crew_size=?,gal_per_day=?,crew_day_cost=?,waste_pct=?,markup_pct=?,sqft_per_day=?,barrel_gal=? WHERE company_id=?').run(...v, owner.companyId); return {ok: true};
  }
  if (b.op === 'save') {
    const name = clean(b.name, 120); if (!name) fail('Informe o nome do material.'); if (!KINDS.includes(b.kind)) fail('Tipo inválido.');
    const foam = b.kind.startsWith('foam');
    const v = [name, b.kind, clean(b.pack, 60) || (foam ? 'set' : 'pack'), num(b.unitCost, 0, 1000000, 'Preço'), foam ? 1 : 0, num(b.packCover, 0.01, 10000000, 'Rendimento'), foam ? num(b.rPerInch, 0, 20, 'R por polegada') : 0, foam ? 0 : num(b.rFixed || 0, 0, 100, 'R-value'), clean(b.note, 300)];
    if (b.id) { if (!db.prepare('UPDATE ins_materials SET name=?,kind=?,pack=?,unit_cost=?,pack_gal=?,pack_cover=?,r_per_inch=?,r_fixed=?,note=? WHERE id=? AND company_id=?').run(...v, Number(b.id), owner.companyId).changes) fail('Material não encontrado.', 404); return {id: Number(b.id)}; }
    return {id: Number(db.prepare('INSERT INTO ins_materials(company_id,name,kind,pack,unit_cost,pack_gal,pack_cover,r_per_inch,r_fixed,note) VALUES(?,?,?,?,?,?,?,?,?,?)').run(owner.companyId, ...v).lastInsertRowid)};
  }
  if (b.op === 'delete') { db.prepare('DELETE FROM ins_materials WHERE id=? AND company_id=?').run(Number(b.id), owner.companyId); return {ok: true}; }
  if (b.op === 'reset') { db.prepare('DELETE FROM ins_materials WHERE company_id=?').run(owner.companyId); db.prepare('DELETE FROM ins_settings WHERE company_id=?').run(owner.companyId); seed(db, owner.companyId); return {ok: true}; }
  fail('Operação inválida.');
}
