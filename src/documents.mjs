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
export const clean = v => decode(String(v ?? '').replace(/<[^>]*>/g, ' ')).replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
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
  let pos = 0, year = '';
  for (const m of source.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    // The year heading above a link (e.g. "2026" over "3rd Quarter") is the year of that link.
    const between = [...clean(source.slice(pos, m.index)).matchAll(/(?<!\d)(20\d{2})(?!\d)/g)];
    if (between.length) year = between.at(-1)[1];
    pos = m.index + m[0].length;
    const raw = decode(m[1] ?? m[2] ?? '').trim();
    if (!raw || /^(?:#|javascript:|mailto:|tel:)/i.test(raw)) continue;
    let href; try { href = new URL(raw, base).href; } catch { continue; }
    out.push({href, text: clean(m[3]), ctx: year});
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
export function toIso(v) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : '';
  const s = String(v ?? ''), a = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (a) return iso(Number(a[1]), Number(a[2]), Number(a[3]));
  const b = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  return b ? iso(b[3].length === 2 ? 2000 + Number(b[3]) : Number(b[3]), Number(b[1]), Number(b[2])) : '';
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
  if (!issued && cfg.dateFallback === 'month-start') issued = month + '-01';
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
  return {number: cur.number, issued, address: clean(fields.address || ''), description, type: clean(fields.type || ''), value: fields.value || 0,
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
  number: /(?:record|permit|application)\s*(?:#|no\.?|number)|^permit$|^number$/i,
  issued: /issue[ds]?\s*date|date\s*issued|^issued$/i,
  dateAlt: /date\s*(?:paid|submitted|filed|applied)|^date$/i,
  address: /^(?:full\s*)?address|^location|^site\s*address/i,
  streetNo: /street\s*(?:no|#|num)|house\s*#/i,
  street: /^street(?:\s*name)?$/i,
  description: /description|scope|purpose|permit\s*for|brief|work\s*being/i,
  type: /(?:record|permit|work|building)\s*type|category|^title$|^type$/i,
  value: /cost|valuation|value|estimate/i,
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
    const issued = toIso(get(r, 'issued')) || toIso(get(r, 'dateAlt')) || (cfg.dateFallback === 'month-start' ? month + '-01' : '');
    const address = col.address !== undefined ? get(r, 'address') : [get(r, 'streetNo'), get(r, 'street')].filter(Boolean).join(' ');
    out.push({number, issued, address: clean(address), description: clean(get(r, 'description')), type: clean(get(r, 'type')), value: amount(get(r, 'value')),
      contractor: clean(get(r, 'contractor')), applicant: clean(get(r, 'applicant')), status: clean(get(r, 'status')), raw: r.join(' ')});
  }
  return out;
}

/* ---------- CSV (rows, so title lines above the header are tolerated) ---------- */
export function csvRows(input) {
  const text = String(input).replace(/^﻿/, ''), rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
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
async function parseDocument(doc, cfg, month, deps = {}) {
  const format = detectFormat(doc);
  if (format === 'pdf') { const text = await (deps.pdfToText || pdfToText)(doc.buffer); return withPeek(parseTextRows(text, cfg, month), text); }
  if (format === 'docx') { const text = docxToText(doc.buffer); return withPeek(parseTextRows(text, cfg, month), text); }
  if (format === 'xlsx') {
    const sheets = readXlsx(doc.buffer), named = sheets.filter(s => periodMatches(s.name, month, 'month') || new RegExp('^0?' + Number(month.slice(5)) + '[-/ .]').test(s.name));
    return (named.length ? named : sheets).flatMap(s => mapStructured(s.rows, cfg, month));
  }
  const text = format === 'html' ? htmlToText(doc.buffer.toString('utf8')) : doc.buffer.toString('utf8').replace(/^﻿/, '');
  if (format === 'text' && cfg.parser !== 'text' && /,/.test(text.split(/\r?\n/, 1)[0])) {
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
    contractor: row.contractor === 'N/A' ? '' : row.contractor, applicant: row.applicant, sourceUrl: url, status: row.status};
}
export async function collectDocuments(source, month, deps = {}) {
  const cfg = source.collector || {}, scope = cfg.scope || 'month', latest = scope === 'latest';
  const hosts = [new URL(source.url).hostname, ...(source.allowedHosts || [])];
  const net = {hosts, fetchImpl: deps.fetch}, pause = deps.sleep || sleep, allowedHost = h => hosts.some(x => bare(x) === bare(h));
  const label = month.slice(5) + '/' + month.slice(0, 4), notes = [], skippedHosts = new Set();
  let candidates, anchors = [];
  if (cfg.fileUrls) candidates = cfg.fileUrls.map(href => ({href, text: '', own: true, rank: 0}));
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
      const a = /(?<!\d)20\d{2}(?!\d)/.test(raw.text + ' ' + slugOf(raw.href)) || !raw.ctx ? raw : {...raw, text: raw.text + ' ' + raw.ctx};
      const hay = a.text + ' ' + decodeURIComponent(a.href.replace(/%(?![0-9a-f]{2})/gi, ''));
      // itemPages: each period is a small page of the site that holds the file (followed below), not a file link.
      if ((!fileLike(a.href) && !(cfg.itemPages && a.text && !latest)) || (filter && !filter.test(hay)) || (!latest && !matchesPeriod(hay))) continue;
      const host = new URL(a.href).hostname;
      if (!allowedHost(host)) { skippedHosts.add(host); continue; }
      if (cfg.textEquals && a.text.trim() !== cfg.textEquals.replace('{year}', month.slice(0, 4))) continue;
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
    let doc = await fetchBinary(a.href, net), evidence = a.href; await pause(300);
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
  const list = [...records.values()], proxyNote = cfg.dateKind && cfg.dateKind !== 'issued' ? ' A data usada é a de ' + ({paid: 'pagamento', submitted: 'submissão', range: 'período do relatório'}[cfg.dateKind] || cfg.dateKind) + ', não a de emissão.' : '';
  const message = files + ' documento(s) lido(s); ' + list.length + ' registro(s) em ' + label + '.' + (cfg.verified ? '' : ' Layout ainda não validado contra o documento real: conferir contagem e descrições.') + proxyNote + (notes.length ? ' ' + notes.slice(0, 2).join(' ') : '');
  return {status: cfg.verified && list.length ? 'complete' : 'partial', records: list, message};
}

/* ---------- manual upload (admin): same readers as the collectors, but the file comes from the operator ---------- */
export async function parseUploadedFile({buffer, source, month, deps = {}}) {
  const cfg = source.collector || {}, doc = {buffer, contentType: '', url: source.url};
  const rows = await parseDocument(doc, cfg, month, deps);
  if (!rows.length) throw new Error('Nenhuma linha de permit reconhecida neste arquivo (PDF digitalizado, planilha sem cabeçalho de permits ou layout diferente). Converta para CSV ou use a importação JSON.');
  const records = [], dates = []; let outside = 0, undated = 0;
  for (const row of rows) {
    if (!row.issued) { undated++; continue; }
    dates.push(row.issued);
    const rec = toRecord(source, row, month, cfg, source.url);
    if (rec) records.push(rec); else outside++;
  }
  dates.sort();
  return {format: detectFormat(doc), rowsRead: rows.length, records: [...new Map(records.map(r => [r.id, r])).values()], outside, undated, range: dates.length ? {from: dates[0], to: dates.at(-1)} : null};
}
