// Accela Citizen Access (ACA) collector: fills the public "General Search" date range like a person would,
// reads the results grid and pages through it. No browser needed (ASP.NET form posts + session cookie).
// It stops with a clear error on CAPTCHA, login walls or an unrecognized page; it never tries to get around them.
import {clean, decode, toIso, toRecord} from './documents.mjs';
import {monthsBetween} from './radar.mjs';

const UA = 'PermitFinder/1.0 municipal public records';
const bare = h => String(h).toLowerCase().replace(/^www\./, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CAPTCHA = /recaptcha|g-recaptcha|captcha|hcaptcha/i;
const CO = /certificate of (?:occupancy|completion)/i;

const attrs = tag => Object.fromEntries([...tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? '')]));

/** All values a browser would submit for the page's form (hidden state, text boxes, selects), minus buttons. */
export function formFields(html) {
  const fields = new Map();
  for (const m of String(html).matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!a.name) continue;
    const type = (a.type || 'text').toLowerCase();
    if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) continue;
    if ((type === 'checkbox' || type === 'radio') && !('checked' in a) && !/\schecked\b/i.test(m[0])) continue;
    fields.set(a.name, a.value ?? '');
  }
  for (const m of String(html).matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = attrs('<x ' + m[1] + '>');
    if (!a.name) continue;
    const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(o => ({a: attrs('<x ' + o[1] + '>'), selected: /\sselected\b/i.test(o[1]), text: clean(o[2])}));
    const chosen = options.find(o => o.selected) || options[0];
    fields.set(a.name, chosen ? (chosen.a.value ?? chosen.text) : '');
  }
  return fields;
}
export function postbackTargets(html) {
  const text = decode(html), out = [];
  for (const m of text.matchAll(/__doPostBack\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g)) out.push({target: m[1], arg: m[2]});
  for (const m of text.matchAll(/WebForm_PostBackOptions\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/g)) out.push({target: m[1], arg: m[2]});
  return out;
}

class Session {
  constructor(hosts, fetchImpl, pause) { this.allowed = new Set(hosts.map(bare)); this.fetch = fetchImpl || globalThis.fetch; this.jar = new Map(); this.pause = pause; }
  async request(url, form) {
    let target = url, method = form ? 'POST' : 'GET', body = form ? new URLSearchParams([...form.entries()]).toString() : undefined;
    for (let i = 0; i < 8; i++) {
      const u = new URL(target);
      if (u.protocol !== 'https:') throw new Error('Fonte deve usar HTTPS.');
      if (!this.allowed.has(bare(u.hostname))) throw new Error('Redirecionamento para domínio não revisado (' + u.hostname + ').');
      const headers = {'User-Agent': UA, Accept: 'text/html,*/*'};
      if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => k + '=' + v).join('; ');
      if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const r = await this.fetch(target, {method, body, redirect: 'manual', signal: AbortSignal.timeout(45000), headers});
      for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(';')[0], at = kv.indexOf('='); if (at > 0) this.jar.set(kv.slice(0, at).trim(), kv.slice(at + 1).trim()); }
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { target = new URL(r.headers.get('location'), target).href; method = 'GET'; body = undefined; continue; }
      if (!r.ok) throw new Error('Fonte respondeu HTTP ' + r.status + '. Não houve tentativa de contornar a restrição.');
      const html = await r.text();
      if (html.length > 12000000) throw new Error('Documento muito grande.');
      return {html, url: target};
    }
    throw new Error('Redirecionamentos excessivos.');
  }
}

