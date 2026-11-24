// Client area: affiliated companies see only the permit data of their own cities and trades. No municipal links, ever.
const $ = q => document.querySelector(q), e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = v => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(v || 0), num = v => Number(v || 0).toLocaleString('en-US');
const day = v => v ? new Date(v + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC'}) : '—';
const st = {tab: 'permits', modal: null, team: null, visits: null, me: null, data: null, error: '', f: {city: [], state: '', trade: '', q: '', from: '', to: '', page: 1}, loading: false};
const brand = '<div class="lbrand"><img src="/logo-mark.png" alt=""><b>MORIAH</b><small>SYSTEM</small></div>';

async function api(path, body) {
  const r = await fetch(path, {method: body ? 'POST' : 'GET', headers: body ? {'Content-Type': 'application/json'} : {}, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j.error || 'Something went wrong.'); err.status = r.status; throw err; }
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 4000); }
const query = (extra = {}) => { const f = {...st.f, ...extra}, p = new URLSearchParams(); if (f.city.length) p.set('city', f.city.join(',')); for (const k of ['state', 'trade', 'q', 'from', 'to']) if (f[k]) p.set(k, f[k]); if (st.tab === 'favorites') p.set('fav', '1'); p.set('page', f.page); if (extra.export) p.set('export', '1'); return p.toString(); };

