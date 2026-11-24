// Business workspace: owner, sellers (and later employees) of an affiliated company. No municipal links or source names, ever.
const $ = q => document.querySelector(q), e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = v => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(v || 0), num = v => Number(v || 0).toLocaleString('en-US');
const day = v => v ? new Date(v + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'}) : '—';
const when = v => { try { return new Date(v).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}); } catch { return ''; } };
const dueLabel = v => { const [d, t] = String(v).split('T'), h = Number(t.slice(0, 2)); return day(d) + ' · ' + ((h % 12) || 12) + ':' + t.slice(3, 5) + ' ' + (h < 12 ? 'AM' : 'PM'); };
const ICO = {refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', dollar: '<path d="M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.6 2.6 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>', tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>', radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.800-7 11-7 11z"/><circle cx="12" cy="10" r="2.500"/>', bld: '<path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20"/>', cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>', users: '<circle cx="9" cy="8" r="3.500"/><path d="M2 20c0-3.500 3-6 7-6s7 2.500 7 6M17 5a3 3 0 0 1 0 6M22 20c0-2.500-1.500-4.500-4-5.300"/>', note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM9 13h6M9 17h6"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12l5 5 9-10"/>', send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>'};
const icon = k => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + (ICO[k] || '') + '</svg>';
const st = {calc: {trade: '', qty: {}, markup: 0, tax: 0}, crmStatus: '', crmQ: '', tab: 'radar', radarTab: 'all', modal: null, drawer: null, data: null, lists: null, listId: 'fav', listData: null, followups: null, fuTab: 'today', estimates: null, estSel: null, team: null, visits: null, me: null, error: '', f: {city: [], state: '', trade: '', scope: '', kind: '', q: '', from: '', to: '', page: 1}};

async function api(path, body) {
  const r = await fetch(path, {method: body ? 'POST' : 'GET', headers: body ? {'Content-Type': 'application/json'} : {}, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j.error || 'Something went wrong.'); err.status = r.status; throw err; }
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 4000); }
const query = (extra = {}) => { const f = {...st.f, ...extra}, p = new URLSearchParams(); if (f.city.length) p.set('city', f.city.join(',')); for (const k of ['state', 'trade', 'scope', 'kind', 'q', 'from', 'to']) if (f[k]) p.set(k, f[k]); if (st.radarTab === 'fav' && st.tab === 'radar') p.set('fav', '1'); p.set('page', f.page); if (extra.export) p.set('export', '1'); return p.toString(); };
const owner = () => st.me.role === 'owner';
const STATUS = {draft: ['Draft', 'st-muted'], with_owner: ['With Owner', 'st-purple'], changes_requested: ['Changes requested', 'st-warn'], review_requested: ['Review requested', 'st-purple'], approved: ['Approved', 'st-ok'], sent: ['Sent to customer', 'st-ok']};
const pill = s => '<span class="pill ' + (STATUS[s]?.[1] || '') + '">' + e(STATUS[s]?.[0] || s) + '</span>';

const brand = '<a class="brand" href="/client"><img src="/logo-mark.png" alt="" class="brand-img"><span class="brand-text"><b>MORIAH</b><small>SYSTEM</small></span></a>';
function loginView() {
  return '<main class="login"><section class="lcard"><div class="lbrand"><img src="/logo-mark.png" alt=""><b>MORIAH</b><small>SYSTEM</small></div><h1>Sign in</h1><form data-form="login"><label>Email or username<input name="email" type="text" required autocomplete="username" autocapitalize="none" spellcheck="false"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label>' + (st.error ? '<p class="form-error" role="alert"><span>' + e(st.error) + '</span></p>' : '') + '<button class="primary">Sign in</button></form></section></main>';
}
const NAV = () => st.me.role === 'employee' ? [['clock', 'Time clock', 'clock'], ['profile', 'Profile', 'users']] : owner()
  ? [['overview', 'Overview', 'chart'], ['radar', 'Permit Radar', 'radar'], ['lists', 'My Lists', 'list'], ['estimates', 'Estimates', 'calc'], ['crm', 'CRM', 'users'], ['jobs', 'Jobs', 'brief'], ['invoices', 'Invoices', 'dollar'], ['prices', 'Price calculator', 'tag'], ['followups', 'Follow-ups', 'cal'], ['visits', 'Site visits', 'cam'], ['team', 'Team', 'users'], ['time', 'Time & Crew', 'clock'], ['profile', 'Profile', 'users']]
  : [['radar', 'Permit Radar', 'radar'], ['lists', 'My Lists', 'list'], ['estimates', 'Estimate Requests', 'calc'], ['followups', 'Follow-ups', 'cal'], ['visits', 'My visits', 'cam'], ['profile', 'Profile', 'users']];
function shell(inner) {
  const nav = NAV().map(([id, l, ic]) => '<button type="button" data-action="tab" data-id="' + id + '" class="' + (st.tab === id ? 'active' : '') + '">' + icon(ic) + '<span>' + l + '</span></button>').join('');
  const name = st.me.name || String(st.me.email).split('@')[0];
  return '<div class="shell">' + '<aside class="side">' + brand + '<nav>' + nav + '</nav><div class="usercard">' + avatarHtml(st.me.photo, name) + '<span class="who"><b>' + e(name) + '</b><small>' + ({owner: 'Owner', seller: 'Sales Workspace', employee: 'Employee'}[st.me.role]) + '</small></span><button type="button" data-action="logout">Sign out</button></div></aside>'
    + '<div class="main-col"><main class="workspace"><div class="cl-co">' + (st.me.logo ? '<img class="cl-logo" src="' + e(st.me.logo) + '" alt="">' : icon('bld')) + '<b>' + e(st.me.company) + '</b></div>' + inner + '</main></div>' + (st.drawer ? drawerView() : '') + (st.modal ? modalView() : '') + '</div>';
}
const title = (h, p) => '<section class="title"><div><h1>' + h + '</h1><p>' + p + '</p></div></section>';

// ---------- Permit Radar ----------
function meter(l) {
  const pct = Math.min(100, Math.round(l.used / Math.max(1, l.monthlyLimit) * 100));
  return '<div class="cl-meter"><div><b>' + num(l.used) + '</b> of ' + num(l.monthlyLimit) + ' permits opened this month<small>Resets every month · ' + l.cities + ' of ' + l.maxCities + ' cities in your plan</small></div><div class="cl-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i data-w="' + pct + '"></i></div></div>';
}
function permitRows(d, withActions = true) {
  return d.permits.map(p => '<tr class="clickrow" data-action="open" data-id="' + p.key + '"><td class="starcell"><button type="button" class="star' + (p.fav ? ' on' : '') + '" data-action="fav" data-id="' + p.key + '" aria-label="Favorite">' + icon('star') + '</button></td><td><b>' + e(p.address || '—') + '</b><small>' + (p.number ? '#' + e(p.number) : '') + '</small></td><td>' + e(p.city) + ', ' + e(p.state) + '</td><td><span class="pill st-purple">' + e(p.kind || p.type || 'Permit') + '</span></td><td>' + day(p.issued) + (p.dateApprox ? '<small>approx.</small>' : '') + '</td><td>' + (p.value ? money(p.value) : '—') + '</td><td class="cl-act"><button type="button" data-action="open" data-id="' + p.key + '">View</button></td></tr>').join('');
}
function permitTable(d) {
  return '<section class="panel flush"><div class="cl-count"><span><b>' + num(d.total) + '</b> permits</span><span class="cl-tools">' + (st.tab === 'radar' && st.radarTab === 'fav' ? '<button type="button" data-action="route">Open route in Maps</button>' : '') + '<button type="button" data-action="export">Export CSV</button></span></div><div class="table-scroll"><table class="cl-table"><thead><tr><th></th><th>Address</th><th>City / State</th><th>Type</th><th>Issued</th><th>Declared value</th><th></th></tr></thead><tbody>' + permitRows(d) + '</tbody></table></div>' + (d.permits.length ? '' : '<p class="empty">No permits to show here yet.</p>')
    + '<div class="cl-pager"><button type="button" data-action="prev" ' + (d.page <= 1 ? 'disabled' : '') + '>Previous</button><span>Page ' + d.page + ' of ' + d.pages + '</span><button type="button" data-action="next" ' + (d.page >= d.pages ? 'disabled' : '') + '>Next</button></div></section>';
}
function kindPills(d) {
  const ks = Object.entries(d.kinds || {}).sort((a, b) => b[1] - a[1]), all = ks.reduce((n, k) => n + k[1], 0); if (!ks.length) return '';
  return '<nav class="pills cl-pills"><button type="button" data-action="rkind" data-id="" class="' + (!st.f.kind ? 'active' : '') + '">All Permits <b>' + num(all) + '</b></button>' + ks.map(([k, c]) => '<button type="button" data-action="rkind" data-id="' + e(k) + '" class="' + (st.f.kind === k ? 'active' : '') + '">' + e(k) + ' <b>' + num(c) + '</b></button>').join('') + '</nav>';
}
function radarView() {
  const d = st.data; if (!d) return '<p class="muted">Loading permits…</p>';
  const f = st.f, cityBox = d.cities.map(c => '<label class="cl-opt"><input type="checkbox" data-city="' + e(c.key) + '" ' + (f.city.includes(c.key) ? 'checked' : '') + '>' + e(c.city) + ', ' + e(c.state) + '</label>').join('');
  return title('Permit Radar', 'Browse issued building permits in your assigned cities' + (d.trades.length ? ' for ' + e(d.trades.join(', ')) : '') + '.') + meter(d.limits)
    + (d.limits.capped ? '<p class="warning cl-warn">Your monthly limit is reached, so some permits are hidden. They unlock next month, or ask your account manager for a higher limit.</p>' : '')
    + '<form class="cl-filters" data-form="filters"><label class="searchbox">' + icon('search') + '<input type="search" name="q" value="' + e(f.q) + '" placeholder="Address or permit number"></label>'
    + '<details class="cl-pop"><summary>' + icon('pin') + (f.city.length ? f.city.length + ' selected' : 'Assigned cities (' + d.cities.length + ')') + '</summary><div class="cl-popbox"><b>Assigned cities</b>' + (cityBox || '<small class="muted">No cities assigned yet.</small>') + '</div></details>'
    + '<select name="state"><option value="">All states</option>' + ['MA', 'CT', 'RI'].map(x => '<option ' + (f.state === x ? 'selected' : '') + '>' + x + '</option>').join('') + '</select>'
    + (d.trades.length ? '<select name="scope" aria-label="Trades"><option value="">My trades only</option><option value="all" ' + (f.scope === 'all' ? 'selected' : '') + '>All trades</option></select>' : '')
    + (d.trades.length > 1 && f.scope !== 'all' ? '<select name="trade"><option value="">All my trades</option>' + d.trades.map(t => '<option ' + (f.trade === t ? 'selected' : '') + '>' + e(t) + '</option>').join('') + '</select>' : '')
    + '<input type="month" name="from" value="' + e(f.from) + '" aria-label="From"><input type="month" name="to" value="' + e(f.to) + '" aria-label="To"><button class="primary" type="submit">Search</button><button type="button" data-action="refresh">' + icon('refresh') + (st.refreshing ? 'Updating…' : 'Update permits') + '</button></form>'
    + kindPills(d)
    + '<div class="cl-seg"><button type="button" data-action="rtab" data-id="all" class="' + (st.radarTab === 'all' ? 'active' : '') + '">All permits</button><button type="button" data-action="rtab" data-id="fav" class="' + (st.radarTab === 'fav' ? 'active' : '') + '">Favorites</button></div>' + permitTable(d);
}