const HEADS = {date: /^date$|opened|file date|application date/i, number: /record number|permit number|^record$/i, type: /record type|permit type|^type$/i, address: /^address|location/i, status: /^status/i, description: /^description|^scope|work description/i, project: /project name/i};
export function parseResults(html) {
  const table = String(html).match(/<table\b[^>]*id="[^"]*gdvPermitList[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  const total = Number((String(html).match(/(?:showing|results?)\s*\d+\s*-\s*\d+\s*of\s*([\d,]+)/i) || [])[1]?.replace(/,/g, '')) || null;
  if (!table) {
    if (/no (?:matching )?(?:records|results)|0 results|no records found/i.test(html)) return {rows: [], total: 0};
    throw new Error('Tabela de resultados do Accela não reconhecida (a página mudou ou a busca não retornou a lista).');
  }
  const trs = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  let heads = null; const rows = [];
  for (const tr of trs) {
    const ths = [...tr.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => clean(m[1]));
    if (ths.length >= 3 && !heads) { heads = ths; continue; }
    const tds = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
    if (!heads || tds.length < 3 || /Page\$/.test(tr)) continue;
    const col = {}; for (const [k, re] of Object.entries(HEADS)) { const i = heads.findIndex((h, j) => re.test(h) && !Object.values(col).includes(j)); if (i >= 0) col[k] = i; }
    if (col.number === undefined) throw new Error('Coluna de número do permit não encontrada nos resultados. Colunas vistas: ' + heads.join(' | '));
    const get = k => col[k] === undefined ? '' : tds[col[k]] ?? '';
    if (get('number')) rows.push({number: get('number'), issued: toIso(get('date')), address: get('address'), description: get('description') || get('project'), type: get('type'), value: 0, contractor: '', applicant: '', status: get('status'), raw: tds.join(' ')});
  }
  return {rows, total};
}

export async function collectAccela(source, month, deps = {}) {
  monthsBetween(month, month);
  const cfg = source.collector || {}, hosts = [new URL(source.url).hostname, ...(source.allowedHosts || [])], pause = deps.sleep || sleep;
  const [y, m] = month.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate(), mdy = d => String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0') + '/' + y;
  const s = new Session(hosts, deps.fetch, pause), home = await s.request(source.url);
  if (CAPTCHA.test(home.html)) throw new Error('O portal exige CAPTCHA. Não há tentativa de contornar: importe o relatório pelo botão de arquivo.');
  const fields = formFields(home.html), names = [...fields.keys()];
  const start = names.find(n => /txtGSStartDate$/i.test(n)), end = names.find(n => /txtGSEndDate$/i.test(n));
  if (!start || !end) throw new Error('Estrutura do portal Accela mudou: campos de data da busca não encontrados. Campos vistos: ' + names.filter(n => !n.startsWith('__')).slice(0, 12).join(', '));
  fields.set(start, mdy(1)); fields.set(end, mdy(last));
  const search = postbackTargets(home.html).find(t => /btnNewSearch/i.test(t.target));
  if (!search) throw new Error('Botão de busca do Accela não encontrado na página.');
  fields.set('__EVENTTARGET', search.target); fields.set('__EVENTARGUMENT', search.arg || '');
  let page = await s.request(home.url, fields);
  const rows = [], seenFirst = new Set(); let total = null;
  for (let n = 1; n <= (cfg.maxPages || 80); n++) {
    if (CAPTCHA.test(page.html)) throw new Error('O portal exige CAPTCHA. Não há tentativa de contornar: importe o relatório pelo botão de arquivo.');
    if (/\/login\.aspx/i.test(page.url)) throw new Error('O portal exige login para listar os resultados. Não há tentativa de contornar: importe o relatório pelo botão de arquivo.');
    const parsed = parseResults(page.html);
    if (parsed.rows[0] && seenFirst.has(parsed.rows[0].number)) break; // pager returned the same page: stop
    if (parsed.rows[0]) seenFirst.add(parsed.rows[0].number);
    rows.push(...parsed.rows); total = parsed.total ?? total;
    const targets = postbackTargets(page.html), next = targets.find(t => t.arg === 'Page$' + (n + 1)) || targets.find(t => /^Page\$Next$/i.test(t.arg));
    if (!next) break;
    const f = formFields(page.html); f.set('__EVENTTARGET', next.target); f.set('__EVENTARGUMENT', next.arg);
    await pause(500); page = await s.request(page.url, f);
  }
  const wanted = new Set(), records = [];
  for (const row of rows) {
    if (CO.test(row.type)) continue;
    const rec = toRecord(source, row, month, {dateKind: cfg.dateKind || 'submitted'}, source.url);
    if (rec && !wanted.has(rec.id)) { wanted.add(rec.id); records.push(rec); }
  }
  const complete = total === null || rows.length >= total;
  const label = month.slice(5) + '/' + month.slice(0, 4);
  return {status: cfg.verified && complete ? 'complete' : 'partial', records,
    message: rows.length + ' linha(s) lida(s)' + (total !== null ? ' de ' + total : '') + ' na busca do portal; ' + records.length + ' registro(s) em ' + label + '. A data do portal é a de abertura do pedido (não a de emissão).' + (complete ? '' : ' A lista veio incompleta: conferir.') + (cfg.verified ? '' : ' Layout ainda não validado contra o portal real: conferir contagem.')};
}
