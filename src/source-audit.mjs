// Health check of the official source pages (issue #2). Read-only: one polite GET per page, no login, no CAPTCHA, no workaround of blocks.
import {timestamp} from './db.mjs';
const bare = h => String(h).replace(/^www\./, '');

export async function checkSource(source, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(source.url, {redirect: 'manual', signal: AbortSignal.timeout(12000), headers: {'User-Agent': 'MoriahSystem-SourceCheck/1.0', Accept: 'text/html,*/*'}});
  } catch (e) {
    return {ok: false, status: 0, note: 'Não respondeu: ' + String(e.message || e).slice(0, 120)};
  }
  const status = res.status;
  if (status >= 300 && status < 400) {
    const to = res.headers.get('location') || '';
    let host = ''; try { host = new URL(to, source.url).hostname; } catch { /* ignore */ }
    const same = host && bare(host) === bare(new URL(source.url).hostname);
    return {ok: same, status, note: same ? 'Redireciona dentro do mesmo site.' : 'Redireciona para outro site (' + (host || 'desconhecido') + '). Revise a fonte.'};
  }
  if (status === 403 || status === 401) return {ok: false, status, note: 'O site bloqueia acesso automático (HTTP ' + status + '). Não há tentativa de contornar.'};
  if (status >= 400) return {ok: false, status, note: 'A página respondeu HTTP ' + status + '. O endereço pode ter mudado.'};
  return {ok: true, status, note: 'Página acessível.'};
}

export async function checkAllSources(db, sources, {fetchImpl = fetch, pause = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  const out = [];
  for (const source of sources) {
    const r = await checkSource(source, fetchImpl);
    db.prepare('INSERT INTO source_checks VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET checked_at=excluded.checked_at,ok=excluded.ok,http_status=excluded.http_status,note=excluded.note').run(source.id, timestamp(), r.ok ? 1 : 0, r.status, r.note);
    out.push({sourceId: source.id, ...r});
    await pause(400);
  }
  return out;
}