function loginView() {
  return '<main class="login"><section class="lcard">' + brand + '<h1>Client sign in</h1><form data-form="login"><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label>' + (st.error ? '<p class="form-error" role="alert"><span>' + e(st.error) + '</span></p>' : '') + '<button class="primary">Sign in</button></form></section></main>';
}
function meter(l) {
  const pct = Math.min(100, Math.round(l.used / Math.max(1, l.monthlyLimit) * 100));
  return '<div class="cl-meter"><div><b>' + num(l.used) + '</b> of ' + num(l.monthlyLimit) + ' permits opened this month<small>Resets every month · ' + l.cities + ' of ' + l.maxCities + ' cities in your plan</small></div><div class="cl-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i data-w="' + pct + '"></i></div></div>';
}
const TABS = {owner: [['permits', 'Permits'], ['favorites', 'Favorites'], ['visits', 'Site visits'], ['team', 'Team']], seller: [['permits', 'Permits'], ['favorites', 'Favorites'], ['visits', 'My visits']], employee: []};
const dt = v => { try { return new Date(v).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}); } catch { return ''; } };
function shell(inner) {
  const tabs = (TABS[st.me.role] || []).map(([id, l]) => '<button type="button" data-action="tab" data-id="' + id + '" class="' + (st.tab === id ? 'active' : '') + '">' + l + '</button>').join('');
  return '<div class="cl-shell"><header class="cl-top">' + brand + '<nav class="cl-tabs">' + tabs + '</nav><div class="cl-who"><span><b>' + e(st.me.company) + '</b><small>' + e(st.me.name || st.me.email) + ' · ' + ({owner: 'Owner', seller: 'Seller', employee: 'Employee'}[st.me.role]) + '</small></span><button type="button" data-action="logout">Sign out</button></div></header><main class="cl-main">' + inner + '</main>' + (st.modal ? modalView() : '') + '</div>';
}
function employeeView() { return shell('<section class="title"><div><p class="eyebrow">TIME CLOCK</p><h1>Welcome.</h1><p>Clock in, clock out and photos for the office are coming next. Your account is ready.</p></div></section>'); }
function visitsView() {
  const v = st.visits || [];
  return shell('<section class="title"><div><p class="eyebrow">FIELD</p><h1>' + (st.me.role === 'owner' ? 'Site visits.' : 'My visits.') + '</h1><p>Measurements, notes and photos sent from the field for estimates.</p></div></section>'
    + (v.length ? v.map(x => '<section class="panel cl-visit"><header><b>' + e(x.address || 'Permit') + '</b><small>' + dt(x.createdAt) + ' · ' + e(x.byName || x.byEmail) + '</small></header>' + (x.measurements ? '<h3>Measurements</h3><p>' + e(x.measurements) + '</p>' : '') + (x.notes ? '<h3>Notes</h3><p>' + e(x.notes) + '</p>' : '') + '<div class="cl-photos">' + x.photos.map(id => '<a href="/api/client/photo?id=' + id + '" target="_blank" rel="noopener"><img src="/api/client/photo?id=' + id + '" alt="Site photo" loading="lazy"></a>').join('') + '</div></section>').join('') : '<p class="empty">No visits yet. Open a permit and press Visit to add measurements and photos.</p>'));
}
function teamView() {
  const t = st.team; if (!t) return shell('<p class="muted">Loading…</p>');
  const rows = t.members.map(m => '<tr><td><b>' + e(m.name || m.email) + '</b><small>' + e(m.email) + '</small></td><td>' + (m.role === 'seller' ? 'Seller' : 'Employee') + '</td><td>' + (m.role === 'seller' ? e(m.cities.map(k => { const c = t.cities.find(x => x.key === k); return c ? c.city : ''; }).filter(Boolean).join(', ') || '—') : '—') + '</td><td>' + (m.active ? 'Active' : 'Inactive') + '</td><td class="cl-act"><button type="button" data-action="setActive" data-id="' + m.id + '" data-on="' + (m.active ? 0 : 1) + '">' + (m.active ? 'Deactivate' : 'Activate') + '</button><button type="button" data-action="pw" data-id="' + m.id + '">New password</button></td></tr>').join('');
  const cityOpts = t.cities.map(c => '<label class="cl-chip"><input type="checkbox" name="city" value="' + e(c.key) + '"><span>' + e(c.city) + ', ' + e(c.state) + '</span></label>').join('');
  return shell('<section class="title"><div><p class="eyebrow">YOUR BUSINESS</p><h1>Team.</h1><p>Create sellers (see permits in the cities you choose) and employees (time clock, ' + t.spots.employees + ' of ' + t.spots.max + ' spots used).</p></div></section>'
    + '<form class="panel settings-panel" data-form="team"><h2>Add team member</h2><div class="form-grid"><label>Name<input name="name" required maxlength="120"></label><label>E-mail<input name="email" type="email" required></label><label>Role<select name="role"><option value="seller">Seller</option><option value="employee">Employee</option></select></label><label>Initial password<input name="password" type="password" required minlength="16" autocomplete="new-password"></label></div><small class="muted">At least 16 characters. Share it with the person; they can sign in at this same page.</small><fieldset><legend>Cities (sellers only)</legend><div class="cl-chips">' + (cityOpts || '<span class="muted">No cities on your plan yet.</span>') + '</div></fieldset><button class="primary" type="submit">Add member</button></form>'
    + '<section class="panel flush"><div class="table-scroll"><table class="cl-table"><thead><tr><th>Member</th><th>Role</th><th>Cities</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (t.members.length ? '' : '<p class="empty">No team members yet.</p>') + '</section>');
}
function modalView() {
  const m = st.modal;
  if (m.kind === 'pw') return '<div class="overlay"><form class="modal compact" data-form="pw"><header><h2>New password</h2><button type="button" data-action="close">×</button></header><input type="hidden" name="id" value="' + m.id + '"><label>Password<input name="password" type="password" required minlength="16" autocomplete="new-password"></label><small class="muted">At least 16 characters. The member is signed out.</small><footer class="drawer-foot"><button type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save</button></footer></form></div>';
  const p = m.permit;
  return '<div class="overlay"><form class="modal compact" data-form="visit"><header><h2>' + e(p.address || 'Site visit') + '</h2><button type="button" data-action="close">×</button></header><p class="muted">' + e(p.city) + ', ' + e(p.state) + (p.type ? ' · ' + e(p.type) : '') + '</p>'
    + '<label>Measurements<textarea name="measurements" rows="4" placeholder="Rooms, linear ft, sq ft, panel size…"></textarea></label><label>Notes for the office<textarea name="notes" rows="3" placeholder="Access, owner remarks, materials…"></textarea></label>'
    + '<label>Photos (up to 6)<input type="file" name="photos" accept="image/*" multiple data-photos></label><div class="cl-photos" id="vthumbs"></div>'
    + '<footer class="drawer-foot"><button type="button" data-action="close">Cancel</button><button class="primary" type="submit">Send visit</button></footer></form></div>';
}
function appView() {
  const d = st.data, l = d.limits, f = st.f;
  const cities = d.cities.map(c => '<label class="cl-chip"><input type="checkbox" data-city="' + e(c.key) + '" ' + (f.city.includes(c.key) ? 'checked' : '') + '><span>' + e(c.city) + ', ' + e(c.state) + '</span></label>').join('');
  const rows = d.permits.map(p => '<tr><td><button type="button" class="star' + (p.fav ? ' on' : '') + '" data-action="fav" data-id="' + p.key + '" aria-label="Favorite">' + (p.fav ? '★' : '☆') + '</button> ' + day(p.issued) + (p.dateApprox ? '<small>approx.</small>' : '') + '</td><td><b>' + e(p.address || '—') + '</b><small>' + e(p.city) + ', ' + e(p.state) + (p.number ? ' · #' + e(p.number) : '') + '</small></td><td>' + e(p.type || '—') + '<small>' + e(p.description).slice(0, 160) + '</small></td><td>' + (p.value ? money(p.value) : '—') + '</td><td>' + e(p.contractor || '—') + '<small>' + e(p.owner) + '</small></td><td class="cl-act"><button type="button" data-action="visit" data-id="' + p.key + '">Visit</button></td></tr>').join('');
  return shell('<section class="title"><div><p class="eyebrow">' + (st.tab === 'favorites' ? 'FAVORITES' : 'PERMIT RADAR') + '</p><h1>' + (st.tab === 'favorites' ? 'Favorites.' : 'Issued permits.') + '</h1><p>Newly issued building permits in your cities' + (d.trades.length ? ' for ' + e(d.trades.join(', ')) : '') + '.</p></div></section>' + meter(l)
    + (l.capped ? '<p class="warning cl-warn">Your monthly limit is reached, so some permits on this page are hidden. They unlock next month, or ask your account manager for a higher limit.</p>' : '')
    + '<form class="filterbar" data-form="filters"><label>From<input type="month" name="from" value="' + e(f.from) + '"></label><label>To<input type="month" name="to" value="' + e(f.to) + '"></label>'
    + '<label>State<select name="state"><option value="">All states</option>' + ['MA', 'CT', 'RI'].map(x => '<option ' + (f.state === x ? 'selected' : '') + '>' + x + '</option>').join('') + '</select></label>'
    + (d.trades.length > 1 ? '<label>Trade<select name="trade"><option value="">All my trades</option>' + d.trades.map(t => '<option ' + (f.trade === t ? 'selected' : '') + '>' + e(t) + '</option>').join('') + '</select></label>' : '')
    + '<label class="search-label">Search<input type="search" name="q" value="' + e(f.q) + '" placeholder="Address, contractor, description…"></label><button class="primary" type="submit">Apply</button></form>'
    + '<div class="cl-chips">' + (cities || '<p class="muted">No cities assigned to your account yet. Contact your account manager.</p>') + '</div>'
    + '<section class="panel flush"><div class="cl-count"><span><b>' + num(d.total) + '</b> permits</span><span class="cl-tools">' + (st.tab === 'favorites' ? '<button type="button" data-action="route">Open route in Maps</button>' : '') + '<button type="button" data-action="export">Export CSV</button></span></div><div class="table-scroll"><table class="cl-table"><thead><tr><th>Issued</th><th>Address</th><th>Work</th><th>Value</th><th>Contractor / owner</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (d.permits.length ? '' : '<p class="empty">No permits match these filters.</p>')
    + '<div class="cl-pager"><button type="button" data-action="prev" ' + (d.page <= 1 ? 'disabled' : '') + '>Previous</button><span>Page ' + d.page + ' of ' + d.pages + '</span><button type="button" data-action="next" ' + (d.page >= d.pages ? 'disabled' : '') + '>Next</button></div></section>');
}
function render() {
  $('#app').innerHTML = !st.me ? loginView() : st.me.role === 'employee' ? employeeView() : st.tab === 'team' ? teamView() : st.tab === 'visits' ? visitsView() : st.data ? appView() : '<main class="boot">Loading permits…</main>';
  for (const i of document.querySelectorAll('[data-w]')) i.style.width = i.dataset.w + '%';
}
async function load() {
  try { st.data = await api('/api/client/permits?' + query()); render(); }
  catch (err) { if (err.status === 401) { st.me = null; st.data = null; } else toast(err.message); render(); }
}
async function start() {
  try { st.me = (await api('/api/client/me')).client; if (st.me.role !== 'employee') await load(); else render(); }
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
    const id = ev.target.closest('[data-action]').dataset.id;
    if (a === 'tab') { st.tab = id; st.f.page = 1; st.modal = null; if (id === 'team') { st.team = null; render(); st.team = await api('/api/client/team'); return render(); } if (id === 'visits') { st.visits = (await api('/api/client/visits')).visits; return render(); } return load(); }
    if (a === 'close') { st.modal = null; return render(); }
    if (a === 'fav') { const p = st.data.permits.find(x => x.key === id); await api('/api/client/favorite', {permitKey: id, on: !p.fav}); return load(); }
    if (a === 'visit') { st.modal = {kind: 'visit', permit: st.data.permits.find(x => x.key === id), photos: []}; return render(); }
    if (a === 'pw') { st.modal = {kind: 'pw', id}; return render(); }
    if (a === 'setActive') { await api('/api/client/team', {op: 'setActive', id: Number(id), active: ev.target.dataset.on === '1'}); st.team = await api('/api/client/team'); return render(); }
    if (a === 'route') {
      const r = await api('/api/client/permits?fav=1&page=1'), stops = r.permits.filter(p => p.address).slice(0, 9).map(p => encodeURIComponent([p.address, p.city, p.state].join(', ')));
      if (!stops.length) return toast('Favorite some permits first.');
      window.open('https://www.google.com/maps/dir/' + stops.join('/'), '_blank', 'noopener'); return;
    }
    if (a === 'prev') { st.f.page = Math.max(1, st.f.page - 1); return load(); }
    if (a === 'next') { st.f.page += 1; return load(); }
    if (a === 'export') {
      const r = await api('/api/client/permits?' + query({export: 1, page: 1})), url = URL.createObjectURL(new Blob([csv(r.permits)], {type: 'text/csv'})), link = document.createElement('a');
      link.href = url; link.download = 'moriah-permits.csv'; link.click(); URL.revokeObjectURL(url);
      toast(r.limits.capped ? 'Exported what your monthly limit allows (' + r.permits.length + ' permits).' : 'Exported ' + r.permits.length + ' permits.'); await load();
    }
  } catch (err) { toast(err.message); }
});
async function shrink(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [.8, .65, .5, .4]) { const u = c.toDataURL('image/jpeg', q); if (u.length < 390000) return u; }
  throw new Error('Photo is too large.');
}
document.addEventListener('change', async ev => {
  const el = ev.target;
  if (el.matches('[data-photos]')) {
    try { st.modal.photos = []; for (const f of [...el.files].slice(0, 6)) st.modal.photos.push(await shrink(f)); $('#vthumbs').innerHTML = st.modal.photos.map(u => '<img src="' + u + '" alt="">').join(''); } catch (err) { toast(err.message); }
    return;
  }
  if (!el.matches('[data-city]')) return;
  st.f.city = [...document.querySelectorAll('[data-city]')].filter(x => x.checked).map(x => x.dataset.city); st.f.page = 1; load();
});
document.addEventListener('submit', async ev => {
  ev.preventDefault(); const form = ev.target, v = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.form === 'login') { await api('/api/client/login', {email: v.email, password: v.password}); st.error = ''; st.me = (await api('/api/client/me')).client; st.tab = 'permits'; if (st.me.role !== 'employee') await load(); else render(); }
    if (form.dataset.form === 'visit') { await api('/api/client/visits', {permitKey: st.modal.permit.key, measurements: v.measurements, notes: v.notes, photos: st.modal.photos}); st.modal = null; render(); toast('Visit sent to the office.'); return; }
    if (form.dataset.form === 'team') { await api('/api/client/team', {name: v.name, email: v.email, role: v.role, password: v.password, cities: new FormData(form).getAll('city')}); st.team = await api('/api/client/team'); render(); toast('Team member added.'); return; }
    if (form.dataset.form === 'pw') { await api('/api/client/team', {op: 'setPassword', id: Number(v.id), password: v.password}); st.modal = null; render(); toast('Password updated.'); return; }
    if (form.dataset.form === 'filters') { Object.assign(st.f, {from: v.from || '', to: v.to || '', state: v.state || '', trade: v.trade || '', q: v.q || '', page: 1}); await load(); }
  } catch (err) { if (form.dataset.form === 'login') { st.error = err.message; render(); } else toast(err.message); }
});
start();
