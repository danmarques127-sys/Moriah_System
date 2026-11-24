// Document-based collectors: find the monthly report on a municipal page, download it
// (PDF / XLSX / CSV / HTML), extract rows deterministically (no AI) and normalize them.
// Nothing here bypasses CAPTCHA, logins or HTTP 403: such responses fail the job visibly.
import {execFile} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {UPLOAD_CONFIGS} from './source-configs.mjs';

const exec = promisify(execFile);
const MAX_BYTES = 25000000;
const UA = 'PermitFinder/1.0 municipal public records';
const FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ALL_TOKENS = [...FULL, ...SHORT, 'sept'].join('|');
const bare = h => String(h).toLowerCase().replace(/^www\./, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const decode = s => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => Number(n) < 1114112 ? String.fromCodePoint(Number(n)) : ' ');
// Text from some PDFs arrives as UTF-8 read as Latin-1 ("Â" before a space, "â€™"); repair the common cases.
export const fixMojibake = s => String(s).replace(/\u00c2(?=[\s\u00a0.,;:)\-]|$)/g, '').replace(/\u00c2\u00a0/g, ' ').replace(/\u00e2\u20ac\u2122/g, "'").replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\u009d/g, '"').replace(/\u00e2\u20ac\u201c/g, '-');
export const clean = v => fixMojibake(decode(String(v ?? '').replace(/<[^>]*>/g, ' '))).replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
const amount = v => Math.max(0, Number(String(v ?? 0).replace(/[^0-9.]/g, '')) || 0);

/* ---------- period matching (month / quarter / year / fiscal year) ---------- */
function monthRe(m, y) {
  const toks = [FULL[m - 1], SHORT[m - 1]];
  if (m === 9) toks.push('sept');
  return new RegExp('(?<![a-z])(?:' + toks.join('|') + ')[a-z]*\\.?(?:[^0-9]{1,14}(?:' + ALL_TOKENS + ')[a-z]*\\.?)?[^0-9a-z]{0,14}(?:\\d{1,2}[^0-9a-z]{1,3})?(?:' + y + ')(?!\\d)');
}
export function periodMatches(text, month, scope = 'month') {
  const [y, m] = month.split('-').map(Number), t = String(text).toLowerCase();
  if (scope === 'year') return new RegExp('(?<!\\d)' + y + '(?!\\d)').test(t);
  if (scope === 'fiscal') {
    const yy = String(m >= 7 ? y + 1 : y).slice(2);
    return new RegExp("fy\\s*'?(?:20)?" + yy + '(?!\\d)|fiscal\\s*year\\s*(?:20)?' + yy + '(?!\\d)').test(t);
  }
  if (scope === 'quarter') {
    const q = Math.ceil(m / 3), word = ['first', 'second', 'third', 'fourth'][q - 1], ord = ['1st', '2nd', '3rd', '4th'][q - 1];
    const quarter = new RegExp('(?<![a-z0-9])q' + q + '(?![0-9])|(?:' + word + '|' + ord + ')[ -]*quarter').test(t);
    return (quarter && new RegExp('(?<!\\d)' + y + '(?!\\d)').test(t)) || monthRe(m, y).test(t);
  }
  return monthRe(m, y).test(t);
}

