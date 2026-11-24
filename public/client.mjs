// Client area: affiliated companies see only the permit data of their own cities and trades. No municipal links, ever.
const $ = q => document.querySelector(q), e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = v => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(v || 0), num = v => Number(v || 0).toLocaleString('en-US');
const day = v => v ? new Date(v + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC'}) : '—';
const st = {me: null, data: null, error: '', f: {city: [], state: '', trade: '', q: '', from: '', to: '', page: 1}, loading: false};
const brand = '<div class="lbrand"><img src="/logo-mark.png" alt=""><b>MORIAH</b><small>SYSTEM</small></div>';

async function api(path, body) {
  const r = await fetch(path, {method: body ? 'POST' : 'GET', headers: body ? {'Content-Type': 'application/json'} : {}, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j.error || 'Something went wrong.'); err.status = r.status; throw err; }
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 4000); }
const query = (extra = {}) => { const f = {...st.f, ...extra}, p = new URLSearchParams(); if (f.city.length) p.set('city', f.city.join(',')); for (const k of ['state', 'trade', 'q', 'from', 'to']) if (f[k]) p.set(k, f[k]); p.set('page', f.page); if (extra.export) p.set('export', '1'); return p.toString(); };

function loginView() {
  return '<main class="login"><section class="lcard">' + brand + '<h1>Client sign in</h1><form data-form="login"><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label>' + (st.error ? '<p class="form-error" role="alert"><span>' + e(st.error) + '</span></p>' : '') + '<button class="primary">Sign in</button></form></section></main>';
}
function meter(l) {
  const pct = Math.min(100, Math.round(l.used / Math.max(1, l.monthlyLimit) * 100));
  return '<div class="cl-meter"><div><b>' + num(l.used) + '</b> of ' + num(l.monthlyLimit) + ' permits opened this month<small>Resets every month · ' + l.cities + ' of ' + l.maxCities + ' cities in your plan</small></div><div class="cl-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i data-w="' + pct + '"></i></div></div>';
}
function appView() {
  const d = st.data, l = d.limits, f = st.f;
  const cities = d.cities.map(c => '<label class="cl-chip"><input type="checkbox" data-city="' + e(c.key) + '" ' + (f.city.includes(c.key) ? 'checked' : '') + '><span>' + e(c.city) + ', ' + e(c.state) + '</span></label>').join('');
  const rows = d.permits.map(p => '<tr><td>' + day(p.issued) + (p.dateApprox ? '<small>approx.</small>' : '') + '</td><td><b>' + e(p.address || '—') + '</b><small>' + e(p.city) + ', ' + e(p.state) + (p.number ? ' · #' + e(p.number) : '') + '</small></td><td>' + e(p.type || '—') + '<small>' + e(p.description).slice(0, 160) + '</small></td><td>' + (p.value ? money(p.value) : '—') + '</td><td>' + e(p.contractor || '—') + '<small>' + e(p.owner) + '</small></td></tr>').join('');
  return '<div class="cl-shell"><header class="cl-top">' + brand + '<div class="cl-who"><span><b>' + e(st.me.company) + '</b><small>' + e(st.me.name || st.me.email) + '</small></span><button type="button" data-action="logout">Sign out</button></div></header><main class="cl-main">'
    + '<section class="title"><div><p class="eyebrow">PERMIT RADAR</p><h1>Issued permits.</h1><p>Newly issued building permits in your cities' + (d.trades.length ? ' for ' + e(d.trades.join(', ')) : '') + '.</p></div></section>' + meter(l)
    + (l.capped ? '<p class="warning cl-warn">Your monthly limit is reached, so some permits on this page are hidden. They unlock next month, or ask your account manager for a higher limit.</p>' : '')
    + '<form class="filterbar" data-form="filters"><label>From<input type="month" name="from" value="' + e(f.from) + '"></label><label>To<input type="month" name="to" value="' + e(f.to) + '"></label>'
    + '<label>State<select name="state"><option value="">All states</option>' + ['MA', 'CT', 'RI'].map(x => '<option ' + (f.state === x ? 'selected' : '') + '>' + x + '</option>').join('') + '</select></label>'
    + (d.trades.length > 1 ? '<label>Trade<select name="trade"><option value="">All my trades</option>' + d.trades.map(t => '<option ' + (f.trade === t ? 'selected' : '') + '>' + e(t) + '</option>').join('') + '</select></label>' : '')
    + '<label class="search-label">Search<input type="search" name="q" value="' + e(f.q) + '" placeholder="Address, contractor, description…"></label><button class="primary" type="submit">Apply</button></form>'
    + '<div class="cl-chips">' + (cities || '<p class="muted">No cities assigned to your account yet. Contact your account manager.</p>') + '</div>'
    + '<section class="panel flush"><div class="cl-count"><span><b>' + num(d.total) + '</b> permits</span><button type="button" data-action="export">Export CSV</button></div><div class="table-scroll"><table class="cl-table"><thead><tr><th>Issued</th><th>Address</th><th>Work</th><th>Value</th><th>Contractor / owner</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (d.permits.length ? '' : '<p class="empty">No permits match these filters.</p>')
    + '<div class="cl-pager"><button type="button" data-action="prev" ' + (d.page <= 1 ? 'disabled' : '') + '>Previous</button><span>Page ' + d.page + ' of ' + d.pages + '</span><button type="button" data-action="next" ' + (d.page >= d.pages ? 'disabled' : '') + '>Next</button></div></section></main></div>';
}
function render() {
  $('#app').innerHTML = st.me ? (st.data ? appView() : '<main class="boot">Loading permits…</main>') : loginView();
  for (const i of document.querySelectorAll('[data-w]')) i.style.width = i.dataset.w + '%';
}
async function load() {
  try { st.data = await api('/api/client/permits?' + query()); render(); }
  catch (err) { if (err.status === 401) { st.me = null; st.data = null; } else toast(err.message); render(); }
}
async function start() {
  try { st.me = (await api('/api/client/me')).client; await load(); }
  catch { st.me = null; render(); }
}
function csv(rows) {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', head = ['Issued', 'City', 'State', 'Address', 'Permit', 'Type', 'Value', 'Description', 'Contractor', 'Owner'];
  return [head.map(q).join(','), ...rows.map(p => [p.issued, p.city, p.state, p.address, p.number, p.type, p.value, p.description, p.contractor, p.owner].map(q).join(','))].join('\r\n');
}
document.addEventListener('click', async ev => {
  const a = ev.target.closest('[data-action]')?.dataset.action; if (!a) return;
  try {
    if (a === 'logout') { await api('/api/client/logout', {}); st.me = null; st.data = null; return render(); }
    if (a === 'prev') { st.f.page = Math.max(1, st.f.page - 1); return load(); }
    if (a === 'next') { st.f.page += 1; return load(); }
    if (a === 'export') {
      const r = await api('/api/client/permits?' + query({export: 1, page: 1})), url = URL.createObjectURL(new Blob([csv(r.permits)], {type: 'text/csv'})), link = document.createElement('a');
      link.href = url; link.download = 'moriah-permits.csv'; link.click(); URL.revokeObjectURL(url);
      toast(r.limits.capped ? 'Exported what your monthly limit allows (' + r.permits.length + ' permits).' : 'Exported ' + r.permits.length + ' permits.'); await load();
    }
  } catch (err) { toast(err.message); }
});
document.addEventListener('change', ev => {
  const el = ev.target; if (!el.matches('[data-city]')) return;
  st.f.city = [...document.querySelectorAll('[data-city]')].filter(x => x.checked).map(x => x.dataset.city); st.f.page = 1; load();
});
document.addEventListener('submit', async ev => {
  ev.preventDefault(); const form = ev.target, v = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.form === 'login') { await api('/api/client/login', {email: v.email, password: v.password}); st.error = ''; st.me = (await api('/api/client/me')).client; await load(); }
    if (form.dataset.form === 'filters') { Object.assign(st.f, {from: v.from || '', to: v.to || '', state: v.state || '', trade: v.trade || '', q: v.q || '', page: 1}); await load(); }
  } catch (err) { if (form.dataset.form === 'login') { st.error = err.message; render(); } else toast(err.message); }
});
start();
