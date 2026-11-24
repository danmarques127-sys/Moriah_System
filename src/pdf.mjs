// Tiny dependency-free PDF writer (Helvetica, A4-ish letter pages) used for customer estimates.
const esc = s => String(s ?? '').replace(/[^\x20-\x7e]/g, c => ({'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ã': 'a', 'õ': 'o', 'ç': 'c', 'à': 'a', 'ê': 'e', 'â': 'a', 'ô': 'o', 'ü': 'u'}[c] || '?')).replace(/([\\()])/g, '\\$1');
const money = v => '$' + Number(v || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const wrap = (text, n) => { const out = []; for (const para of String(text || '').split(/\r?\n/)) { let line = ''; for (const w of para.split(/\s+/)) { if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); } out.push(line); } return out; };

export function makePdf(lines) { // lines: [{text, size?, bold?, x?, gap?}]
  const pages = [[]]; let y = 740;
  for (const l of lines) {
    const size = l.size || 11, gap = l.gap ?? size + 5;
    if (y - gap < 60) { pages.push([]); y = 740; }
    for (const c of (l.cols || [l])) pages.at(-1).push('BT /' + ((c.bold ?? l.bold) ? 'F2' : 'F1') + ' ' + size + ' Tf ' + (c.x || 50) + ' ' + y + ' Td (' + esc(c.text) + ') Tj ET');
    y -= gap;
  }
  const objs = [], add = s => objs.push(s) && objs.length;
  add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); // pages filled below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids = [];
  for (const p of pages) {
    const content = p.join('\n'), c = add('<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream');
    kids.push(add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + c + ' 0 R >>') + ' 0 R');
  }
  objs[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
  let out = '%PDF-1.4\n', offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out);
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(out, 'latin1');
}

export function estimatePdf(est, company) {
  const L = [{text: company || 'Estimate', size: 20, bold: true, gap: 28}, {text: 'ESTIMATE', size: 12, bold: true, gap: 20}, {text: 'Date: ' + new Date().toLocaleDateString('en-US', {timeZone: 'America/New_York'}), gap: 16},
    {text: 'Prepared for: ' + (est.prospectName || ''), gap: 14}, {text: est.prospectEmail || '', gap: 14}, {text: 'Job address: ' + est.address + ', ' + est.city + ', ' + est.state, gap: 26}, ];
  L.push({cols: [{text: 'Qty', x: 50}, {text: 'Item', x: 90}, {text: 'Unit price', x: 400}, {text: 'Amount', x: 490}], bold: true, size: 10, gap: 16});
  for (const it of est.lineItems) {
    const d = wrap(it.description, 62);
    L.push({cols: [{text: String(it.qty), x: 50}, {text: d[0] || '', x: 90}, {text: money(it.price), x: 400}, {text: money(it.qty * it.price), x: 490}], size: 10, gap: 13});
    for (const extra of d.slice(1)) L.push({text: extra, x: 90, size: 10, gap: 13});
    L.push({text: '', size: 4, gap: 6});
  }
  if (!est.lineItems.length && est.description) for (const d of wrap(est.description, 90)) L.push({text: d, size: 10, gap: 13});
  L.push({text: '', gap: 10}, {cols: [{text: 'Subtotal', x: 360}, {text: money(est.subtotal), x: 490}], gap: 15});
  if (est.taxRate > 0) L.push({cols: [{text: 'Sales tax (' + est.taxRate + '%)', x: 360}, {text: money(est.tax), x: 490}], gap: 15});
  L.push({cols: [{text: 'TOTAL', x: 360}, {text: money(est.total), x: 490}], size: 12, bold: true, gap: 28}, {text: 'Thank you for the opportunity. Reply to the e-mail that came with this estimate with any questions.', size: 9});
  return makePdf(L);
}