/* ---------- HTML helpers ---------- */
export function extractAnchors(html, base) {
  const out = [], source = String(html);
  let pos = 0, year = '', monthName = '';
  for (const m of source.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    // The year heading above a link (e.g. "2026" over "3rd Quarter") is the year of that link.
    const between = [...clean(source.slice(pos, m.index)).matchAll(/(?<!\d)(20\d{2})(?!\d)/g)];
    if (between.length) year = between.at(-1)[1];
    const named = [...clean(source.slice(pos, m.index)).matchAll(new RegExp('(?<![A-Za-z])(' + FULL.join('|') + ')(?![A-Za-z])', 'gi'))];
    if (named.length) monthName = named.at(-1)[1];
    pos = m.index + m[0].length;
    const raw = decode(m[1] ?? m[2] ?? '').trim();
    if (!raw || /^(?:#|javascript:|mailto:|tel:)/i.test(raw)) continue;
    let href; try { href = new URL(raw, base).href; } catch { continue; }
    out.push({href, text: clean(m[3]), ctx: year, ctxMonth: monthName});
  }
  return out;
}
export const fileLike = href => /DocumentCenter\/View|resource-manager\/view|ViewFile|showpublisheddocument|Archive\.aspx\?(?:[^#]*&)?ADID=\d|\.(?:pdf|xlsx?|csv)(?:[?#]|$)|\/files\/|\/media\/|\/documents?\//i.test(href);
export function htmlToText(html) {
  return decode(String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(?:p|div|tr|li|h\d|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, '  ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[ \t\f\v]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/* ---------- network (HTTPS only, reviewed hosts only, size limited) ---------- */
const withDownload = u => { const x = new URL(u); if (/\.sharepoint\.com$/i.test(x.hostname) && !x.searchParams.has('download')) x.searchParams.set('download', '1'); return x.href; };
export async function fetchBinary(url, {hosts = [], fetchImpl, timeout = 45000} = {}) {
  const doFetch = fetchImpl || globalThis.fetch, start = new URL(withDownload(url));
  if (start.protocol !== 'https:') throw new Error('Fonte deve usar HTTPS.');
  const allowed = new Set([...hosts.map(bare), bare(start.hostname)]), jar = new Map();
  let target = start.href;
  for (let i = 0; i < 6; i++) {
    const headers = {'User-Agent': UA, Accept: '*/*'};
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; '); // cookies of this download only, like a browser following redirects
    const r = await doFetch(target, {redirect: 'manual', signal: AbortSignal.timeout(timeout), headers});
    for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(';')[0], at = kv.indexOf('='); if (at > 0) jar.set(kv.slice(0, at).trim(), kv.slice(at + 1).trim()); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const next = new URL(r.headers.get('location'), target);
      if (next.protocol !== 'https:' || !allowed.has(bare(next.hostname))) throw new Error('Redirecionamento para domínio não revisado (' + next.hostname + '). Revise a fonte antes de permitir.');
      target = next.href; continue;
    }
    if (!r.ok) throw new Error('Fonte respondeu HTTP ' + r.status + '. Não houve tentativa de contornar a restrição.');
    if (Number(r.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Documento excede o limite de coleta.');
    const buffer = Buffer.from(await r.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('Documento muito grande.');
    return {buffer, contentType: String(r.headers.get('content-type') || ''), url: target};
  }
  throw new Error('Redirecionamentos excessivos.');
}
export function detectFormat({buffer, contentType = ''}) {
  if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return buffer.includes('word/document.xml') ? 'docx' : 'xlsx';
  const head = buffer.toString('utf8', 0, 400).toLowerCase();
  if (/text\/html/.test(contentType) || head.includes('<html') || head.includes('<!doctype html')) return 'html';
  return 'text';
}

/* ---------- PDF (poppler's pdftotext, installed in the Docker image) ---------- */
export async function pdfToText(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'pf-pdf-'));
  try {
    const file = join(dir, 'doc.pdf');
    await writeFile(file, buffer);
    const {stdout} = await exec('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], {timeout: 90000, maxBuffer: 60000000});
    return stdout;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('pdftotext não encontrado no servidor. Instale poppler-utils (a imagem Docker já inclui).');
    throw new Error('Falha ao extrair texto do PDF: ' + String(e.message).slice(0, 200));
  } finally { await rm(dir, {recursive: true, force: true}); }
}

// Word positions per page (pdftotext -bbox), for wide tables where the text layout loses the columns.
export async function pdfWords(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'pf-pdf-'));
  try {
    const file = join(dir, 'doc.pdf');
    await writeFile(file, buffer);
    const {stdout} = await exec('pdftotext', ['-bbox', '-enc', 'UTF-8', file, '-'], {timeout: 90000, maxBuffer: 120000000});
    const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return stdout.split('<page ').slice(1).map(pg => ({
      height: Number((/height="([\d.]+)"/.exec(pg) || [])[1]) || 0,
      words: [...pg.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(m => ({x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], text: unesc(m[5])})),
    }));
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('pdftotext não encontrado no servidor. Instale poppler-utils (a imagem Docker já inclui).');
    throw new Error('Falha ao extrair texto do PDF: ' + String(e.message).slice(0, 200));
  } finally { await rm(dir, {recursive: true, force: true}); }
}
// Rows of a wide PDF table. Each row is found by its permit number; the other cells are vertically centred on it,
// and the (long) description is grouped by line gaps, then given to the nearest row.
export function bboxRows(pages, bbox) {
  const {anchor, columns} = bbox, re = new RegExp(anchor.pattern), inCol = (w, [a, b]) => w.x0 >= a - 2.5 && w.x0 < b;
  const join_ = ws => ws.sort((p, q) => Math.abs(p.y0 - q.y0) > 3 ? p.y0 - q.y0 : p.x0 - q.x0).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const page of pages) {
    const words = page.words.filter(w => w.y0 >= anchor.headerBottom && w.y0 < (anchor.footerTop || 1e9));
    const anchors = words.filter(w => inCol(w, anchor.number) && re.test(w.text)).map(w => ({number: w.text, y: (w.y0 + w.y1) / 2, cells: {}, desc: []}));
    if (!anchors.length) continue;
    const nearest = y => anchors.reduce((best, a) => Math.abs(a.y - y) < Math.abs(best.y - y) ? a : best, anchors[0]);
    const descWords = [];
    for (const w of words) {
      for (const [name, range] of Object.entries(columns)) {
        if (!inCol(w, range)) continue;
        if (name === 'description') { descWords.push(w); break; }
        const a = nearest((w.y0 + w.y1) / 2); (a.cells[name] ||= []).push(w); break;
      }
    }
    descWords.sort((p, q) => p.y0 - q.y0);
    const groups = []; let prev = -1e9;
    for (const w of descWords) { if (w.y0 - prev > 8.5 || !groups.length) groups.push([]); groups.at(-1).push(w); prev = Math.max(prev, w.y0); }
    for (const g of groups) { const c = (Math.min(...g.map(w => w.y0)) + Math.max(...g.map(w => w.y1))) / 2; nearest(c).desc.push(...g); }
    for (const a of anchors) {
      const get = n => join_(a.cells[n] || []);
      const issued = toIso(get('issued')), valueText = get('value').replace(/[$,]/g, '');
      out.push({number: a.number, issued, address: get('address'), type: get('type'), value: Number(valueText) || 0, description: join_(a.desc), contractor: get('contractor') || get('company'), applicant: get('owner'), status: '', raw: a.number + ' ' + get('issued') + ' ' + get('address')});
    }
  }
  // Rows cut by a page break are printed again on the next pages: keep the first (complete) copy.
  const seen = new Set();
  return out.filter(r => r.issued && !seen.has(r.number) && seen.add(r.number));
}


// Wide PDF tables whose text layout loses the columns: find the header band, split the page at the midpoints of the
// header labels, and read each cell by position. Used automatically when the line-based reader finds nothing.
const AUTO_LABELS = {
  number: /^(permit|record|application|case|file|permit\/license)?\s*(number|no\.?|#)$|^permit\s*(number|no\.?|#)|^record\s*#|^permit$/i,
  issued: /(date\s*issued|issue\s*date|issued|permit\s*date|date\s*of\s*issue|approval\s*date)/i,
  applied: /(application\s*date|date\s*submitted|submit|applied|filed)/i,
  address: /(address|location|site|premises|street)/i,
  type: /(permit\s*type|record\s*type|^type$|work\s*type|type\s*of\s*(work|improvement))/i,
  owner: /(owner|applicant)/i,
  contractor: /(contractor\s*name|^contractor$|builder|license)/i,
  description: /(description|scope|work\s*to\s*be|project\s*description|work\s*desc)/i,
  value: /(cost|valuation|value|estimated)/i,
};
const AUTO_VOCAB = /^(permit|date|number|no\.?|#|application|issued|issue|type|owner|address|legal|location|description|work|cost|valuation|value|contractor|applicant|parcel|class|fee|total|phone|record|status|close|of|construction|square|footage|company|expires?|submitted)$/i;
const NUMBER_TOKEN = /^[A-Z]{0,5}-?\d{2,4}-\d{2,7}[A-Z]?$/;
export function autoBboxConfig(pages) {
  for (const page of pages) {
    const tokens = page.words.filter(w => NUMBER_TOKEN.test(w.text) && /\d/.test(w.text));
    if (tokens.length < 3) continue;
    const groups = new Map(); for (const w of tokens) { const k = Math.round(w.x0 / 3); (groups.get(k) || groups.set(k, []).get(k)).push(w); }
    const col = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    if (col.length < 3 || col.length < tokens.length * 0.5) continue;
    const firstY = Math.min(...col.map(w => w.y0)), numX = [Math.min(...col.map(w => w.x0)) - 2, Math.max(...col.map(w => w.x1)) + 2];
    const cand = page.words.filter(w => w.y0 < firstY && AUTO_VOCAB.test(w.text)).sort((a, b) => a.y0 - b.y0);
    if (!cand.length) continue;
    const clusters = [[cand[0]]];
    for (const w of cand.slice(1)) { const c = clusters.at(-1); if (w.y0 - Math.max(...c.map(x => x.y1)) <= 4) c.push(w); else clusters.push([w]); }
    const best = clusters.sort((x, y) => y.length - x.length)[0], bottom = Math.max(...best.map(w => w.y1)), top = Math.min(...best.map(w => w.y0));
    const headerBottom = bottom + 1, header = page.words.filter(w => w.y0 >= top - 2 && w.y1 <= headerBottom + 1).sort((a, b) => a.x0 - b.x0);
    const cols = []; // merge header words stacked over each other into one label
    for (const w of header) { const c = cols.find(c => w.x0 <= c.x1 + 2.5 && w.x1 >= c.x0 - 2.5); if (c) { c.words.push(w); c.x0 = Math.min(c.x0, w.x0); c.x1 = Math.max(c.x1, w.x1); } else cols.push({x0: w.x0, x1: w.x1, words: [w]}); }
    cols.sort((a, b) => a.x0 - b.x0);
    for (const c of cols) { c.label = c.words.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map(w => w.text).join(' '); c.mid = (c.x0 + c.x1) / 2; }
    // Column borders: the emptiest vertical strip (fewest words crossing it) between two neighbouring header labels.
    const data = page.words.filter(w => w.y0 > headerBottom && w.y0 < (page.height ? page.height - 28 : 1e9));
    const valley = (l, r) => { let bestX = (l + r) / 2, bestN = 1e9, bestRun = 0; for (let x = l; x <= r; x += 1) { const n = data.filter(w => w.x0 - 0.5 < x && w.x1 + 0.5 > x).length; if (n < bestN) { bestN = n; bestX = x; bestRun = 1; } else if (n === bestN && bestRun) { bestX = (bestX * bestRun + x) / (bestRun + 1); bestRun++; } } return bestX; };
    const cuts = cols.slice(1).map((c, i) => valley(cols[i].mid, c.mid)), edges = cols.map((c, i) => [i ? cuts[i - 1] : 0, i < cuts.length ? cuts[i] : 1e9]);
    const columns = {}, used = new Set();
    const pick = (field, test) => { const i = cols.findIndex((c, i) => !used.has(i) && test(c.label)); if (i >= 0) { used.add(i); columns[field] = edges[i]; } };
    pick('issued', l => AUTO_LABELS.issued.test(l) && !AUTO_LABELS.applied.test(l));
    if (!columns.issued) pick('issued', l => AUTO_LABELS.applied.test(l));
    pick('type', l => AUTO_LABELS.type.test(l)); pick('address', l => AUTO_LABELS.address.test(l) && !/contractor/i.test(l)); pick('description', l => AUTO_LABELS.description.test(l));
    pick('contractor', l => AUTO_LABELS.contractor.test(l)); pick('owner', l => AUTO_LABELS.owner.test(l)); pick('value', l => AUTO_LABELS.value.test(l) && !/fee/i.test(l));
    if (!columns.issued || !columns.address) continue;
    return {anchor: {number: numX, pattern: NUMBER_TOKEN.source, headerBottom, footerTop: page.height ? page.height - 28 : 1e9}, columns, auto: true};
  }
  return null;
}

/* ---------- XLSX (minimal reader, no dependencies) ---------- */
export function unzip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Arquivo XLSX inválido.');
  const total = buf.readUInt16LE(e + 10), files = new Map();
  let p = buf.readUInt32LE(e + 16), budget = 120000000;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Arquivo XLSX corrompido.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + el + cl;
    budget -= usize; if (budget < 0) throw new Error('XLSX descompactado excede o limite.');
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.subarray(start, start + csize);
    files.set(name, method === 0 ? data : method === 8 ? inflateRawSync(data) : null);
  }
  return files;
}
const attr = (tag, name) => (tag.match(new RegExp('(?:^|[\\s:])' + name + '\\s*=\\s*"([^"]*)"')) || [])[1];
const colIndex = ref => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export function readXlsx(buf) {
  const files = unzip(buf), text = n => files.get(n)?.toString('utf8') || '';
  const rels = new Map();
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    let target = attr(m[0], 'Target') || ''; target = target.replace(/^\//, ''); if (!target.startsWith('xl/')) target = 'xl/' + target;
    rels.set(attr(m[0], 'Id'), target);
  }
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => decode([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  const sheets = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(attr(m[0], 'name') || ''), xml = text(rels.get(attr(m[0], 'id')) || ''), rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (!r[1]) continue;
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r'), type = attr(c[1], 't'), body = c[2] || '';
        let value = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (type === 's') value = shared[Number(value)];
        else if (type === 'inlineStr') value = decode([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (type === 'str' || type === 'e') value = decode(value ?? '');
        else if (value !== undefined && value !== '') value = Number(value);
        if (ref) row[colIndex(ref)] = value ?? '';
      }
      rows.push(Array.from(row, v => v ?? ''));
    }
    sheets.push({name, rows});
  }
  return sheets;
}

/* ---------- dates ---------- */
const DATE_G = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
function iso(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : '';
}
const MONTH_NAMES = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12};
export function toIso(v) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : '';
  const s = String(v ?? '').trim(), a = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (a) return iso(Number(a[1]), Number(a[2]), Number(a[3]));
  const ymd = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\s|T|$)/);
  if (ymd) return iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const b = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (b) return iso(b[3].length === 2 ? 2000 + Number(b[3]) : Number(b[3]), Number(b[1]), Number(b[2]));
  // Whole-value formats only (never picked out of free text).
  const y = (n) => n.length === 2 ? 2000 + Number(n) : Number(n);
  let m;
  if ((m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\s|T|$)/))) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = s.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{2}|\d{4})(?:\s|$)/))) return iso(y(m[3]), Number(m[1]), Number(m[2]));
  if ((m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})\.?[-\s/,]+(\d{2}|\d{4})(?:\s|$)/)) && MONTH_NAMES[m[2].slice(0, 4).toLowerCase()] || (m && MONTH_NAMES[m[2].slice(0, 3).toLowerCase()])) return iso(y(m[3]), MONTH_NAMES[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})(?:\s|$)/)) && MONTH_NAMES[m[1].slice(0, 3).toLowerCase()]) return iso(y(m[3]), MONTH_NAMES[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  if (/^\d{5}(\.\d+)?$/.test(s)) return toIso(Number(s));
  return '';
}
const datesIn = text => [...String(text).matchAll(DATE_G)].map(m => iso(Number(m[3]), Number(m[1]), Number(m[2]))).filter(Boolean);

/* ---------- text tables (pdftotext -layout / HTML) ---------- */
const NUM = /^((?:[A-Z]{1,6}-\d{2,4}-\d{1,7}|P-?\d{8,}))(?![A-Za-z0-9])[,.:;]?\s*/i;
const HEADER = /^(?:record\s*(?:#|no)|permit\s*(?:#|no|number)|page\s+\d+|printed|run date|date range|permits? listing|building permits? (?:issued|listing|report)|manager'?s|address\b.*\bfees?\b)/i;
const CO = /certificate of (?:occupancy|completion)|request for co\b/i;
const STREET = /\b(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|CT|COURT|PL|PLACE|BLVD|BOULEVARD|WAY|TER|TERRACE|CIR|CIRCLE|HWY|HIGHWAY|PKWY|PARKWAY|SQ|SQUARE|PARK|TRL|TRAIL|PATH|LOOP|ROW|XING|COMMON|WHARF)\b\.?(?:\s*(?:#|UNIT|APT)\s*\S+)?$/i;
const addrLike = c => { const a = c.split(',')[0].trim(); return /^\d+[A-Z]?(?:-\d+)?\s+\S/.test(a) && STREET.test(a); };
const strong = c => /^\$\s?\d[\d,]*(?:\.\d+)?$|^\d[\d,]*(?:\.\d+)?\s?\$$|^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(c);
const plain = c => /^\d{3,9}$/.test(c);

function heuristic(chunks, dateIdx) {
  const used = new Set(), r = {};
  if (dateIdx >= 0) used.add(dateIdx);
  for (let i = 0; i < chunks.length; i++) {
    if (used.has(i)) continue;
    if (addrLike(chunks[i])) { r.address = chunks[i].split(',')[0].trim(); const rest = chunks[i].split(',').slice(1).join(',').trim(); if (rest) r.applicant = rest; used.add(i); break; }
    if (/^\d{1,5}[A-Z]?$/.test(chunks[i]) && chunks[i + 1] && STREET.test(chunks[i + 1])) { r.address = chunks[i] + ' ' + chunks[i + 1]; used.add(i); used.add(i + 1); break; }
  }
  const after = i => dateIdx < 0 || i > dateIdx;
  let vi = chunks.findIndex((c, i) => !used.has(i) && after(i) && strong(c));
  if (vi < 0) vi = chunks.findIndex((c, i) => !used.has(i) && after(i) && plain(c));
  if (vi >= 0) { r.value = amount(chunks[vi]); used.add(vi); }
  chunks.forEach((c, i) => { if (!used.has(i) && strong(c)) used.add(i); });
  const ti = chunks.findIndex((c, i) => !used.has(i) && c.length < 140 && (dateIdx < 0 || i < dateIdx) && /permit|new construction|alteration|addition|demolition|renovation|license|new structure|repair/i.test(c));
  if (ti >= 0) { r.type = chunks[ti]; used.add(ti); }
  const left = chunks.map((c, i) => [c, i]).filter(([c, i]) => !used.has(i) && c.length >= 3);
  if (left.length) r.description = left.reduce((a, b) => b[0].length > a[0].length ? b : a)[0];
  return r;
}
function byRoles(chunks, roles) {
  const r = {}; let no = '', st = '';
  roles.forEach((role, i) => {
    const c = chunks[i]; if (!c) return;
    if (role === 'streetNo') no = c; else if (role === 'street') st = c;
    else if (role === 'value') r.value = amount(c);
    else if (role !== 'skip' && role !== 'date') r[role] = c;
  });
  if (no || st) r.address = (no + ' ' + st).trim();
  return r;
}
function finishRow(cur, cfg, month) {
  const dates = datesIn(cur.head);
  let issued = dates.length ? (cfg.dateWhich === 'last' ? dates.at(-1) : dates[0]) : '';
  let approx = false;
  if (!issued && cfg.dateFallback === 'month-start') { issued = month + '-01'; approx = true; }
  let chunks = cur.chunks.slice(), dateIdx = -1;
  const pick = cfg.dateWhich === 'last' ? [...chunks.keys()].reverse() : [...chunks.keys()];
  for (const i of pick) if (datesIn(chunks[i]).length) { dateIdx = i; break; }
  let fields;
  if (cfg.columns && chunks.length === cfg.columns.length) fields = byRoles(chunks, cfg.columns);
  else {
    // A date that shares its cell with other text (e.g. "2/27/2026 13:33 Juan Perez"): keep the remainder as a cell.
    if (dateIdx >= 0) {
      const rest = chunks[dateIdx].replace(DATE_G, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, ' ').replace(/^[\s,;|-]+|[\s,;|-]+$/g, '').replace(/\s+/g, ' ').trim();
      if (rest.length > 2) { chunks = chunks.slice(); chunks[dateIdx] = rest; dateIdx = -1; }
    }
    fields = heuristic(chunks, dateIdx);
  }
  const extra = cur.extra.join(' ');
  const description = clean([fields.description, extra].filter(Boolean).join(' '));
  return {number: cur.number, issued, approx, address: clean(fields.address || ''), description, type: clean(fields.type || ''), value: fields.value || 0,
    contractor: clean(fields.contractor || ''), applicant: clean(fields.applicant || ''), status: clean(fields.status || ''), raw: cur.head + ' ' + extra};
}
export function parseTextRows(text, cfg = {}, month = '') {
  const out = [], exclude = cfg.exclude ? new RegExp(cfg.exclude, 'i') : CO;
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const row = finishRow(cur, cfg, month); cur = null;
    if (exclude.test(row.raw)) return;
    if (cfg.numberPrefix && row.number && !new RegExp(cfg.numberPrefix, 'i').test(row.number)) return;
    if (cfg.requireStatus && !new RegExp(cfg.requireStatus, 'i').test(row.raw)) return;
    out.push(row);
  };
  for (const line of String(text).replace(/\f/g, '\n').split(/\r?\n/)) {
    const t = line.replace(/\t/g, '  ').trim();
    if (!t) continue;
    let m = t.match(NUM), lead = null;
    if (!m && cfg.leadDate) {
      // "10/1/2026 5:36  BR-26-545  Applicant ..." — the date comes first and the permit number second.
      const d = t.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?\s+/i);
      const n = d && t.slice(d[0].length).match(NUM);
      if (n) { m = n; lead = d[0]; }
    }
    if (!m && HEADER.test(t)) continue;
    const datedLine = !m && cfg.rowMode === 'dated-line' && datesIn(t).length > 0;
    if (m || datedLine) {
      flush();
      const rest = m ? t.slice((lead ? lead.length : 0) + m[0].length) : t;
      cur = {number: m ? m[1].toUpperCase() : '', head: t, chunks: rest.split(/\s{2,}/).map(s => s.trim()).filter(Boolean), extra: []};
    } else if (cur && cur.extra.length < 6 && datesIn(t).length === 0) cur.extra.push(t);
  }
  flush();
  return out;
}

/* ---------- structured tables (CSV / XLSX) ---------- */
const SYN = {
  number: /(?:record|permit|application|case|file|job)\s*(?:#|no\.?|num(?:ber)?|id)(?![a-z])|^permit$|^number$|^permit\s*id/i,
  issued: /issue[ds]?\s*(?:date|dt|on)|date\s*(?:issued|of\s*issue)|^issued$|permit\s*date|approv\w*\s*date|^issue$/i,
  dateAlt: /date\s*(?:paid|submitted|filed|applied)|^date$/i,
  address: /^(?:full\s*|property\s*|project\s*|job\s*|site\s*|street\s*|legal\s*|premise\w*\s*)?address(?!.*(?:contractor|mail|billing|owner|applicant|email|e-mail))|^location|^site$|^premises$|^property$/i,
  streetNo: /street\s*(?:no|#|num)|house\s*#/i,
  street: /^street(?:\s*name)?$/i,
  description: /description|scope|purpose|permit\s*for|brief|work\s*being/i,
  type: /(?:record|permit|work|building)\s*type|category|^title$|^type$/i,
  value: /^(?!.*fee)(?:.*)(?:cost|valuation|value|estimate|amount)/i,
  contractor: /contractor|gc\s*name|company|supervisor/i,
  applicant: /applicant|owner/i,
  status: /status/i
};
export function mapStructured(table, cfg = {}, month = '') {
  const rows = table.map(r => Array.isArray(r) ? r : Object.values(r));
  const hi = rows.findIndex(r => r.filter(c => String(c ?? '').trim()).length >= 3 && r.some(c => SYN.number.test(String(c).trim()) || SYN.issued.test(String(c).trim()) || SYN.dateAlt.test(String(c).trim())));
  if (hi < 0) return [];
  const headers = rows[hi].map(h => String(h ?? '').trim()), col = {};
  for (const [field, re] of Object.entries(SYN)) { const i = headers.findIndex((h, j) => h && re.test(h) && !Object.values(col).includes(j)); if (i >= 0) col[field] = i; }
  const get = (r, f) => col[f] === undefined ? '' : r[col[f]] ?? '';
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    if (r.every(c => !String(c ?? '').trim())) continue;
    const number = String(get(r, 'number')).trim();
    if (!number || number === headers[col.number]) continue;
    const exact = toIso(get(r, 'issued')) || toIso(get(r, 'dateAlt')), issued = exact || (cfg.dateFallback === 'month-start' ? month + '-01' : '');
    const address = col.address !== undefined ? get(r, 'address') : [get(r, 'streetNo'), get(r, 'street')].filter(Boolean).join(' ');
    out.push({number, issued, approx: !exact && !!issued, address: clean(address), description: clean(get(r, 'description')), type: clean(get(r, 'type')), value: amount(get(r, 'value')),
      contractor: clean(get(r, 'contractor')), applicant: clean(get(r, 'applicant')), status: clean(get(r, 'status')), raw: r.join(' ')});
  }
  return out;
}

/* ---------- CSV (rows, so title lines above the header are tolerated) ---------- */
// Comma, semicolon, tab or pipe: whichever splits the first lines most consistently (outside quotes).
export function detectDelimiter(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim()).slice(0, 12), score = {',': 0, ';': 0, '\t': 0, '|': 0};
  for (const l of lines) { const bare = l.replace(/"[^"]*"/g, ''); for (const d of Object.keys(score)) score[d] += (bare.split(d).length - 1); }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 3 ? best[0] : ',';
}
export function csvRows(input) {
  const text = String(input).replace(/^﻿/, ''), rows = [], delim = detectDelimiter(text);
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === delim && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows.map(r => r.map(x => x.trim()));
}

/* ---------- "newest file" ranking (year + month / quarter / half) ---------- */
const slugOf = href => { try { const last = decodeURIComponent(new URL(href).pathname.split('/').filter(Boolean).pop() || ''); return /^\d+$/.test(last) ? '' : last; } catch { return ''; } };
export function periodRank(text) {
  const t = String(text).toLowerCase(), years = [...t.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map(m => Number(m[1]));
  if (!years.length) return 0;
  let sub = 0;
  FULL.forEach((name, i) => { if (new RegExp('(?<![a-z])(?:' + name + '|' + SHORT[i] + (i === 8 ? '|sept' : '') + ')\\b').test(t)) sub = Math.max(sub, i + 1); });
  const q = t.match(/(?<![a-z0-9])q([1-4])(?!\d)/) || t.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)[ -]*quarter/);
  if (q) sub = Math.max(sub, 3 * (Number(q[1]) || ['first', 'second', 'third', 'fourth', '1st', '2nd', '3rd', '4th'].indexOf(q[1]) % 4 + 1));
  const h = t.match(/(?<![a-z0-9])h([12])(?!\d)/) || t.match(/\b(first|second|1st|2nd)[ -]*(?:half|semester)/) || t.match(/(?:half|semester)[ -]*([12])\b/);
  if (h) sub = Math.max(sub, 6 * (Number(h[1]) || (['first', '1st'].includes(h[1]) ? 1 : 2)));
  return Math.max(...years) * 100 + sub;
}

/* ---------- orchestration ---------- */
// Word documents: paragraphs become lines and table cells are separated by two spaces, like a PDF layout.
export function docxToText(buf) {
  const xml = unzip(buf).get('word/document.xml');
  if (!xml) throw new Error('Arquivo DOCX inválido.');
  return decode(xml.toString('utf8').replace(/<w:tab\/>/g, ' ').replace(/<\/w:tc>/g, '  ').replace(/<\/w:p>(?!\s*<\/w:tc>)/g, '\n').replace(/<\/w:tr>/g, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n');
}
// Keeps the first lines of what was read, so an unrecognized layout can be diagnosed from the error message alone.
const withPeek = (rows, text) => { rows.peek = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 4).map(l => l.slice(0, 110)).join(' ¶ '); return rows; };
async function parseDocument(doc, config, month, deps = {}) {
  // The file belongs to a known month: rows without their own date take the first day of that month (flagged as approximate).
  const cfg = config.dateFallback === undefined && (config.scope === 'month' || !config.scope) ? {...config, dateFallback: 'month-start'} : config;
  const format = detectFormat(doc);
  if (format === 'pdf' && cfg.parser === 'bbox') return bboxRows(await (deps.pdfWords || pdfWords)(doc.buffer), cfg.bbox);
  if (format === 'pdf') {
    const text = await (deps.pdfToText || pdfToText)(doc.buffer), rows = parseTextRows(text, cfg, month);
    if (rows.length) return withPeek(rows, text);
    try { const pages = await (deps.pdfWords || pdfWords)(doc.buffer), auto = autoBboxConfig(pages), found = auto ? bboxRows(pages, auto) : []; if (found.length) return found; } catch { /* fall through to the diagnostic below */ }
    return withPeek(rows, text);
  }
  if (format === 'docx') { const text = docxToText(doc.buffer); return withPeek(parseTextRows(text, cfg, month), text); }
  if (format === 'xlsx') {
    const sheets = readXlsx(doc.buffer), named = sheets.filter(s => periodMatches(s.name, month, 'month') || new RegExp('^0?' + Number(month.slice(5)) + '[-/ .]').test(s.name));
    return (named.length ? named : sheets).flatMap(s => mapStructured(s.rows, cfg, month));
  }
  const text = format === 'html' ? htmlToText(doc.buffer.toString('utf8')) : doc.buffer.toString('utf8').replace(/^﻿/, '');
  if (format === 'text' && cfg.parser !== 'text' && /[,;\t|]/.test(text.split(/\r?\n/, 4).join('\n'))) {
    const rows = mapStructured(csvRows(text), cfg, month);
    if (rows.length) return rows;
  }
  return withPeek(parseTextRows(text, cfg, month), text);
}
export function toRecord(source, row, month, cfg, url) {
  if (!row.issued || !row.issued.startsWith(month)) return null;
  const proxy = cfg.dateKind && cfg.dateKind !== 'issued', note = proxy ? ' [Data na fonte: ' + ({paid: 'pagamento', submitted: 'submissão', range: 'período do relatório'}[cfg.dateKind] || cfg.dateKind) + '; emissão exata não informada]' : '';
  const key = row.number || 'row-' + createHash('sha1').update(row.raw.replace(/\s+/g, ' ')).digest('hex').slice(0, 16);
  return {id: source.id + ':' + key, sourceId: source.id, city: source.city, state: source.state, address: row.address, number: row.number, issued: row.issued,
    description: (row.description || 'Descrição não disponibilizada; conferir o documento municipal.') + note, type: row.type, value: row.value || 0,
    contractor: row.contractor === 'N/A' ? '' : row.contractor, applicant: row.applicant, sourceUrl: url, status: row.status, ...(row.approx ? {dateApprox: true} : {})};
}
export async function collectDocuments(source, month, deps = {}) {
  const cfg = source.collector || {}, scope = cfg.scope || 'month', latest = scope === 'latest';
  const hosts = [new URL(source.url).hostname, ...(source.allowedHosts || [])];
  const net = {hosts, fetchImpl: deps.fetch}, pause = deps.sleep || sleep, allowedHost = h => hosts.some(x => bare(x) === bare(h));
  const label = month.slice(5) + '/' + month.slice(0, 4), notes = [], skippedHosts = new Set();
  let candidates, anchors = [];
  if (cfg.fileTemplates) {
    // Cities that publish one predictable file name per month: {Month} March, {month} march, {mm} 03, {year} 2026, {yy} 26.
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], mi = Number(month.slice(5)) - 1;
    const fill = tpl => tpl.replace(/\{Month\}/g, names[mi]).replace(/\{month\}/g, names[mi].toLowerCase()).replace(/\{mm\}/g, month.slice(5)).replace(/\{year\}/g, month.slice(0, 4)).replace(/\{yy\}/g, month.slice(2, 4));
    candidates = cfg.fileTemplates.map(tpl => ({href: fill(tpl), text: '', own: true, rank: 0}));
  } else if (cfg.fileUrls) candidates = cfg.fileUrls.map(href => ({href, text: '', own: true, rank: 0}));
  else {
    const lists = cfg.listUrls || [source.url], pages = [...lists], seen = new Set();
    let reached = 0;
    for (let i = 0; i < pages.length && i < 12; i++) {
      if (seen.has(pages[i])) continue; seen.add(pages[i]);
      let page;
      try { page = await fetchBinary(pages[i], net); } catch (e) {
        if (i === 0 && lists.length === 1) throw e;
        notes.push('Página não acessada (' + new URL(pages[i]).pathname + '): ' + String(e.message).slice(0, 120));
        // A page we only reached by crawling refused us: stop instead of insisting on more pages.
        if (i >= lists.length && /HTTP 40[13]/.test(e.message)) { notes.push('Rastreamento interrompido: o site bloqueia acesso automático a estas páginas.'); break; }
        continue;
      }
      reached++;
      const found = extractAnchors(page.buffer.toString('utf8'), page.url); anchors.push(...found);
      if (cfg.crawl && i < lists.length) {
        // Only follow links inside the same site section as the listing page (never the site-wide menu).
        const section = new URL(page.url).pathname.replace(/[^/]*$/, ''), deep = section.split('/').filter(Boolean).length >= 2;
        const re = cfg.crawlRe ? new RegExp(cfg.crawlRe, 'i') : /permit|building|report|archive|inspection/i;
        for (const a of found.filter(a => !fileLike(a.href) && allowedHost(new URL(a.href).hostname) && (!deep || new URL(a.href).pathname.startsWith(section)) && re.test(a.text + ' ' + a.href)).slice(0, cfg.crawlLimit || 3)) if (!seen.has(a.href)) pages.push(a.href);
      }
      await pause(300);
    }
    if (!reached) throw new Error('Nenhuma página de listagem acessível.');
    const filter = cfg.match ? new RegExp(cfg.match, 'i') : null, bySource = new Map();
    // Some cities name the file after the month it was published (the month after the permits), see cfg.fileLag.
    const [yy, mm] = month.split('-').map(Number), wanted = [month];
    if (cfg.fileLag) wanted.push(new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 7));
    const matchesPeriod = text => wanted.some(w => periodMatches(text, w, scope));
    if (cfg.inferYear) {
      // Lists of "October, September, ... January, December ..." without any year: the order tells the year (newest first).
      const now = (deps.now ? deps.now() : new Date()), monthOf = t => { const i = FULL.findIndex((f, k) => new RegExp('^(?:' + f + '|' + SHORT[k] + (k === 8 ? '|sept' : '') + ')\\.?$', 'i').test(t.trim())); return i + 1; };
      let year = now.getUTCFullYear(), prev = 0;
      for (const a of anchors) {
        const m = monthOf(a.text); if (!m) continue;
        if (!prev && m > now.getUTCMonth() + 1) year--; else if (prev && m > prev) year--;
        prev = m; a.ctx = String(year);
      }
    }
    for (const raw of anchors) {
      // A link without its own year ("October", "3rd Quarter") takes the year of the heading above it.
      let a = /(?<!\d)20\d{2}(?!\d)/.test(raw.text + ' ' + slugOf(raw.href)) || !raw.ctx ? raw : {...raw, text: raw.text + ' ' + raw.ctx};
      // monthHeading: the month is the heading above the link and the link text is only the year (Waltham).
      if (cfg.monthHeading && raw.ctxMonth && !new RegExp('(?<![A-Za-z])(?:' + FULL.join('|') + ')', 'i').test(raw.text)) a = {...raw, text: raw.ctxMonth + ' ' + raw.text};
      const hay = a.text + ' ' + decodeURIComponent(a.href.replace(/%(?![0-9a-f]{2})/gi, ''));
      // itemPages: each period is a small page of the site that holds the file (followed below), not a file link.
      if ((!fileLike(a.href) && !(cfg.itemPages && a.text && !latest)) || (filter && !filter.test(hay)) || (!latest && !matchesPeriod(hay))) continue;
      const host = new URL(a.href).hostname;
      if (!allowedHost(host)) { skippedHosts.add(host); continue; }
      if (cfg.textEquals && raw.text.trim() !== cfg.textEquals.replace('{year}', month.slice(0, 4))) continue;
      if (!bySource.has(a.href)) bySource.set(a.href, {...a, own: !latest && matchesPeriod(a.text), rank: periodRank(a.text + ' ' + slugOf(a.href))});
    }
    candidates = [...bySource.values()];
    if (latest) {
      // Newest period only (all files that share it, e.g. residential + commercial). Unrankable links keep page order.
      const top = Math.max(0, ...candidates.map(c => c.rank));
      if (top) candidates = candidates.filter(c => c.rank === top);
    } else candidates.sort((a, b) => Number(b.own) - Number(a.own));
    candidates = candidates.slice(0, cfg.maxFiles || (latest ? 4 : 3));
    if (!candidates.length) {
      // Say what the page DID offer, so a wrong match rule can be fixed from the job log alone.
      const seenFiles = [...new Map(anchors.filter(a => fileLike(a.href)).map(a => [a.href, a])).values()];
      const sample = seenFiles.length
        ? ' Arquivos vistos na página (' + seenFiles.length + '): ' + seenFiles.slice(0, 6).map(a => '«' + (a.text || a.href.split('/').pop()).slice(0, 60) + '»').join(' · ') + '.'
        : ' Nenhum link de arquivo encontrado na página (o conteúdo pode ser carregado por JavaScript).';
      return {status: 'pending', records: [], message: 'Relatório de ' + label + ' não publicado/localizado na página da cidade. Isso não significa zero permits.' + sample + (skippedHosts.size ? ' Links em domínio não revisado ignorados: ' + [...skippedHosts].join(', ') + '.' : '') + (notes.length ? ' ' + notes.slice(0, 2).join(' ') : '')};
    }
  }
  const records = new Map(), issuedDates = []; let parsedRows = 0, files = 0, lastPeek = '', undatedSample = '';
  for (const a of candidates) {
    let doc, evidence = a.href;
    try { doc = await fetchBinary(a.href, net); } catch (e) { if (cfg.fileTemplates && cfg.fileTemplates.length > 1) { notes.push('«' + a.href.split('/').at(-1) + '»: ' + String(e.message).slice(0, 80)); continue; } throw e; }
    await pause(300);
    if (cfg.followItems !== false && detectFormat(doc) === 'html') {
      // Item pages either link to the real file or show the table inline (then parse the page itself).
      const inner = extractAnchors(doc.buffer.toString('utf8'), doc.url).find(x => x.href !== a.href && /\.(?:pdf|xlsx?|csv)(?:[?#]|$)|DocumentCenter\/View|ViewFile|showpublisheddocument/i.test(x.href) && allowedHost(new URL(x.href).hostname));
      if (inner) { doc = await fetchBinary(inner.href, net); evidence = inner.href; await pause(300); }
    }
    const rows = await parseDocument(doc, cfg, month, deps); files++; parsedRows += rows.length; if (!rows.length) lastPeek = rows.peek || '';
    for (const row of rows) { if (row.issued) issuedDates.push(row.issued); else if (!undatedSample) undatedSample = String(row.raw || '').slice(0, 160); const rec = toRecord(source, row, month, cfg, evidence); if (rec && !records.has(rec.id)) records.set(rec.id, rec); }
  }
  if (!files) return {status: 'pending', records: [], message: 'Arquivo de ' + label + ' não pôde ser aberto. ' + notes.join(' ')};
  if (!parsedRows) throw new Error('Layout do documento não reconhecido (nenhuma linha de permit encontrada; o PDF pode ser digitalizado ou o formato mudou). Importe manualmente este mês.' + (lastPeek ? ' Início do que foi lido: ' + lastPeek : ' O arquivo não trouxe texto legível.'));
  if (!records.size) {
    issuedDates.sort();
    return {status: 'pending', records: [], message: files + ' documento(s) lido(s), mas nenhum permit emitido em ' + label + '.' + (issuedDates.length ? ' O que foi lido cobre ' + issuedDates[0] + ' a ' + issuedDates.at(-1) + '.' : ' As ' + parsedRows + ' linhas lidas não trazem data reconhecida. Exemplo de linha: «' + undatedSample + '»') + ' Pode não estar publicado ainda. Isso não significa zero permits.'};
  }
  const list = [...records.values()], approxCount = list.filter(r => r.dateApprox).length, proxyNote = cfg.dateKind && cfg.dateKind !== 'issued' ? ' A data usada é a de ' + ({paid: 'pagamento', submitted: 'submissão', range: 'período do relatório'}[cfg.dateKind] || cfg.dateKind) + ', não a de emissão.' : '';
  const message = files + ' documento(s) lido(s); ' + list.length + ' registro(s) em ' + label + '.' + (cfg.verified ? '' : ' Layout ainda não validado contra o documento real: conferir contagem e descrições.') + proxyNote + (approxCount ? ' ' + approxCount + ' permit(s) sem data própria usam o mês do arquivo (data aproximada).' : '') + (notes.length ? ' ' + notes.slice(0, 2).join(' ') : '');
  return {status: cfg.verified && list.length && !approxCount ? 'complete' : 'partial', records: list, message};
}

/* ---------- manual upload (admin): same readers as the collectors, but the file comes from the operator ---------- */
export async function parseUploadedFile({buffer, source, month, toMonth, deps = {}}) {
  const cfg = source.collector || UPLOAD_CONFIGS[source.id] || {}, doc = {buffer, contentType: '', url: source.url};
  const last = toMonth && toMonth > month ? toMonth : month, multi = last !== month;
  if (multi && (last.slice(0, 4) - month.slice(0, 4)) * 12 + Number(last.slice(5)) - Number(month.slice(5)) > 23) throw new Error('O período do arquivo pode ter no máximo 24 meses.');
  // One month: undated rows take that month (approximate). Several months: undated rows cannot be placed, so they are skipped.
  const rows = await parseDocument(doc, {...cfg, dateFallback: multi ? 'none' : 'month-start'}, month, deps);
  if (!rows.length) throw new Error('Nenhuma linha de permit reconhecida neste arquivo (PDF digitalizado, planilha sem cabeçalho de permits ou layout diferente). Converta para CSV ou use a importação JSON.');
  const records = [], dates = []; let outside = 0, undated = 0;
  for (const row of rows) {
    if (!row.issued) { undated++; continue; }
    dates.push(row.issued);
    const m = row.issued.slice(0, 7), rec = m >= month && m <= last ? toRecord(source, row, m, cfg, source.url) : null;
    if (rec) records.push(rec); else outside++;
  }
  dates.sort();
  const monthCounts = {}; for (const d of dates) monthCounts[d.slice(0, 7)] = (monthCounts[d.slice(0, 7)] || 0) + 1;
  const suggestedMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const unique = [...new Map(records.map(r => [r.id, r])).values()];
  return {suggestedMonth, fileFrom: dates[0] ? dates[0].slice(0, 7) : null, fileTo: dates.length ? dates.at(-1).slice(0, 7) : null, addresses: rows.slice(0, 300).map(r => String(r.address || '')), format: detectFormat(doc), approx: unique.filter(r => r.dateApprox).length, rowsRead: rows.length, records: unique, outside, undated, range: dates.length ? {from: dates[0], to: dates.at(-1)} : null};
}