// ---------- My Lists ----------
function listsView() {
  const L = st.lists; if (!L) return '<p class="muted">Loading…</p>';
  const cur = L.find(x => String(x.id) === String(st.listId)) || L[0];
  return title('My Lists', 'Group the opportunities you want to work.')
    + '<div class="cl-split"><aside class="cl-listcol">' + L.map(x => '<button type="button" data-action="list" data-id="' + x.id + '" class="cl-listbtn' + (String(x.id) === String(cur.id) ? ' active' : '') + '">' + icon('star') + '<span>' + e(x.name) + '</span><em>' + x.count + '</em></button>').join('')
    + '<form data-form="newlist" class="cl-newlist"><input name="name" placeholder="New list name" maxlength="60" required><button class="primary" type="submit">' + icon('plus') + 'New list</button></form>' + (cur.builtin ? '' : '<button type="button" class="danger" data-action="dellist" data-id="' + cur.id + '">Delete this list</button>') + '</aside>'
    + '<div class="cl-listmain"><h2 class="cl-h2">' + e(cur.name) + '</h2>' + (st.listData ? permitTable(st.listData) : '<p class="muted">Loading…</p>') + '</div></div>';
}

// ---------- Estimates ----------
function estimatesView() {
  const E = st.estimates; if (!E) return '<p class="muted">Loading…</p>';
  const sel = E.find(x => x.id === st.estSel) || null;
  const rows = E.map(x => '<tr class="clickrow' + (sel?.id === x.id ? ' sel' : '') + '" data-action="est" data-id="' + x.id + '"><td><b>' + e(x.address) + '</b><small>' + e(x.city) + ', ' + e(x.state) + (owner() && x.by ? ' · ' + e(x.by) : '') + '</small></td><td>' + pill(x.status) + '</td><td>' + day(x.updatedAt.slice(0, 10)) + '</td></tr>').join('');
  return title(owner() ? 'Estimates' : 'Estimate Requests', owner() ? 'Requests from your salespeople. Prepare the estimate and send it to the customer.' : 'Send job information to the owner, who prepares and sends the estimate. You can review before it goes out.')
    + '<div class="toolbar"><button type="button" class="primary" data-action="o-est-new">New estimate request</button></div>'
    + '<div class="cl-split wide"><section class="panel flush"><table class="cl-table"><thead><tr><th>Opportunity</th><th>Status</th><th>Updated</th></tr></thead><tbody>' + rows + '</tbody></table>' + (E.length ? '' : '<p class="empty">No estimate requests yet. Open a permit and press "Request an estimate".</p>') + '</section>'
    + '<section class="panel cl-est">' + (sel ? estDetail(sel) : '<p class="muted">Select a request to see its details.</p>') + '</section></div>';
}
function estDetail(x) {
  const tl = x.events.map(ev => '<li><i>' + icon('check') + '</i><span><b>' + e(({submitted: 'Request submitted', prepared: 'Estimate prepared', review: 'Review requested', approved: 'Approved', changes: 'Changes requested', sent: 'Estimate sent'})[ev.kind] || ev.kind) + '</b><small>' + when(ev.createdAt) + (ev.byName ? ' · ' + e(ev.byName) : '') + '</small>' + (ev.text && !/^(Request submitted|Estimate prepared|Review requested by|Approved for)/.test(ev.text) ? '<em>' + e(ev.text) + '</em>' : '') + '</span></li>').join('');
  const itemsTable = x.lineItems.length ? '<h3>Estimate</h3><table class="cl-items"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>' + x.lineItems.map(i => '<tr><td>' + e(i.description) + '</td><td>' + i.qty + '</td><td>' + usd(i.price) + '</td><td>' + usd(i.qty * i.price) + '</td></tr>').join('') + '</tbody><tfoot>' + (x.tax ? '<tr><td colspan="3">Sales tax (' + x.taxRate + '%)</td><td>' + usd(x.tax) + '</td></tr>' : '') + '<tr><td colspan="3"><b>Total</b></td><td><b>' + usd(x.total) + '</b></td></tr></tfoot></table>' : (x.description ? '<h3>Estimate</h3><p class="pre">' + e(x.description) + '</p>' : '');
  const head = '<h2>' + e(x.address) + '</h2><p class="muted">' + e(x.city) + ', ' + e(x.state) + '</p>' + pill(x.status)
    + '<div class="cl-kv"><span>Customer<b>' + e(x.prospectName || '—') + '</b><small>' + e(x.prospectEmail) + '</small></span>' + (x.total ? '<span>Total<b class="big">' + usd(x.total) + '</b></span>' : '') + '</div>'
    + (x.scope ? '<h3>Scope</h3><p class="pre">' + e(x.scope) + '</p>' : '') + (x.measurements ? '<h3>Measurements</h3><p class="pre">' + e(x.measurements) + '</p>' : '')
    + (owner() ? '' : itemsTable)
    + (x.ownerNote ? '<div class="cl-note"><b>Note from Owner</b><p>' + e(x.ownerNote) + '</p></div>' : '') + '<h3>Timeline</h3><ul class="cl-tl">' + tl + '</ul>';
  if (owner() && x.status !== 'sent') {
    const rows = (x.lineItems.length ? x.lineItems : [{description: '', qty: 1, price: ''}]).map(liRow).join('');
    return head + '<form data-form="prepare" class="cl-prep" data-estform><input type="hidden" name="id" value="' + x.id + '">'
      + '<div class="cl-callout"><b>Sales review (optional)</b><small>Ask the salesperson to check the estimate before it goes to the customer. It is not required.</small></div>'
      + '<h3>Line items (customer estimate)</h3><div id="liRows">' + rows + '</div><button type="button" data-action="addli">' + icon('plus') + 'Add line item</button>'
      + '<div class="form-grid"><label>Sales tax (%)<input name="taxRate" type="number" min="0" max="15" step="0.01" value="' + (x.taxRate || 0) + '"></label><label>Internal cost (private)<input name="internalCost" type="number" min="0" step="0.01" value="' + (x.internalCost || '') + '" placeholder="Not shown to customer or sellers"></label></div>'
      + '<div class="cl-sums" id="sums"></div>'
      + '<label>Message for the customer (optional)<textarea name="description" rows="2">' + e(x.description) + '</textarea></label><label>Note for the salesperson (optional)<textarea name="ownerNote" rows="2">' + e(x.ownerNote) + '</textarea></label>'
      + '<div class="cl-btnrow"><button type="submit" name="act" value="save">Save draft</button><button type="submit" name="act" value="review">Request sales review</button><button class="primary" type="submit" name="act" value="send">' + icon('send') + 'Review & send</button></div></form>';
  }
  if (!owner() && x.status === 'review_requested') return head + '<form data-form="feedback" class="cl-prep"><input type="hidden" name="id" value="' + x.id + '"><label>Feedback for Owner<textarea name="text" rows="3" placeholder="Share your feedback, confirm the scope, or request changes…"></textarea></label><div class="cl-btnrow"><button type="submit" name="act" value="changes">Request changes</button><button class="primary" type="submit" name="act" value="approve">Approve for Owner to send</button></div></form>';
  if (!owner() && ['draft', 'changes_requested'].includes(x.status)) return head + '<div class="cl-btnrow"><button type="button" data-action="editest" data-id="' + x.id + '">Edit request</button></div>';
  if (owner() && x.status === 'sent') return head + '<p class="muted">Sent ' + when(x.sentAt) + '. Margin ' + x.margin + '% (' + usd(x.profit) + ' profit on ' + usd(x.internalCost) + ' cost).</p>';
  return head;
}
const usd = v => '$' + Number(v || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const liRow = i => '<div class="cl-li"><input name="li_desc" placeholder="Description" value="' + e(i.description) + '" maxlength="300"><input name="li_qty" type="number" min="0.01" step="any" value="' + e(i.qty) + '" aria-label="Qty"><input name="li_price" type="number" min="0" step="0.01" value="' + e(i.price) + '" placeholder="Unit price" aria-label="Unit price"><button type="button" class="dots" data-action="rmli" aria-label="Remove">×</button></div>';
function recalc() {
  const f = $('[data-estform]'); if (!f) return;
  const qty = [...f.querySelectorAll('[name=li_qty]')], price = [...f.querySelectorAll('[name=li_price]')];
  const sub = qty.reduce((t, q, i) => t + (Number(q.value) || 0) * (Number(price[i].value) || 0), 0), rate = Number(f.elements.taxRate.value) || 0, tax = Math.round(sub * rate) / 100, total = sub + tax, cost = Number(f.elements.internalCost.value) || 0;
  const profit = total - cost, margin = total > 0 ? Math.round(profit / total * 1000) / 10 : 0;
  $('#sums').innerHTML = '<div class="cl-sum prev"><span>Customer preview</span><b>' + usd(total) + '</b><small>Subtotal ' + usd(sub) + (rate ? ' + tax ' + usd(tax) : '') + '</small></div><div class="cl-sum priv"><span>Private</span><b>' + (cost ? margin + '% margin' : '—') + '</b><small>' + (cost ? usd(profit) + ' profit · cost ' + usd(cost) : 'Add the internal cost to see the margin') + '</small></div>';
}

// ---------- Follow-ups ----------
function followupsView() {
  const F = st.followups; if (!F) return '<p class="muted">Loading…</p>';
  const by = b => F.followups.filter(x => x.bucket === b), cur = by(st.fuTab);
  const tabs = [['today', 'Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['completed', 'Completed']].map(([id, l]) => '<button type="button" data-action="futab" data-id="' + id + '" class="' + (st.fuTab === id ? 'active' : '') + '">' + l + (id !== 'completed' ? ' (' + by(id).length + ')' : '') + '</button>').join('');
  const KI = {call: 'Call', email: 'Email', meeting: 'Meeting', task: 'Task'};
  const rows = cur.map(x => '<tr><td>' + dueLabel(x.dueAt) + '</td><td><b>' + e(x.task) + '</b><small>' + e(KI[x.kind] || '') + (x.notes ? ' · ' + e(x.notes) : '') + '</small></td><td>' + e(x.address || '—') + '</td><td class="cl-act">' + (x.doneAt ? '<button type="button" data-action="fuundo" data-id="' + x.id + '">Reopen</button>' : '<button type="button" data-action="fudone" data-id="' + x.id + '">Mark complete</button><button type="button" data-action="fuedit" data-id="' + x.id + '">Reschedule</button>') + '</td></tr>').join('');
  return title('Follow-ups', 'Your follow-up agenda for sales opportunities and open items.') + '<div class="cl-seg">' + tabs + '<button class="primary cl-right" type="button" data-action="funew">' + icon('plus') + 'New follow-up</button></div>'
    + '<section class="panel flush"><table class="cl-table"><thead><tr><th>Due</th><th>Follow-up</th><th>Opportunity</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' + (cur.length ? '' : '<p class="empty">Nothing here.</p>') + '</section>';
}

// ---------- Visits & Team ----------
function visitsView() {
  const v = st.visits || [];
  return title(owner() ? 'Site visits' : 'My visits', 'Measurements, notes and photos sent from the field for estimates.')
    + (v.length ? v.map(x => '<section class="panel cl-visit"><header><b>' + e(x.address || 'Permit') + '</b><small>' + when(x.createdAt) + ' · ' + e(x.byName || x.byEmail) + '</small></header>' + (x.measurements ? '<h3>Measurements</h3><p>' + e(x.measurements) + '</p>' : '') + (x.notes ? '<h3>Notes</h3><p>' + e(x.notes) + '</p>' : '') + '<div class="cl-photos">' + x.photos.map(id => '<a href="/api/client/photo?id=' + id + '" target="_blank" rel="noopener"><img src="/api/client/photo?id=' + id + '" alt="Site photo" loading="lazy"></a>').join('') + '</div></section>').join('') : '<p class="empty">No visits yet. Open a permit and press "Add site visit".</p>');
}
const avatarHtml = (photo, name, big = '') => photo ? '<img class="avatar ' + big + '" src="' + e(photo) + '" alt="">' : '<span class="avatar ' + big + '">' + e(String(name || '?').slice(0, 2).toUpperCase()) + '</span>';
function profileView() {
  const p = st.profile; if (!p) return '<p class="muted">Loading…</p>';
  const m = p.me, c = p.company, nm = m.name || String(m.email).split('@')[0];
  const photoBox = (kind, url, label, initials) => '<div class="photo-box" data-box="' + kind + '">' + avatarHtml(url, initials, 'big') + '<label class="filebtn">' + label + '<input type="file" accept="image/png,image/jpeg,image/webp" data-pphoto="' + kind + '" hidden></label><button type="button" data-action="rmphoto" data-id="' + kind + '">Remove</button><input type="hidden" name="' + (kind === 'me' ? 'photo' : 'logo') + '" value="' + e(url || '') + '"></div>';
  return title('Profile', 'Your personal details, your business information and your password.')
    + '<form class="panel settings-panel" data-form="profile"><h2>Personal details</h2><div class="cl-prof">' + photoBox('me', m.photo, 'Change photo', nm)
    + '<div class="form-grid"><label>Full name<input name="name" value="' + e(m.name) + '" maxlength="120" required></label><label>Job title<input name="title" value="' + e(m.title) + '" maxlength="80" placeholder="' + (m.role === 'owner' ? 'Owner' : 'Sales') + '"></label><label>Phone<input name="phone" type="tel" value="' + e(m.phone) + '" maxlength="40"></label><label>Sign-in e-mail<input value="' + e(m.email) + '" disabled></label></div></div>'
    + (p.canEditCompany ? '<h2 class="cl-h2">Business</h2><div class="cl-prof">' + photoBox('co', c.logo, 'Change logo', c.name) + '<div class="form-grid"><label>Business name<input name="co_name" value="' + e(c.name) + '" maxlength="120" required></label><label>Contact name<input name="co_contactName" value="' + e(c.contactName) + '" maxlength="120"></label><label>Business e-mail<input name="co_contactEmail" type="email" value="' + e(c.contactEmail) + '"></label><label>Business phone<input name="co_contactPhone" type="tel" value="' + e(c.contactPhone) + '" maxlength="40"></label><label>Address<input name="co_address" value="' + e(c.address) + '" maxlength="200"></label><label>Website<input name="co_website" value="' + e(c.website) + '" maxlength="200"></label></div></div>' : '<p class="muted">Business details are managed by the account owner (' + e(c.name) + ').</p>')
    + '<button class="primary" type="submit">Save profile</button></form>'
    + '<form class="panel settings-panel" data-form="mypw"><h2>Change password</h2><div class="form-grid"><label>Current password<input name="current" type="password" autocomplete="current-password" required></label><label>New password (16+ characters)<input name="password" type="password" autocomplete="new-password" minlength="16" required></label></div><button class="primary" type="submit">Update password</button></form>';
}

const hm = h => Math.floor(h) + 'h ' + String(Math.round((h % 1) * 60)).padStart(2, '0') + 'm';
const mapLink = l => l ? '<a href="https://www.google.com/maps?q=' + l.lat + ',' + l.lng + '" target="_blank" rel="noreferrer">Map ↗</a>' : '<span class="muted">No location</span>';
const where = () => new Promise(res => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => res({lat: p.coords.latitude, lng: p.coords.longitude}), () => res({}), {enableHighAccuracy: true, timeout: 8000, maximumAge: 30000}) : res({}));
function clockView() {
  const c = st.clock; if (!c) return '<p class="muted">Loading…</p>';
  const rows = c.entries.map(x => '<tr><td>' + when(x.inAt) + '</td><td>' + (x.outAt ? when(x.outAt) : '<span class="pill st-ok">On the clock</span>') + '</td><td>' + hm(x.hours) + '</td></tr>').join('');
  return title('Time clock', 'Clock in when you start, clock out when you finish. Your location is recorded at each punch.')
    + '<section class="panel cl-clock"><div class="cl-bigstat"><small>' + (c.open ? 'Clocked in since' : 'Not clocked in') + '</small><b>' + (c.open ? when(c.open.inAt) : 'Ready') + '</b><em>This week: ' + hm(c.weekHours) + '</em></div>'
    + '<button type="button" class="primary cl-punch" data-action="punch" data-id="' + (c.open ? 'out' : 'in') + '">' + (c.open ? 'Clock out' : 'Clock in') + '</button></section>'
    + '<form class="panel settings-panel" data-form="report"><h2>Send a note or photos to the office</h2><label>Note<textarea name="note" rows="3" maxlength="2000" placeholder="What does the office need to know?"></textarea></label><label class="filebtn cl-file">Add photos<input type="file" accept="image/*" multiple data-rphotos hidden></label><div id="rthumbs" class="cl-thumbs"></div><button class="primary" type="submit">Send to office</button></form>'
    + '<section class="panel flush"><div class="table-scroll"><table class="cl-table"><thead><tr><th>In</th><th>Out</th><th>Hours</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (rows ? '' : '<p class="empty">No punches yet.</p>') + '</section>';
}
function timeView() {
  const t = st.time; if (!t) return '<p class="muted">Loading…</p>';
  const rows = t.people.map(p => '<tr><td><b>' + e(p.name) + '</b><small>' + e(p.email) + '</small></td><td>' + (p.role === 'seller' ? 'Seller' : 'Employee') + '</td><td>' + (p.clockedIn ? '<span class="pill st-ok">On the clock</span><small>since ' + when(p.since) + '</small>' : '<span class="pill st-muted">Off</span>') + '</td><td>' + mapLink(p.location) + '</td><td>' + hm(p.weekHours) + '</td><td><form class="cl-rate" data-form="rate"><input type="hidden" name="id" value="' + p.id + '"><input name="rate" type="number" min="0" max="1000" step="0.5" value="' + p.rate + '" aria-label="Hourly rate"><button type="submit">Set</button></form></td><td>' + money(p.weekCost) + '</td></tr>').join('');
  const reps = t.reports.map(r => '<article class="cl-report"><header><b>' + e(r.by) + '</b><small>' + when(r.createdAt) + ' · ' + mapLink(r.lat != null ? r : null) + '</small></header>' + (r.note ? '<p>' + e(r.note) + '</p>' : '') + (r.photos.length ? '<div class="cl-thumbs">' + r.photos.map(id => '<a href="/api/client/report-photo?id=' + id + '" target="_blank"><img src="/api/client/report-photo?id=' + id + '" alt=""></a>').join('') + '</div>' : '') + '</article>').join('');
  return title('Time & Crew', 'Who is on the clock, where they are, hours this week and notes/photos sent to the office.')
    + '<section class="cl-stats"><div><small>Hours this week</small><b>' + hm(t.weekHours) + '</b></div><div><small>Labor cost this week</small><b>' + money(t.weekCost) + '</b></div><div><small>On the clock now</small><b>' + t.people.filter(p => p.clockedIn).length + '</b></div></section>'
    + '<section class="panel flush"><div class="table-scroll"><table class="cl-table"><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last location</th><th>Week</th><th>$/hour</th><th>Cost</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (rows ? '' : '<p class="empty">No crew yet. Add employees in Team.</p>') + '</section>'
    + '<section class="panel"><h2>Notes &amp; photos from the field</h2>' + (reps || '<p class="empty">Nothing sent yet.</p>') + '</section>';
}
function teamView() {
  const t = st.team; if (!t) return '<p class="muted">Loading…</p>';
  const rows = t.members.map(m => '<tr><td><b>' + e(m.name || m.email) + '</b><small>' + e(m.email) + '</small></td><td>' + (m.role === 'seller' ? 'Seller' : 'Employee') + '</td><td>' + (m.role === 'seller' ? e(m.cities.map(k => t.cities.find(x => x.key === k)?.city).filter(Boolean).join(', ') || '—') : '—') + '</td><td>' + (m.active ? 'Active' : 'Inactive') + '</td><td class="cl-act"><button type="button" data-action="setActive" data-id="' + m.id + '" data-on="' + (m.active ? 0 : 1) + '">' + (m.active ? 'Deactivate' : 'Activate') + '</button><button type="button" data-action="tedit" data-id="' + m.id + '">Edit</button><button type="button" data-action="pw" data-id="' + m.id + '">New password</button></td></tr>').join('');
  const cityOpts = t.cities.map(c => '<label class="cl-chip"><input type="checkbox" name="city" value="' + e(c.key) + '"><span>' + e(c.city) + ', ' + e(c.state) + '</span></label>').join('');
  return title('Team', 'Create sellers (permits in the cities you choose) and employees (time clock, ' + t.spots.employees + ' of ' + t.spots.max + ' spots used).')
    + '<form class="panel settings-panel" data-form="team"><h2>Add team member</h2><div class="form-grid"><label>Name<input name="name" required maxlength="120"></label><label>E-mail<input name="email" type="email" required></label><label>Role<select name="role"><option value="seller">Seller</option><option value="employee">Employee</option></select></label><label>Initial password<input name="password" type="password" required minlength="16" autocomplete="new-password"></label></div><small class="muted">At least 16 characters. Share it with the person; they sign in at this same page.</small><fieldset><legend>Cities (sellers only)</legend><div class="cl-chips">' + (cityOpts || '<span class="muted">No cities on your plan yet.</span>') + '</div></fieldset><button class="primary" type="submit">Add member</button></form>'
    + '<section class="panel flush"><div class="table-scroll"><table class="cl-table"><thead><tr><th>Member</th><th>Role</th><th>Cities</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (t.members.length ? '' : '<p class="empty">No team members yet.</p>') + '</section>';
}
const employeeView = () => '<section class="title"><div><h1>Welcome.</h1><p>Clock in, clock out and photos for the office are coming next. Your account is ready.</p></div></section>';

// ---------- Drawer & modals ----------
function drawerView() {
  const dr = st.drawer, p = dr.permit; if (!p) return '';
  const size = (String(p.description || '').match(/(\d[\d,]*)\s*(?:sq\.?\s*ft|sf|square\s*f)/i) || [])[1], parts = String(p.owner || '').split(/\s*[•|]\s*/), co = parts.find(y => /^(empresa associada|company)\s*:/i.test(y)), person = {name: parts.filter(y => y !== co).join(' ').trim(), company: co ? co.replace(/^[^:]+:\s*/, '').trim() : ''};
  const kv = (l, v, raw) => '<div class="cl-kv"><span>' + l + '</span><b>' + (v ? (raw ? v : e(v)) : '<i class="muted">Not available</i>') + '</b></div>';
  const lists = (st.lists || []).filter(x => !x.builtin);
  return '<div class="overlay right"><div class="modal side-drawer cl-drawer"><header><div><h2>' + e(p.address || 'Permit') + '</h2><p class="muted">' + e(p.city) + ', ' + e(p.state) + ' <span class="pill st-purple">' + e(p.type || 'Permit') + '</span></p></div><button type="button" data-action="close" aria-label="Close">×</button></header>'
    + '<div class="cl-dtools"><button type="button" class="cl-favbtn' + (p.fav ? ' on' : '') + '" data-action="dfav">' + icon('star') + (p.fav ? 'Favorite' : 'Add favorite') + '</button>' + (lists.length ? '<select data-addlist><option value="">Add to list…</option>' + lists.map(l => '<option value="' + l.id + '" ' + (dr.lists.includes(l.id) ? 'disabled' : '') + '>' + e(l.name) + (dr.lists.includes(l.id) ? ' ✓' : '') + '</option>').join('') + '</select>' : '') + '</div>'
    + '<div class="cl-card"><span>Issued<b>' + day(p.issued) + (p.dateApprox ? ' (approx.)' : '') + '</b></span><span>Declared value<b>' + (p.value ? money(p.value) : 'Not provided') + '</b></span><span>Permit ID<b>' + e(p.number || '—') + '</b></span><span>Status<b>' + e(p.status || '—') + '</b></span></div>'
    + '<div class="cl-card col"><h3>Scope of work</h3><p>' + e(p.description || 'No description published.') + '</p>' + kv('Permit type', p.type) + kv('Work type', p.kind) + kv('Project size', size ? size + ' sq ft' : '') + '</div>'
    + '<div class="cl-card col"><h3>Applicant &amp; contractor</h3>' + kv('Applicant', person.name || p.owner) + kv('Company', person.company) + kv('Contractor', p.contractor) + kv('Phone', p.phone ? '<a href="tel:' + e(String(p.phone).replace(/[^\d+]/g, '')) + '">' + e(p.phone) + '</a>' : '', true) + kv('Email', p.email ? '<a href="mailto:' + e(p.email) + '">' + e(p.email) + '</a>' : '', true) + '</div>'
    + ((dr.others || []).length ? '<div class="cl-card col"><h3>Other permits at this address</h3>' + dr.others.map(r => '<p><b>' + e(r.number) + '</b> <small>' + day(r.issued) + ' · ' + e(r.type) + '</small><br>' + e(r.description) + '</p>').join('') + '</div>' : '')
    + (dr.nextFollowup ? '<div class="cl-card"><span>Next follow-up<b>' + dueLabel(dr.nextFollowup) + '</b></span></div>' : '')
    + '<div class="cl-card col"><h3>Note</h3><textarea data-note rows="3" placeholder="Private note about this opportunity…">' + e(dr.note) + '</textarea></div>'
    + '<div class="cl-card col"><h3>Site visits & photos</h3><div class="cl-photos">' + dr.visits.flatMap(v => v.photos).map(id => '<a href="/api/client/photo?id=' + id + '" target="_blank" rel="noopener"><img src="/api/client/photo?id=' + id + '" alt="Site photo"></a>').join('') + '</div><button type="button" data-action="visit">' + icon('cam') + 'Add site visit</button></div>'
    + '<footer class="drawer-foot"><button type="button" data-action="fuforpermit">' + icon('cal') + 'Add follow-up</button><button class="primary" type="button" data-action="reqest">' + icon('send') + 'Request an estimate</button></footer></div></div>';
}
function modalView() {
  const m = st.modal, p = m.permit || st.drawer?.permit;
  if (String(m.kind).startsWith('o-')) return ownerModal(m);
  const wrap = (h, body, foot) => '<div class="overlay"><form class="modal compact" data-form="' + m.kind + '"><header><h2>' + h + '</h2><button type="button" data-action="mclose" aria-label="Close">×</button></header>' + body + '<footer class="drawer-foot"><button type="button" data-action="mclose">Cancel</button>' + foot + '</footer></form></div>';
  if (m.kind === 'sendest') { const x = st.estimates.find(q => q.id === m.id); return '<div class="overlay"><div class="modal compact"><header><h2>Final review &amp; send</h2><button type="button" data-action="mclose" aria-label="Close">×</button></header><div class="cl-card col"><span>Customer<b>' + e(x.prospectName) + '</b><small>' + e(x.prospectEmail) + '</small></span><span>Job<b>' + e(x.address) + '</b></span><span>Estimate total<b class="big">' + usd(x.total) + '</b></span><span>Attachment<b>Estimate-' + x.id + '.pdf</b></span></div><p class="muted">The customer and the salesperson both receive the estimate by e-mail. Internal cost and margin are never included.</p><footer class="drawer-foot"><button type="button" data-action="mclose">Back to estimate</button><button class="primary" type="button" data-action="sendnow">' + icon('send') + 'Send to customer</button></footer></div></div>'; }
  if (m.kind === 'tedit') { const x = st.team.members.find(q => q.id === m.id) || {}; return wrap('Edit team member', '<input type="hidden" name="id" value="' + x.id + '"><div class="form-grid"><label>Name<input name="name" value="' + e(x.name) + '" required maxlength="120"></label><label>E-mail (login)<input name="email" type="email" value="' + e(x.email) + '" required></label><label>Role<select name="role"><option value="seller" ' + (x.role === 'seller' ? 'selected' : '') + '>Seller</option><option value="employee" ' + (x.role === 'employee' ? 'selected' : '') + '>Employee</option></select></label></div><fieldset><legend>Cities this seller can access</legend><div class="cl-chips">' + (st.team.cities.map(c => '<label class="cl-chip"><input type="checkbox" name="city" value="' + e(c.key) + '" ' + (x.cities.includes(c.key) ? 'checked' : '') + '><span>' + e(c.city) + ', ' + e(c.state) + '</span></label>').join('') || '<span class="muted">No cities on your plan yet.</span>') + '</div></fieldset><small class="muted">Cities apply to sellers only. Use Deactivate on the list to block access, or New password to reset it.</small>', '<button class="primary" type="submit">Save</button>'); }
  if (m.kind === 'pw') return wrap('New password', '<input type="hidden" name="id" value="' + m.id + '"><label>Password<input name="password" type="password" required minlength="16" autocomplete="new-password"></label><small class="muted">At least 16 characters. The member is signed out.</small>', '<button class="primary" type="submit">Save</button>');
  if (m.kind === 'visit') return wrap(e(p.address || 'Site visit'), '<label>Measurements<textarea name="measurements" rows="4" placeholder="Rooms, linear ft, sq ft, panel size…"></textarea></label><label>Notes for the office<textarea name="notes" rows="3" placeholder="Access, owner remarks, materials…"></textarea></label><label>Photos (up to 6)<input type="file" name="photos" accept="image/*" multiple data-photos></label><div class="cl-photos" id="vthumbs"></div>', '<button class="primary" type="submit">Send visit</button>');
  if (m.kind === 'estreq') { const x = m.edit || {}; return wrap('Request an estimate', '<p class="muted">' + e(p?.address || x.address || '') + ', ' + e(p?.city || x.city || '') + '</p><div class="cl-callout"><b>The Owner creates and sends estimates.</b><small>Submit the job information; the customer receives the estimate by e-mail from the Owner.</small></div><input type="hidden" name="id" value="' + (x.id || '') + '"><input type="hidden" name="permitKey" value="' + e(p?.key || '') + '"><input type="hidden" name="address" value="' + e(p?.address || '') + '"><input type="hidden" name="city" value="' + e(p?.city || '') + '"><input type="hidden" name="state" value="' + e(p?.state || '') + '"><div class="form-grid"><label>Customer name<input name="prospectName" value="' + e(x.prospectName) + '" maxlength="120"></label><label>Customer e-mail<input name="prospectEmail" type="email" value="' + e(x.prospectEmail) + '"></label></div><label>Scope notes<textarea name="scope" rows="3" placeholder="What work does the customer need?">' + e(x.scope) + '</textarea></label><label>Job measurements<input name="measurements" value="' + e(x.measurements) + '" maxlength="2000" placeholder="Approx. 1,200 sq ft"></label>', '<button type="submit" name="act" value="draft">Save draft</button><button class="primary" type="submit" name="act" value="submit">Submit to Owner</button>'); }
  if (m.kind === 'fu') { const x = m.edit || {}, due = x.dueAt || (new Date().toLocaleDateString('en-CA') + 'T10:00'); return wrap(x.id ? 'Edit follow-up' : 'New follow-up', '<input type="hidden" name="id" value="' + (x.id || '') + '"><label>Task<input name="task" value="' + e(x.task) + '" required maxlength="160" placeholder="Call the customer"></label><div class="form-grid"><label>Date<input type="date" name="date" value="' + e(due.slice(0, 10)) + '" required></label><label>Time<input type="time" name="time" value="' + e(due.slice(11, 16)) + '" required></label><label>Type<select name="kind">' + ['call', 'email', 'meeting', 'task'].map(k => '<option value="' + k + '" ' + (x.kind === k ? 'selected' : '') + '>' + k[0].toUpperCase() + k.slice(1) + '</option>').join('') + '</select></label></div><label>Notes<textarea name="notes" rows="3">' + e(x.notes) + '</textarea></label>', '<button class="primary" type="submit">Save follow-up</button>'); }
  return '';
}

// ---------- Owner business: Overview, Invoices, Jobs, CRM, Price calculator ----------
const money2 = v => '$' + Number(v || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const today = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'America/New_York'});
const ISTAT = {draft: ['Draft', 'st-muted'], sent: ['Sent', 'st-purple'], partial: ['Partial', 'st-warn'], paid: ['Paid', 'st-ok'], void: ['Void', 'st-muted']};
const ipill = i => '<span class="pill ' + ISTAT[i.status][1] + '">' + ISTAT[i.status][0] + '</span>' + (i.overdue ? ' <span class="pill st-warn">Overdue</span>' : '');
const statCard = (l, v, sub) => '<div><small>' + l + '</small><b>' + v + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>';
const MONTH = m => new Date(m + '-15T12:00:00Z').toLocaleString('en-US', {month: 'short', timeZone: 'UTC'});

function overviewView() {
  const o = st.ov; if (!o) return '<p class="muted">Loading…</p>';
  const mx = Math.max(1, ...o.flow.flatMap(f => [f.in, f.out]));
  const flow = o.flow.map(f => '<tr><td>' + MONTH(f.month) + '</td><td><div class="cl-bar"><i data-w="' + Math.round(f.in / mx * 100) + '"></i></div><small>' + money(f.in) + ' in</small></td><td><div class="cl-bar out"><i data-w="' + Math.round(f.out / mx * 100) + '"></i></div><small>' + money(f.out) + ' out</small></td></tr>').join('');
  const top = o.jobs.top.map(j => '<tr><td>' + e(j.name) + '</td><td>' + money(j.invoiced) + '</td><td>' + money(j.spent) + '</td><td><b>' + money(j.profit) + '</b> <small>' + j.margin + '%</small></td></tr>').join('');
  const es = o.estimates;
  return title('Overview', 'Cash, jobs, estimates and crew at a glance.')
    + '<section class="cl-stats">' + statCard('Cash balance', money(o.cash.balance), money(o.cash.received) + ' received − ' + money(o.cash.spent) + ' spent') + statCard('Outstanding', money(o.cash.outstanding), o.cash.overdueCount ? money(o.cash.overdue) + ' overdue (' + o.cash.overdueCount + ')' : 'Nothing overdue') + statCard('Active jobs', o.jobs.active, o.jobs.planned + ' planned') + statCard('Permits this month', num(o.permits.used), 'of ' + num(o.permits.limit)) + '</section>'
    + '<div class="cl-two"><section class="panel"><h2>Cash flow · last 6 months</h2><table class="cl-table"><tbody>' + flow + '</tbody></table></section>'
    + '<section class="panel"><h2>Pipeline</h2><div class="cl-list"><div><span>Waiting for you</span><b>' + (es.with_owner + es.changes_requested) + '</b></div><div><span>In review with seller</span><b>' + es.review_requested + '</b></div><div><span>Approved</span><b>' + es.approved + '</b></div><div><span>Sent to customers</span><b>' + es.sent + '</b></div><div><span>Leads &amp; quoted customers</span><b>' + o.customers.leads + '</b></div><div><span>Crew on the clock · week</span><b>' + o.crew.onClock + ' · ' + hm(o.crew.weekHours) + '</b></div></div></section></div>'
    + '<section class="panel flush"><div class="cl-count"><span><b>Most profitable jobs</b></span></div><div class="table-scroll"><table class="cl-table"><thead><tr><th>Job</th><th>Invoiced</th><th>Spent</th><th>Profit</th></tr></thead><tbody>' + top + '</tbody></table></div>' + (top ? '' : '<p class="empty">Jobs appear here once they have invoices or expenses.</p>') + '</section>';
}
function invoicesView() {
  const d = st.inv; if (!d) return '<p class="muted">Loading…</p>';
  const rows = d.invoices.map(i => '<tr><td><b>' + e(i.number) + '</b><small>' + e(i.issuedOn) + '</small></td><td>' + e(i.toName) + '<small>' + e(i.toEmail) + '</small></td><td>' + e(i.jobName) + '</td><td>' + money2(i.total) + '</td><td>' + money2(i.balance) + '</td><td>' + (i.dueOn ? e(i.dueOn) : '—') + '</td><td>' + ipill(i) + '</td><td class="rowact">'
    + (i.status === 'draft' ? '<button type="button" data-action="o-inv-edit" data-id="' + i.id + '">Edit</button><button type="button" class="primary" data-action="o-inv-send" data-id="' + i.id + '">Send</button><button type="button" class="danger" data-action="o-inv-del" data-id="' + i.id + '">Delete</button>'
      : i.status === 'void' ? '' : '<button type="button" data-action="o-inv-view" data-id="' + i.id + '">Open</button>' + (['sent', 'partial'].includes(i.status) ? '<button type="button" class="primary" data-action="o-inv-pay" data-id="' + i.id + '">Record payment</button>' : '')) + '</td></tr>').join('');
  return title('Invoices', 'Create invoices, send them with a PDF and record the payments you receive. Moriah does not process payments.')
    + '<section class="cl-stats">' + statCard('Outstanding', money2(d.totals.outstanding)) + statCard('Overdue', money2(d.totals.overdue)) + statCard('Received', money2(d.totals.paid)) + '</section>'
    + '<div class="toolbar"><button type="button" class="primary" data-action="o-inv-new">New invoice</button></div>'
    + '<section class="panel flush"><div class="table-scroll"><table class="cl-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Job</th><th>Total</th><th>Balance</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (rows ? '' : '<p class="empty">No invoices yet.</p>') + '</section>';
}
function jobsView() {
  const d = st.jobsData; if (!d) return '<p class="muted">Loading…</p>';
  const have = new Set(d.jobs.map(j => j.estimateId).filter(Boolean)), pend = (st.estimates || []).filter(x => x.status === 'sent' && !have.has(x.id));
  const cards = d.jobs.map(j => '<article class="panel cl-job"><header><div><h2>' + e(j.name) + '</h2><small>' + e(j.address) + (j.customerName ? ' · ' + e(j.customerName) : '') + '</small></div><select data-o-jobstatus="' + j.id + '">' + ['planned', 'active', 'done'].map(x => '<option value="' + x + '" ' + (j.status === x ? 'selected' : '') + '>' + x[0].toUpperCase() + x.slice(1) + '</option>').join('') + '</select></header>'
    + '<div class="cl-stats">' + statCard('Contract', money(j.contract)) + statCard('Invoiced', money(j.invoiced), money(j.received) + ' received') + statCard('Spent', money(j.spent)) + statCard('Profit', money(j.profit), j.margin + '% margin · cash ' + money(j.cash)) + '</div>'
    + '<form class="cl-exp" data-form="o-expense"><input type="hidden" name="jobId" value="' + j.id + '"><select name="category">' + d.categories.map(c => '<option>' + c + '</option>').join('') + '</select><input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount" required><input name="vendor" placeholder="Vendor / note"><button type="submit">Add expense</button></form>'
    + (j.expenses.length ? '<table class="cl-table"><tbody>' + j.expenses.map(x => '<tr><td>' + e(x.spentOn) + '</td><td>' + e(x.category) + '</td><td>' + e(x.vendor) + '</td><td>' + money2(x.amount) + '</td><td class="rowact"><button type="button" class="danger" data-action="o-exp-del" data-id="' + x.id + '">Remove</button></td></tr>').join('') + '</tbody></table>' : '')
    + '<footer><button type="button" data-action="o-inv-from-job" data-id="' + j.id + '">Create invoice for this job</button></footer></article>').join('');
  return title('Jobs', 'Every job with its invoices, payments and expenses, so you see real profit.')
    + (pend.length ? '<section class="panel"><h2>Sent estimates without a job</h2>' + pend.map(x => '<div class="cl-line"><span>' + e(x.address) + ' · ' + e(x.prospectName) + ' · ' + money(x.total) + '</span><button type="button" class="primary" data-action="o-job-from-est" data-id="' + x.id + '">Create job</button></div>').join('') + '</section>' : '')
    + '<form class="panel settings-panel" data-form="o-job"><h2>New job</h2><div class="form-grid"><label>Name<input name="name" required maxlength="120"></label><label>Address<input name="address" maxlength="200"></label><label>Contract amount<input name="contract" type="number" min="0" step="0.01"></label><label>Status<select name="status"><option value="planned">Planned</option><option value="active">Active</option></select></label></div><button class="primary" type="submit">Add job</button></form>'
    + (cards || '<p class="empty">No jobs yet.</p>');
}
function crmView() {
  const d = st.crm; if (!d) return '<p class="muted">Loading…</p>';
  const chips = ['', ...d.statuses].map(s => '<button type="button" class="chip ' + (st.crmStatus === s ? 'active' : '') + '" data-action="o-crm-filter" data-id="' + s + '">' + (s ? s[0].toUpperCase() + s.slice(1) + ' · ' + d.counts[s] : 'All') + '</button>').join('');
  const rows = d.customers.map(c => '<tr class="clickrow" data-action="o-crm-open" data-id="' + c.id + '"><td><b>' + e(c.name) + '</b><small>' + e(c.email) + (c.phone ? ' · ' + e(c.phone) : '') + '</small></td><td><span class="pill st-purple">' + e(c.status) + '</span></td><td>' + e(c.source || '—') + '</td><td>' + c.jobs + '</td><td>' + money(c.billed) + '</td><td>' + (c.balance > 0 ? money(c.balance) : '—') + '</td></tr>').join('');
  return title('CRM', 'Leads and customers, notes and everything that happened with each one.')
    + '<div class="toolbar"><label class="searchbox">' + icon('search') + '<input type="search" data-o-crmq value="' + e(st.crmQ || '') + '" placeholder="Search name, e-mail, phone or address"></label><button type="button" class="primary" data-action="o-crm-new">Add customer</button></div><div class="cl-seg">' + chips + '</div>'
    + '<section class="panel flush"><div class="table-scroll"><table class="cl-table"><thead><tr><th>Customer</th><th>Status</th><th>Source</th><th>Jobs</th><th>Billed</th><th>Balance</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (rows ? '' : '<p class="empty">No customers here yet. Customers are added automatically when you send an estimate.</p>') + '</section>';
}
function calcTotals() {
  const p = st.prices; if (!p) return {items: [], subtotal: 0, tax: 0, total: 0, cost: 0};
  const mk = Number(st.calc.markup) || 0, tx = Number(st.calc.tax) || 0, items = []; let cost = 0;
  for (const it of p.items) { const q = Number(st.calc.qty[it.id]); if (q > 0) { items.push({id: it.id, description: it.name + ' (' + it.unit + ')', qty: q, price: Math.round(it.price * (1 + mk / 100) * 100) / 100}); cost += q * it.cost; } }
  const subtotal = items.reduce((t, i) => t + i.qty * i.price, 0), tax = subtotal * tx / 100;
  return {items, subtotal, tax, total: subtotal + tax, cost};
}
function pricesView() {
  const p = st.prices; if (!p) return '<p class="muted">Loading…</p>';
  const trade = st.calc.trade || p.myTrades[0] || p.trades[0], list = p.items.filter(i => i.trade === trade), t = calcTotals();
  const calcRows = list.map(i => '<tr><td>' + e(i.name) + '<small>' + money2(i.price) + ' per ' + e(i.unit) + '</small></td><td><input type="number" min="0" step="any" data-o-qty="' + i.id + '" value="' + e(st.calc.qty[i.id] || '') + '" placeholder="Qty" aria-label="Quantity"></td></tr>').join('');
  const editRows = list.map(i => '<form class="cl-priceedit" data-form="o-price"><input type="hidden" name="id" value="' + i.id + '"><input type="hidden" name="trade" value="' + e(i.trade) + '"><input name="name" value="' + e(i.name) + '" required aria-label="Item"><input name="unit" value="' + e(i.unit) + '" aria-label="Unit"><input name="price" type="number" step="0.01" min="0" value="' + i.price + '" aria-label="Price"><input name="cost" type="number" step="0.01" min="0" value="' + i.cost + '" aria-label="Your cost"><button type="submit">Save</button><button type="button" class="danger" data-action="o-price-del" data-id="' + i.id + '">Remove</button></form>').join('');
  return title('Price calculator', 'Pick a trade, enter quantities and get a quote total with your cost and margin.')
    + '<div class="cl-seg">' + p.trades.map(x => '<button type="button" class="chip ' + (x === trade ? 'active' : '') + '" data-action="o-calc-trade" data-id="' + e(x) + '">' + e(x) + '</button>').join('') + '</div>'
    + '<div class="cl-two"><section class="panel flush"><table class="cl-table"><tbody>' + calcRows + '</tbody></table></section>'
    + '<section class="panel"><h2>Quote</h2><div class="form-grid"><label>Markup %<input type="number" min="0" max="500" step="0.5" data-o-markup value="' + e(st.calc.markup) + '"></label><label>Sales tax %<input type="number" min="0" max="30" step="0.25" data-o-tax value="' + e(st.calc.tax) + '"></label></div>'
    + '<div class="cl-list"><div><span>Subtotal</span><b>' + money2(t.subtotal) + '</b></div><div><span>Tax</span><b>' + money2(t.tax) + '</b></div><div><span>Total</span><b>' + money2(t.total) + '</b></div><div><span>Your cost</span><b>' + money2(t.cost) + '</b></div><div><span>Profit</span><b>' + money2(t.subtotal - t.cost) + ' · ' + (t.subtotal > 0 ? Math.round((t.subtotal - t.cost) / t.subtotal * 1000) / 10 : 0) + '%</b></div></div>'
    + '<button type="button" class="primary" data-action="o-calc-invoice" ' + (t.items.length ? '' : 'disabled') + '>Create invoice from this</button></section></div>'
    + '<section class="panel"><h2>' + e(trade) + ' price list</h2><p class="muted">' + e(p.disclaimer) + '</p><div class="cl-priceedit head"><span>Item</span><span>Unit</span><span>Your price</span><span>Your cost</span><span></span><span></span></div>' + editRows
    + '<form class="cl-priceedit add" data-form="o-price"><input type="hidden" name="trade" value="' + e(trade) + '"><input name="name" placeholder="New item" required><input name="unit" placeholder="unit" value="each"><input name="price" type="number" step="0.01" min="0" placeholder="Price" required><input name="cost" type="number" step="0.01" min="0" placeholder="Cost"><button type="submit" class="primary">Add item</button></form>'
    + '<footer class="drawer-foot"><button type="button" class="danger" data-action="o-price-reset">Restore starting prices</button></footer></section>';
}
function invLineRow(i = {}) { return '<div class="cl-li"><input name="desc" placeholder="Description" value="' + e(i.description || '') + '"><input name="qty" type="number" min="0" step="any" placeholder="Qty" value="' + e(i.qty ?? 1) + '"><input name="price" type="number" min="0" step="0.01" placeholder="Price" value="' + e(i.price ?? '') + '"><button type="button" class="danger" data-action="o-inv-rm" aria-label="Remove line">×</button></div>'; }
function ownerModal(m) {
  const close = '<button type="button" data-action="mclose" aria-label="Close">×</button>', ov = (h, body) => '<div class="overlay"><div class="modal">' + '<header><h2>' + h + '</h2>' + close + '</header>' + body + '</div></div>';
  if (m.kind === 'o-pick') {
    const res = (m.results || []).map((x, k) => '<div class="cl-line"><span><b>' + e(x.address) + '</b><small>' + e(x.city) + ', ' + e(x.state) + '</small></span><button type="button" class="primary" data-action="o-pick-permit" data-id="' + k + '">Select</button></div>').join('');
    return ov('New estimate request', '<p class="muted">Choose a permit from your cities, or type the job address.</p><label class="searchbox">' + icon('search') + '<input type="search" data-o-pickq value="' + e(m.q || '') + '" placeholder="Search permits by address or number" aria-label="Search permits"></label><div class="cl-pickres">' + (res || '<p class="empty">' + (m.q ? 'No permits found.' : 'Your favorites appear here. Search to find a permit.') + '</p>') + '</div><h3>Or enter an address</h3><form data-form="o-pickman" class="cl-exp"><input name="address" placeholder="Job address" required minlength="5"><input name="city" placeholder="City"><input name="state" placeholder="MA" maxlength="2"><button class="primary" type="submit">Continue</button></form>');
  }
  if (m.kind === 'o-inv') {
    const i = m.inv || {items: [{}], taxRate: 0}, cust = (st.crmAll || []).map(c => '<option value="' + c.id + '" ' + (i.customerId === c.id ? 'selected' : '') + '>' + e(c.name) + '</option>').join(''), jobs = ((st.jobsData || {}).jobs || []).map(j => '<option value="' + j.id + '" ' + (i.jobId === j.id ? 'selected' : '') + '>' + e(j.name) + '</option>').join('');
    return ov(i.id ? 'Edit ' + e(i.number) : 'New invoice', '<form data-form="o-inv"><input type="hidden" name="id" value="' + (i.id || '') + '"><div class="form-grid"><label>Customer<select name="customerId" data-o-custpick><option value="">—</option>' + cust + '</select></label><label>Job<select name="jobId"><option value="">—</option>' + jobs + '</select></label><label>Bill to (name)<input name="toName" value="' + e(i.toName || '') + '" required></label><label>E-mail<input name="toEmail" type="email" value="' + e(i.toEmail || '') + '"></label><label>Issue date<input name="issuedOn" type="date" value="' + e(i.issuedOn || today()) + '"></label><label>Due date<input name="dueOn" type="date" value="' + e(i.dueOn || '') + '"></label></div><h3>Line items</h3><div id="o-lines">' + (i.items.length ? i.items : [{}]).map(invLineRow).join('') + '</div><button type="button" data-action="o-inv-add">Add line</button><div class="form-grid"><label>Sales tax %<input name="taxRate" type="number" min="0" max="30" step="0.25" value="' + (i.taxRate || 0) + '"></label><label>Notes<input name="notes" value="' + e(i.notes || '') + '"></label></div><footer class="drawer-foot"><button type="button" data-action="mclose">Cancel</button><button class="primary" type="submit">Save draft</button></footer></form>');
  }
  if (m.kind === 'o-pay') {
    const i = m.inv; return ov('Invoice ' + e(i.number), '<p class="muted">Total ' + money2(i.total) + ' · paid ' + money2(i.paid) + ' · balance <b>' + money2(i.balance) + '</b></p>' + (i.payments.length ? '<table class="cl-table"><tbody>' + i.payments.map(p => '<tr><td>' + e(p.paidOn) + '</td><td>' + e(p.method) + '</td><td>' + money2(p.amount) + '</td><td class="rowact"><button type="button" class="danger" data-action="o-pay-del" data-id="' + p.id + '">Remove</button></td></tr>').join('') + '</tbody></table>' : '')
      + (i.balance > 0 && i.status !== 'void' ? '<form data-form="o-pay"><input type="hidden" name="id" value="' + i.id + '"><div class="form-grid"><label>Amount<input name="amount" type="number" step="0.01" min="0.01" max="' + i.balance + '" value="' + i.balance + '" required></label><label>Method<select name="method">' + st.inv.methods.map(x => '<option>' + x + '</option>').join('') + '</select></label><label>Date<input name="paidOn" type="date" value="' + today() + '"></label><label>Note<input name="note" maxlength="300"></label></div><footer class="drawer-foot"><button type="button" data-action="o-inv-send" data-id="' + i.id + '">Re-send invoice</button>' + (i.payments.length ? '<button type="button" data-action="o-inv-receipt" data-id="' + i.id + '">E-mail receipt</button>' : '') + '<button class="primary" type="submit">Record payment</button></footer></form>' : '<footer class="drawer-foot"><button type="button" data-action="o-inv-receipt" data-id="' + i.id + '">E-mail receipt</button></footer>'));
  }
  if (m.kind === 'o-cust') {
    const c = m.detail ? m.detail.customer : {status: 'lead'}, tl = m.detail ? m.detail.timeline.map(t => '<div class="cl-tl"><b>' + e(t.kind) + '</b><span>' + e(t.text) + (t.amount ? ' · ' + money(t.amount) : '') + '</span><small>' + when(t.at) + (t.by ? ' · ' + e(t.by) : '') + '</small></div>').join('') : '';
    return ov(c.id ? e(c.name) : 'New customer', '<form data-form="o-cust"><input type="hidden" name="id" value="' + (c.id || '') + '"><div class="form-grid"><label>Name<input name="name" value="' + e(c.name || '') + '" required></label><label>E-mail<input name="email" type="email" value="' + e(c.email || '') + '"></label><label>Phone<input name="phone" value="' + e(c.phone || '') + '"></label><label>Address<input name="address" value="' + e(c.address || '') + '"></label><label>Status<select name="status">' + ['lead', 'quoted', 'active', 'past'].map(s => '<option ' + (c.status === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></label><label>Source<input name="source" value="' + e(c.source || '') + '" placeholder="Referral, permit, ad…"></label></div><button class="primary" type="submit">Save customer</button></form>'
      + (c.id ? '<form data-form="o-note" class="cl-exp"><input type="hidden" name="id" value="' + c.id + '"><input name="text" placeholder="Add a note (call, visit, quote…)" required><button type="submit">Add note</button></form><h3>Timeline</h3>' + tl : ''));
  }
  return '';
}

function render() {
  const r = !st.me ? loginView() : shell(({overview: overviewView, invoices: invoicesView, jobs: jobsView, crm: crmView, prices: pricesView, clock: clockView, time: timeView, radar: radarView, lists: listsView, estimates: estimatesView, followups: followupsView, visits: visitsView, team: teamView, profile: profileView})[st.tab]() || '');
  $('#app').innerHTML = r;
  for (const i of document.querySelectorAll('[data-w]')) i.style.width = i.dataset.w + '%';
  recalc();
}
async function load() { try { st.data = await api('/api/client/permits?' + query()); } catch (err) { if (err.status === 401) { st.me = null; st.data = null; } else toast(err.message); } render(); }
async function enter(tab) {
  st.tab = tab; st.drawer = null; st.modal = null; render();
  if (tab === 'radar') return load();
  if (tab === 'lists') { st.lists = (await api('/api/client/lists')).lists; return openList(st.listId); }
  if (tab === 'estimates') { st.estimates = (await api('/api/client/estimates')).estimates; return render(); }
  if (tab === 'followups') { st.followups = await api('/api/client/followups'); return render(); }
  if (tab === 'visits') { st.visits = (await api('/api/client/visits')).visits; return render(); }
  if (tab === 'overview') { await oReload('ov'); return render(); }
  if (tab === 'invoices') { await oReload('inv'); return render(); }
  if (tab === 'jobs') { await oReload('jobs'); await oReload('crm'); return render(); }
  if (tab === 'crm') { await oReload('crm'); return render(); }
  if (tab === 'prices') { await oReload('prices'); return render(); }
  if (tab === 'clock') { st.clock = await api('/api/client/clock'); return render(); }
  if (tab === 'time') { st.time = await api('/api/client/time'); return render(); }
  if (tab === 'profile') { st.profile = await api('/api/client/profile'); return render(); }
  if (tab === 'team') { st.team = await api('/api/client/team'); return render(); }
}
async function openList(id) { st.listId = id; st.listData = null; render(); st.listData = await api('/api/client/list-permits?listId=' + id + '&page=' + st.f.page); render(); }
async function openPermit(key) {
  const d = await api('/api/client/permit?key=' + key), v = await api('/api/client/visits?permitKey=' + key);
  if (!st.lists) st.lists = (await api('/api/client/lists')).lists;
  st.drawer = {...d, visits: v.visits}; render();
}
async function start() { try { st.me = (await api('/api/client/me')).client; await enter(st.me.role === 'employee' ? 'clock' : st.me.role === 'owner' ? 'overview' : 'radar'); } catch { st.me = null; render(); } }
function csv(rows) { const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'; return [['Issued', 'City', 'State', 'Address', 'Permit', 'Type', 'Value', 'Description', 'Contractor', 'Owner'].map(q).join(','), ...rows.map(p => [p.issued, p.city, p.state, p.address, p.number, p.type, p.value, p.description, p.contractor, p.owner].map(q).join(','))].join('\r\n'); }
async function shrink(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [.8, .65, .5, .4]) { const u = c.toDataURL('image/jpeg', q); if (u.length < 390000) return u; }
  throw new Error('Photo is too large.');
}
const refreshAfter = async () => { if (st.tab === 'radar') await load(); else if (st.tab === 'lists') await openList(st.listId); else render(); };

document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-action]'); if (!t) return; const a = t.dataset.action, id = t.dataset.id;
  if (a === 'fav' || ev.target.closest('.starcell')) { ev.stopPropagation(); }
  try {
    if (a === 'logout') { await api('/api/client/logout', {}); st.me = null; return render(); }
    if (a === 'tab') { st.f.page = 1; return enter(id); }
    if (a === 'close') { st.drawer = null; st.modal = null; return render(); }
    if (a === 'mclose') { st.modal = null; return render(); }
    if (a === 'open') { if (ev.target.closest('.star')) return; return openPermit(id); }
    if (a === 'fav') { const all = [...(st.data?.permits || []), ...(st.listData?.permits || [])], p = all.find(x => x.key === id); await api('/api/client/favorite', {permitKey: id, on: !p?.fav}); st.lists = null; return refreshAfter(); }
    if (a === 'dfav') { const p = st.drawer.permit; await api('/api/client/favorite', {permitKey: p.key, on: !p.fav}); p.fav = !p.fav; st.lists = null; return render(); }
    if (a === 'refresh') { if (st.refreshing) return; st.refreshing = true; render(); try { const r = await api('/api/client/refresh', {city: st.f.city}); if (!r.queued) { st.refreshing = false; render(); return toast(r.message || 'Nothing to update for these cities.'); } toast('Fetching new permits for your cities…'); for (let i = 0; i < 90; i++) { await new Promise(z => setTimeout(z, 4000)); if (!(await api('/api/client/refresh')).active) break; } st.refreshing = false; await load(); return toast('Permits updated.'); } catch (err) { st.refreshing = false; render(); return toast(err.message); } }
    if (a === 'rkind') { st.f.kind = id || ''; st.f.page = 1; return load(); }
    if (a === 'rtab') { st.radarTab = id; st.f.page = 1; return load(); }
    if (a === 'list') { st.f.page = 1; return openList(id); }
    if (a === 'dellist') { await api('/api/client/lists', {op: 'delete', id: Number(id)}); st.lists = (await api('/api/client/lists')).lists; st.listId = 'fav'; return openList('fav'); }
    if (a === 'rmphoto') { const box = t.closest('.photo-box'); box.querySelector('input[type=hidden]').value = ''; const old = box.querySelector('.avatar'), sp = document.createElement('span'); sp.className = 'avatar big'; sp.textContent = '·'; old.replaceWith(sp); return; }
    if (a === 'punch') { t.disabled = true; const g = await where(); st.clock = await api('/api/client/clock', {op: id, ...g}); render(); return toast(id === 'in' ? 'Clocked in.' + (g.lat == null ? ' (location unavailable)' : '') : 'Clocked out.'); }
    if (a === 'prev') { st.f.page = Math.max(1, st.f.page - 1); return st.tab === 'lists' ? openList(st.listId) : load(); }
    if (a === 'next') { st.f.page += 1; return st.tab === 'lists' ? openList(st.listId) : load(); }
    if (a === 'route') { const r = await api('/api/client/permits?fav=1&page=1'), stops = r.permits.filter(p => p.address).slice(0, 9).map(p => encodeURIComponent([p.address, p.city, p.state].join(', '))); if (!stops.length) return toast('Favorite some permits first.'); window.open('https://www.google.com/maps/dir/' + stops.join('/'), '_blank', 'noopener'); return; }
    if (a === 'export') { const r = await api('/api/client/permits?' + query({export: 1, page: 1})), url = URL.createObjectURL(new Blob([csv(r.permits)], {type: 'text/csv'})), l = document.createElement('a'); l.href = url; l.download = 'moriah-permits.csv'; l.click(); URL.revokeObjectURL(url); toast(r.limits.capped ? 'Exported what your monthly limit allows (' + r.permits.length + ').' : 'Exported ' + r.permits.length + ' permits.'); return load(); }
    if (a === 'visit') { st.modal = {kind: 'visit', photos: []}; return render(); }
    if (a === 'reqest') { st.modal = {kind: 'estreq'}; return render(); }
    if (a === 'editest') { st.modal = {kind: 'estreq', edit: st.estimates.find(x => x.id === Number(id))}; return render(); }
    if (a === 'fuforpermit') { st.modal = {kind: 'fu', permit: st.drawer.permit}; return render(); }
    if (a === 'funew') { st.modal = {kind: 'fu'}; return render(); }
    if (a === 'fuedit') { st.modal = {kind: 'fu', edit: st.followups.followups.find(x => x.id === Number(id))}; return render(); }
    if (a === 'fudone' || a === 'fuundo') { await api('/api/client/followups', {op: 'complete', id: Number(id), undo: a === 'fuundo'}); st.followups = await api('/api/client/followups'); return render(); }
    if (a === 'futab') { st.fuTab = id; return render(); }
    if (a === 'addli') { $('#liRows').insertAdjacentHTML('beforeend', liRow({description: '', qty: 1, price: ''})); return; }
    if (a === 'rmli') { const rows = document.querySelectorAll('.cl-li'); if (rows.length > 1) t.closest('.cl-li').remove(); recalc(); return; }
    if (a === 'sendnow') { await api('/api/client/estimates', {op: 'send', id: st.modal.id}); st.modal = null; st.estimates = (await api('/api/client/estimates')).estimates; render(); return toast('Estimate sent to the customer.'); }
    if (a === 'est') { st.estSel = Number(id); return render(); }
    if (a === 'tedit') { st.modal = {kind: 'tedit', id: Number(id)}; return render(); }
    if (a === 'pw') { st.modal = {kind: 'pw', id}; return render(); }
    if (a === 'setActive') { await api('/api/client/team', {op: 'setActive', id: Number(id), active: t.dataset.on === '1'}); st.team = await api('/api/client/team'); return render(); }
  } catch (err) { toast(err.message); }
});
document.addEventListener('input', ev => { if (ev.target.closest('[data-estform]')) recalc(); });
document.addEventListener('change', async ev => {
  const el = ev.target;
  try {
    if (el.matches('[data-pphoto]')) { const f = el.files[0]; if (!f) return; const bmp = await createImageBitmap(f), kind = el.dataset.pphoto, sz = kind === 'co' ? 320 : 256, c = document.createElement('canvas'); c.width = c.height = sz; const k = Math.max(sz / bmp.width, sz / bmp.height), w = bmp.width * k, h = bmp.height * k; c.getContext('2d').drawImage(bmp, (sz - w) / 2, (sz - h) / 2, w, h); const url = c.toDataURL('image/jpeg', .85), box = el.closest('.photo-box'); box.querySelector('input[type=hidden]').value = url; const old = box.querySelector('.avatar'), im = document.createElement('img'); im.className = 'avatar big'; im.src = url; im.alt = ''; old.replaceWith(im); return; }
    if (el.matches('[data-rphotos]')) { st.rphotos = []; for (const f of [...el.files].slice(0, 6)) st.rphotos.push(await shrink(f)); $('#rthumbs').innerHTML = st.rphotos.map(u => '<img src="' + u + '" alt="">').join(''); return; }
    if (el.matches('[data-photos]')) { st.modal.photos = []; for (const f of [...el.files].slice(0, 6)) st.modal.photos.push(await shrink(f)); $('#vthumbs').innerHTML = st.modal.photos.map(u => '<img src="' + u + '" alt="">').join(''); return; }
    if (el.matches('[data-city]')) { st.f.city = [...document.querySelectorAll('[data-city]')].filter(x => x.checked).map(x => x.dataset.city); return; }
    if (el.matches('[data-addlist]') && el.value) { await api('/api/client/lists', {op: 'item', id: Number(el.value), permitKey: st.drawer.permit.key, on: true}); st.drawer.lists.push(Number(el.value)); st.lists = (await api('/api/client/lists')).lists; return render(); }
    if (el.matches('[data-note]')) { await api('/api/client/note', {permitKey: st.drawer.permit.key, note: el.value}); st.drawer.note = el.value; toast('Note saved.'); }
  } catch (err) { toast(err.message); }
});
document.addEventListener('submit', async ev => {
  ev.preventDefault(); const form = ev.target, v = Object.fromEntries(new FormData(form)), act = ev.submitter?.value, kind = form.dataset.form;
  try {
    if (kind === 'login') { await api('/api/client/login', {email: v.email, password: v.password}); st.error = ''; st.me = (await api('/api/client/me')).client; await enter(st.me.role === 'employee' ? 'clock' : st.me.role === 'owner' ? 'overview' : 'radar'); return; }
    if (kind === 'filters') { Object.assign(st.f, {from: v.from || '', to: v.to || '', state: v.state || '', trade: v.trade || '', scope: v.scope || '', q: v.q || '', page: 1}); return load(); }
    if (kind === 'newlist') { const r = await api('/api/client/lists', {op: 'create', name: v.name}); st.lists = (await api('/api/client/lists')).lists; return openList(r.id); }
    if (kind === 'visit') { await api('/api/client/visits', {permitKey: st.drawer.permit.key, measurements: v.measurements, notes: v.notes, photos: st.modal.photos}); st.modal = null; st.drawer.visits = (await api('/api/client/visits?permitKey=' + st.drawer.permit.key)).visits; render(); return toast('Visit sent to the office.'); }
    if (kind === 'estreq') { await api('/api/client/estimates', {op: 'save', id: Number(v.id) || undefined, permitKey: v.permitKey, address: v.address, city: v.city, state: v.state, prospectName: v.prospectName, prospectEmail: v.prospectEmail, scope: v.scope, measurements: v.measurements, submit: act === 'submit'}); st.modal = null; st.estimates = (await api('/api/client/estimates')).estimates; render(); return toast(act === 'submit' ? 'Sent to the Owner.' : 'Draft saved.'); }
    if (kind === 'fu') { await api('/api/client/followups', {op: 'save', id: Number(v.id) || undefined, task: v.task, kind: v.kind, notes: v.notes, dueAt: v.date + 'T' + v.time, permitKey: st.modal.permit?.key, address: st.modal.permit?.address}); st.modal = null; st.followups = await api('/api/client/followups'); render(); return toast('Follow-up saved.'); }
    if (kind === 'prepare') {
      const fd = new FormData(form), d = fd.getAll('li_desc'), q = fd.getAll('li_qty'), pr = fd.getAll('li_price');
      const lineItems = d.map((x, i) => ({description: x, qty: q[i], price: pr[i]})).filter(i => i.description.trim() || i.price);
      await api('/api/client/estimates', {op: 'prepare', id: Number(v.id), lineItems, taxRate: v.taxRate, internalCost: v.internalCost, description: v.description, ownerNote: v.ownerNote, requestReview: act === 'review'});
      st.estimates = (await api('/api/client/estimates')).estimates;
      if (act === 'send') { st.modal = {kind: 'sendest', id: Number(v.id)}; return render(); }
      render(); return toast(act === 'review' ? 'Sent to the salesperson for review.' : 'Saved.');
    }
    if (kind === 'feedback') { await api('/api/client/estimates', {op: 'feedback', id: Number(v.id), approve: act === 'approve', text: v.text}); st.estimates = (await api('/api/client/estimates')).estimates; render(); return toast(act === 'approve' ? 'Approved for the Owner to send.' : 'Changes requested.'); }
    if (kind === 'team') { await api('/api/client/team', {name: v.name, email: v.email, role: v.role, password: v.password, cities: new FormData(form).getAll('city')}); st.team = await api('/api/client/team'); render(); return toast('Team member added.'); }
    if (kind === 'profile') { const body = {name: v.name, title: v.title, phone: v.phone, photo: v.photo}; if (st.profile.canEditCompany) body.company = {name: v.co_name, contactName: v.co_contactName, contactEmail: v.co_contactEmail, contactPhone: v.co_contactPhone, address: v.co_address, website: v.co_website, logo: v.logo}; st.profile = await api('/api/client/profile', body); st.me = (await api('/api/client/me')).client; render(); return toast('Profile saved.'); }
    if (kind === 'mypw') { await api('/api/client/profile', {op: 'password', current: v.current, password: v.password}); form.reset(); return toast('Password updated.'); }
    if (kind === 'report') { const g = await where(); await api('/api/client/report', {note: v.note, photos: st.rphotos || [], ...g}); st.rphotos = []; st.clock = await api('/api/client/clock'); render(); return toast('Sent to the office.'); }
    if (kind === 'rate') { await api('/api/client/time', {id: Number(v.id), rate: Number(v.rate)}); st.time = await api('/api/client/time'); render(); return toast('Rate saved.'); }
    if (kind === 'tedit') { await api('/api/client/team', {id: Number(v.id), name: v.name, email: v.email, role: v.role, cities: new FormData(form).getAll('city')}); st.team = await api('/api/client/team'); st.modal = null; render(); return toast('Team member updated.'); }
    if (kind === 'pw') { await api('/api/client/team', {op: 'setPassword', id: Number(v.id), password: v.password}); st.modal = null; render(); return toast('Password updated.'); }
  } catch (err) { if (kind === 'login') { st.error = err.message; render(); } else toast(err.message); }
});
start();
// ---- owner business: events ----
const oApi = (path, body) => api('/api/client/' + path, body);
async function oReload(what) {
  if (what === 'inv') st.inv = await oApi('invoices');
  if (what === 'jobs') { st.jobsData = await oApi('jobs'); st.estimates = (await oApi('estimates')).estimates; }
  if (what === 'crm') { const q = new URLSearchParams({q: st.crmQ || '', status: st.crmStatus || ''}); st.crm = await oApi('customers?' + q); st.crmAll = (await oApi('customers')).customers; }
  if (what === 'prices') st.prices = await oApi('prices');
  if (what === 'ov') st.ov = await oApi('overview');
}
function keepFocus(sel) { render(); const el = document.querySelector(sel); if (el) { el.focus(); try { const n = el.value.length; el.setSelectionRange(n, n); } catch { /* number inputs */ } } }
async function openInvoiceModal(inv) { if (!st.jobsData) await oReload('jobs'); if (!st.crmAll) await oReload('crm'); st.modal = {kind: 'o-inv', inv}; render(); }
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-action^="o-"]'); if (!t) return; const a = t.dataset.action, id = t.dataset.id, num2 = Number(id);
  try {
    if (a === 'o-est-new') { st.modal = {kind: 'o-pick', q: '', results: (await api('/api/client/permits?fav=1&page=1')).permits}; return render(); }
    if (a === 'o-pick-permit') { st.modal = {kind: 'estreq', permit: st.modal.results[num2]}; return render(); }
    if (a === 'o-inv-new') return openInvoiceModal(null);
    if (a === 'o-inv-edit') return openInvoiceModal(st.inv.invoices.find(i => i.id === num2));
    if (a === 'o-inv-add') return document.querySelector('#o-lines').insertAdjacentHTML('beforeend', invLineRow());
    if (a === 'o-inv-rm') { const box = $('#o-lines'); if (box.children.length > 1) t.closest('.cl-li').remove(); return; }
    if (a === 'o-inv-view' || a === 'o-inv-pay') { st.modal = {kind: 'o-pay', inv: st.inv.invoices.find(i => i.id === num2)}; return render(); }
    if (a === 'o-inv-del') { if (!confirm('Delete this draft?')) return; await oApi('invoices', {op: 'delete', id: num2}); await oReload('inv'); return render(); }
    if (a === 'o-inv-send') { t.disabled = true; await oApi('invoices', {op: 'send', id: num2}); await oReload('inv'); if (st.modal?.kind === 'o-pay') st.modal.inv = st.inv.invoices.find(i => i.id === num2); render(); return toast('Invoice sent.'); }
    if (a === 'o-inv-receipt') { t.disabled = true; await oApi('invoices', {op: 'receipt', id: num2}); render(); return toast('Receipt sent.'); }
    if (a === 'o-pay-del') { const inv = st.modal.inv; await oApi('invoices', {op: 'removePayment', id: inv.id, paymentId: num2}); await oReload('inv'); st.modal.inv = st.inv.invoices.find(i => i.id === inv.id); return render(); }
    if (a === 'o-inv-from-job') { const j = st.jobsData.jobs.find(x => x.id === num2), c = (st.crmAll || []).find(x => x.id === j.customerId); return openInvoiceModal({items: [{}], taxRate: 0, jobId: j.id, customerId: j.customerId, toName: c?.name || '', toEmail: c?.email || ''}); }
    if (a === 'o-calc-invoice') { const t2 = calcTotals(), r = await oApi('prices', {op: 'calc', lines: t2.items.map(i => ({itemId: i.id, qty: i.qty})), markup: st.calc.markup, taxRate: st.calc.tax}); return openInvoiceModal({items: r.items, taxRate: Number(st.calc.tax) || 0}); }
    if (a === 'o-job-from-est') { await oApi('jobs', {op: 'fromEstimate', estimateId: num2}); await oReload('jobs'); render(); return toast('Job created.'); }
    if (a === 'o-exp-del') { await oApi('jobs', {op: 'delExpense', id: num2}); await oReload('jobs'); return render(); }
    if (a === 'o-crm-filter') { st.crmStatus = id; await oReload('crm'); return render(); }
    if (a === 'o-crm-new') { st.modal = {kind: 'o-cust', detail: null}; return render(); }
    if (a === 'o-crm-open') { st.modal = {kind: 'o-cust', detail: await oApi('customers?id=' + num2)}; return render(); }
    if (a === 'o-calc-trade') { st.calc.trade = id; return render(); }
    if (a === 'o-price-del') { await oApi('prices', {op: 'delete', id: num2}); await oReload('prices'); return render(); }
    if (a === 'o-price-reset') { if (!confirm('Replace your price list with the starting prices?')) return; await oApi('prices', {op: 'reset'}); st.calc.qty = {}; await oReload('prices'); render(); return toast('Starting prices restored.'); }
  } catch (err) { t.disabled = false; toast(err.message); }
});
document.addEventListener('submit', async ev => {
  const form = ev.target, kind = form.dataset.form; if (!kind || !kind.startsWith('o-')) return; ev.preventDefault();
  const v = Object.fromEntries(new FormData(form)), fd = new FormData(form);
  try {
    if (kind === 'o-pickman') { st.modal = {kind: 'estreq', permit: {key: '', address: v.address, city: v.city, state: v.state}}; render(); return; }
    if (kind === 'o-inv') { const d = fd.getAll('desc'), q = fd.getAll('qty'), p = fd.getAll('price'), items = d.map((x, i) => ({description: x, qty: q[i], price: p[i]})).filter(x => x.description || x.price); await oApi('invoices', {op: 'save', id: Number(v.id) || undefined, customerId: v.customerId, jobId: v.jobId, toName: v.toName, toEmail: v.toEmail, issuedOn: v.issuedOn, dueOn: v.dueOn, taxRate: v.taxRate, notes: v.notes, items}); st.modal = null; await oReload('inv'); st.tab = 'invoices'; render(); return toast('Draft saved. Use Send to e-mail it.'); }
    if (kind === 'o-pay') { await oApi('invoices', {op: 'payment', id: Number(v.id), amount: v.amount, method: v.method, paidOn: v.paidOn, note: v.note}); await oReload('inv'); const inv = st.inv.invoices.find(i => i.id === Number(v.id)); st.modal = inv.balance > 0 ? {kind: 'o-pay', inv} : null; render(); return toast('Payment recorded.'); }
    if (kind === 'o-expense') { await oApi('jobs', {op: 'expense', jobId: Number(v.jobId), category: v.category, amount: v.amount, vendor: v.vendor}); await oReload('jobs'); render(); return toast('Expense added.'); }
    if (kind === 'o-job') { await oApi('jobs', {op: 'save', name: v.name, address: v.address, contract: v.contract, status: v.status}); await oReload('jobs'); render(); return toast('Job added.'); }
    if (kind === 'o-cust') { const r = await oApi('customers', {op: 'save', id: Number(v.id) || undefined, name: v.name, email: v.email, phone: v.phone, address: v.address, status: v.status, source: v.source}); await oReload('crm'); st.modal = {kind: 'o-cust', detail: await oApi('customers?id=' + r.id)}; render(); return toast('Customer saved.'); }
    if (kind === 'o-note') { await oApi('customers', {op: 'note', id: Number(v.id), text: v.text}); await oReload('crm'); st.modal = {kind: 'o-cust', detail: await oApi('customers?id=' + v.id)}; return render(); }
    if (kind === 'o-price') { await oApi('prices', {op: 'save', id: Number(v.id) || undefined, trade: v.trade, name: v.name, unit: v.unit, price: v.price, cost: v.cost}); await oReload('prices'); render(); return toast('Saved.'); }
  } catch (err) { toast(err.message); }
});
let crmTimer;
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.matches('[data-o-qty]')) { st.calc.qty[el.dataset.oQty] = el.value; return keepFocus('[data-o-qty="' + el.dataset.oQty + '"]'); }
  if (el.matches('[data-o-markup]')) { st.calc.markup = el.value; return keepFocus('[data-o-markup]'); }
  if (el.matches('[data-o-tax]')) { st.calc.tax = el.value; return keepFocus('[data-o-tax]'); }
  if (el.matches('[data-o-pickq]')) { st.modal.q = el.value; clearTimeout(crmTimer); crmTimer = setTimeout(async () => { const q = st.modal.q.trim(); st.modal.results = (await api('/api/client/permits?page=1' + (q ? '&q=' + encodeURIComponent(q) : '&fav=1'))).permits; keepFocus('[data-o-pickq]'); }, 250); return; }
  if (el.matches('[data-o-crmq]')) { st.crmQ = el.value; clearTimeout(crmTimer); crmTimer = setTimeout(async () => { await oReload('crm'); keepFocus('[data-o-crmq]'); }, 250); }
});
document.addEventListener('change', async ev => {
  const el = ev.target;
  try {
    if (el.matches('[data-o-jobstatus]')) { const j = st.jobsData.jobs.find(x => x.id === Number(el.dataset.oJobstatus)); await oApi('jobs', {op: 'save', id: j.id, name: j.name, address: j.address, status: el.value, contract: j.contract, customerId: j.customerId, startDate: j.startDate, endDate: j.endDate}); await oReload('jobs'); render(); return; }
    if (el.matches('[data-o-custpick]')) { const c = (st.crmAll || []).find(x => x.id === Number(el.value)), f = el.closest('form'); if (c) { f.elements.toName.value = c.name; f.elements.toEmail.value = c.email; } }
  } catch (err) { toast(err.message); }
});
