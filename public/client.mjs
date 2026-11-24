// Business workspace: owner, sellers (and later employees) of an affiliated company. No municipal links or source names, ever.
const $ = q => document.querySelector(q), e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = v => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(v || 0), num = v => Number(v || 0).toLocaleString('en-US');
const day = v => v ? new Date(v + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'}) : '—';
const when = v => { try { return new Date(v).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}); } catch { return ''; } };
const dueLabel = v => { const [d, t] = String(v).split('T'), h = Number(t.slice(0, 2)); return day(d) + ' · ' + ((h % 12) || 12) + ':' + t.slice(3, 5) + ' ' + (h < 12 ? 'AM' : 'PM'); };
const ICO = {radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.800-7 11-7 11z"/><circle cx="12" cy="10" r="2.500"/>', bld: '<path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20"/>', cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>', users: '<circle cx="9" cy="8" r="3.500"/><path d="M2 20c0-3.500 3-6 7-6s7 2.500 7 6M17 5a3 3 0 0 1 0 6M22 20c0-2.500-1.500-4.500-4-5.300"/>', note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM9 13h6M9 17h6"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12l5 5 9-10"/>', send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>'};
const icon = k => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + (ICO[k] || '') + '</svg>';
const st = {tab: 'radar', radarTab: 'all', modal: null, drawer: null, data: null, lists: null, listId: 'fav', listData: null, followups: null, fuTab: 'today', estimates: null, estSel: null, team: null, visits: null, me: null, error: '', f: {city: [], state: '', trade: '', q: '', from: '', to: '', page: 1}};

async function api(path, body) {
  const r = await fetch(path, {method: body ? 'POST' : 'GET', headers: body ? {'Content-Type': 'application/json'} : {}, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j.error || 'Something went wrong.'); err.status = r.status; throw err; }
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 4000); }
const query = (extra = {}) => { const f = {...st.f, ...extra}, p = new URLSearchParams(); if (f.city.length) p.set('city', f.city.join(',')); for (const k of ['state', 'trade', 'q', 'from', 'to']) if (f[k]) p.set(k, f[k]); if (st.radarTab === 'fav' && st.tab === 'radar') p.set('fav', '1'); p.set('page', f.page); if (extra.export) p.set('export', '1'); return p.toString(); };
const owner = () => st.me.role === 'owner';
const STATUS = {draft: ['Draft', 'st-muted'], with_owner: ['With Owner', 'st-purple'], changes_requested: ['Changes requested', 'st-warn'], review_requested: ['Review requested', 'st-purple'], approved: ['Approved', 'st-ok'], sent: ['Sent to customer', 'st-ok']};
const pill = s => '<span class="pill ' + (STATUS[s]?.[1] || '') + '">' + e(STATUS[s]?.[0] || s) + '</span>';

const brand = '<a class="brand" href="/client"><img src="/logo-mark.png" alt="" class="brand-img"><span class="brand-text"><b>MORIAH</b><small>SYSTEM</small></span></a>';
function loginView() {
  return '<main class="login"><section class="lcard"><div class="lbrand"><img src="/logo-mark.png" alt=""><b>MORIAH</b><small>SYSTEM</small></div><h1>Sign in</h1><form data-form="login"><label>Email or username<input name="email" type="text" required autocomplete="username" autocapitalize="none" spellcheck="false"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label>' + (st.error ? '<p class="form-error" role="alert"><span>' + e(st.error) + '</span></p>' : '') + '<button class="primary">Sign in</button></form></section></main>';
}
const NAV = () => owner()
  ? [['radar', 'Permit Radar', 'radar'], ['lists', 'My Lists', 'list'], ['estimates', 'Estimates', 'calc'], ['followups', 'Follow-ups', 'cal'], ['visits', 'Site visits', 'cam'], ['team', 'Team', 'users']]
  : [['radar', 'Permit Radar', 'radar'], ['lists', 'My Lists', 'list'], ['estimates', 'Estimate Requests', 'calc'], ['followups', 'Follow-ups', 'cal'], ['visits', 'My visits', 'cam']];
function shell(inner) {
  const nav = st.me.role === 'employee' ? '' : NAV().map(([id, l, ic]) => '<button type="button" data-action="tab" data-id="' + id + '" class="' + (st.tab === id ? 'active' : '') + '">' + icon(ic) + '<span>' + l + '</span></button>').join('');
  const name = st.me.name || String(st.me.email).split('@')[0];
  return '<div class="shell">' + '<aside class="side">' + brand + '<nav>' + nav + '</nav><div class="usercard"><span class="avatar">' + e(name.slice(0, 2).toUpperCase()) + '</span><span class="who"><b>' + e(name) + '</b><small>' + ({owner: 'Owner', seller: 'Sales Workspace', employee: 'Employee'}[st.me.role]) + '</small></span><button type="button" data-action="logout">Sign out</button></div></aside>'
    + '<div class="main-col"><main class="workspace"><div class="cl-co">' + icon('bld') + '<b>' + e(st.me.company) + '</b></div>' + inner + '</main></div>' + (st.drawer ? drawerView() : '') + (st.modal ? modalView() : '') + '</div>';
}
const title = (h, p) => '<section class="title"><div><h1>' + h + '</h1><p>' + p + '</p></div></section>';

// ---------- Permit Radar ----------
function meter(l) {
  const pct = Math.min(100, Math.round(l.used / Math.max(1, l.monthlyLimit) * 100));
  return '<div class="cl-meter"><div><b>' + num(l.used) + '</b> of ' + num(l.monthlyLimit) + ' permits opened this month<small>Resets every month · ' + l.cities + ' of ' + l.maxCities + ' cities in your plan</small></div><div class="cl-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i data-w="' + pct + '"></i></div></div>';
}
function permitRows(d, withActions = true) {
  return d.permits.map(p => '<tr class="clickrow" data-action="open" data-id="' + p.key + '"><td class="starcell"><button type="button" class="star' + (p.fav ? ' on' : '') + '" data-action="fav" data-id="' + p.key + '" aria-label="Favorite">' + icon('star') + '</button></td><td><b>' + e(p.address || '—') + '</b><small>' + (p.number ? '#' + e(p.number) : '') + '</small></td><td>' + e(p.city) + ', ' + e(p.state) + '</td><td><span class="pill st-purple">' + e(p.type || 'Permit') + '</span></td><td>' + day(p.issued) + (p.dateApprox ? '<small>approx.</small>' : '') + '</td><td class="cl-act"><button type="button" data-action="open" data-id="' + p.key + '">View</button></td></tr>').join('');
}
function permitTable(d) {
  return '<section class="panel flush"><div class="cl-count"><span><b>' + num(d.total) + '</b> permits</span><span class="cl-tools">' + (st.tab === 'radar' && st.radarTab === 'fav' ? '<button type="button" data-action="route">Open route in Maps</button>' : '') + '<button type="button" data-action="export">Export CSV</button></span></div><div class="table-scroll"><table class="cl-table"><thead><tr><th></th><th>Address</th><th>City</th><th>Type</th><th>Issued</th><th></th></tr></thead><tbody>' + permitRows(d) + '</tbody></table></div>' + (d.permits.length ? '' : '<p class="empty">No permits to show here yet.</p>')
    + '<div class="cl-pager"><button type="button" data-action="prev" ' + (d.page <= 1 ? 'disabled' : '') + '>Previous</button><span>Page ' + d.page + ' of ' + d.pages + '</span><button type="button" data-action="next" ' + (d.page >= d.pages ? 'disabled' : '') + '>Next</button></div></section>';
}
function radarView() {
  const d = st.data; if (!d) return '<p class="muted">Loading permits…</p>';
  const f = st.f, cityBox = d.cities.map(c => '<label class="cl-opt"><input type="checkbox" data-city="' + e(c.key) + '" ' + (f.city.includes(c.key) ? 'checked' : '') + '>' + e(c.city) + ', ' + e(c.state) + '</label>').join('');
  return title('Permit Radar', 'Browse issued building permits in your assigned cities' + (d.trades.length ? ' for ' + e(d.trades.join(', ')) : '') + '.') + meter(d.limits)
    + (d.limits.capped ? '<p class="warning cl-warn">Your monthly limit is reached, so some permits are hidden. They unlock next month, or ask your account manager for a higher limit.</p>' : '')
    + '<form class="cl-filters" data-form="filters"><label class="searchbox">' + icon('search') + '<input type="search" name="q" value="' + e(f.q) + '" placeholder="Address or permit number"></label>'
    + '<details class="cl-pop"><summary>' + icon('pin') + (f.city.length ? f.city.length + ' selected' : 'Assigned cities (' + d.cities.length + ')') + '</summary><div class="cl-popbox"><b>Assigned cities</b>' + (cityBox || '<small class="muted">No cities assigned yet.</small>') + '</div></details>'
    + '<select name="state"><option value="">All states</option>' + ['MA', 'CT', 'RI'].map(x => '<option ' + (f.state === x ? 'selected' : '') + '>' + x + '</option>').join('') + '</select>'
    + (d.trades.length > 1 ? '<select name="trade"><option value="">All my trades</option>' + d.trades.map(t => '<option ' + (f.trade === t ? 'selected' : '') + '>' + e(t) + '</option>').join('') + '</select>' : '')
    + '<input type="month" name="from" value="' + e(f.from) + '" aria-label="From"><input type="month" name="to" value="' + e(f.to) + '" aria-label="To"><button class="primary" type="submit">Search</button></form>'
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
function teamView() {
  const t = st.team; if (!t) return '<p class="muted">Loading…</p>';
  const rows = t.members.map(m => '<tr><td><b>' + e(m.name || m.email) + '</b><small>' + e(m.email) + '</small></td><td>' + (m.role === 'seller' ? 'Seller' : 'Employee') + '</td><td>' + (m.role === 'seller' ? e(m.cities.map(k => t.cities.find(x => x.key === k)?.city).filter(Boolean).join(', ') || '—') : '—') + '</td><td>' + (m.active ? 'Active' : 'Inactive') + '</td><td class="cl-act"><button type="button" data-action="setActive" data-id="' + m.id + '" data-on="' + (m.active ? 0 : 1) + '">' + (m.active ? 'Deactivate' : 'Activate') + '</button><button type="button" data-action="pw" data-id="' + m.id + '">New password</button></td></tr>').join('');
  const cityOpts = t.cities.map(c => '<label class="cl-chip"><input type="checkbox" name="city" value="' + e(c.key) + '"><span>' + e(c.city) + ', ' + e(c.state) + '</span></label>').join('');
  return title('Team', 'Create sellers (permits in the cities you choose) and employees (time clock, ' + t.spots.employees + ' of ' + t.spots.max + ' spots used).')
    + '<form class="panel settings-panel" data-form="team"><h2>Add team member</h2><div class="form-grid"><label>Name<input name="name" required maxlength="120"></label><label>E-mail<input name="email" type="email" required></label><label>Role<select name="role"><option value="seller">Seller</option><option value="employee">Employee</option></select></label><label>Initial password<input name="password" type="password" required minlength="16" autocomplete="new-password"></label></div><small class="muted">At least 16 characters. Share it with the person; they sign in at this same page.</small><fieldset><legend>Cities (sellers only)</legend><div class="cl-chips">' + (cityOpts || '<span class="muted">No cities on your plan yet.</span>') + '</div></fieldset><button class="primary" type="submit">Add member</button></form>'
    + '<section class="panel flush"><div class="table-scroll"><table class="cl-table"><thead><tr><th>Member</th><th>Role</th><th>Cities</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (t.members.length ? '' : '<p class="empty">No team members yet.</p>') + '</section>';
}
const employeeView = () => '<section class="title"><div><h1>Welcome.</h1><p>Clock in, clock out and photos for the office are coming next. Your account is ready.</p></div></section>';

// ---------- Drawer & modals ----------
function drawerView() {
  const dr = st.drawer, p = dr.permit; if (!p) return '';
  const lists = (st.lists || []).filter(x => !x.builtin);
  return '<div class="overlay right"><div class="modal side-drawer cl-drawer"><header><div><h2>' + e(p.address || 'Permit') + '</h2><p class="muted">' + e(p.city) + ', ' + e(p.state) + ' <span class="pill st-purple">' + e(p.type || 'Permit') + '</span></p></div><button type="button" data-action="close" aria-label="Close">×</button></header>'
    + '<div class="cl-dtools"><button type="button" class="cl-favbtn' + (p.fav ? ' on' : '') + '" data-action="dfav">' + icon('star') + (p.fav ? 'Favorite' : 'Add favorite') + '</button>' + (lists.length ? '<select data-addlist><option value="">Add to list…</option>' + lists.map(l => '<option value="' + l.id + '" ' + (dr.lists.includes(l.id) ? 'disabled' : '') + '>' + e(l.name) + (dr.lists.includes(l.id) ? ' ✓' : '') + '</option>').join('') + '</select>' : '') + '</div>'
    + '<div class="cl-card"><span>Issued<b>' + day(p.issued) + '</b></span><span>Permit<b>' + e(p.number || '—') + '</b></span>' + (p.value ? '<span>Value<b>' + money(p.value) + '</b></span>' : '') + '</div>'
    + (p.description ? '<div class="cl-card col"><h3>Scope of work</h3><p>' + e(p.description) + '</p></div>' : '') + ((p.contractor || p.owner) ? '<div class="cl-card col"><h3>Contacts on the permit</h3><p>' + (p.contractor ? 'Contractor: ' + e(p.contractor) : '') + (p.owner ? '<br>Owner: ' + e(p.owner) : '') + '</p></div>' : '')
    + (dr.nextFollowup ? '<div class="cl-card"><span>Next follow-up<b>' + dueLabel(dr.nextFollowup) + '</b></span></div>' : '')
    + '<div class="cl-card col"><h3>Note</h3><textarea data-note rows="3" placeholder="Private note about this opportunity…">' + e(dr.note) + '</textarea></div>'
    + '<div class="cl-card col"><h3>Site visits & photos</h3><div class="cl-photos">' + dr.visits.flatMap(v => v.photos).map(id => '<a href="/api/client/photo?id=' + id + '" target="_blank" rel="noopener"><img src="/api/client/photo?id=' + id + '" alt="Site photo"></a>').join('') + '</div><button type="button" data-action="visit">' + icon('cam') + 'Add site visit</button></div>'
    + '<footer class="drawer-foot"><button type="button" data-action="fuforpermit">' + icon('cal') + 'Add follow-up</button><button class="primary" type="button" data-action="reqest">' + icon('send') + 'Request an estimate</button></footer></div></div>';
}
function modalView() {
  const m = st.modal, p = st.drawer?.permit;
  const wrap = (h, body, foot) => '<div class="overlay"><form class="modal compact" data-form="' + m.kind + '"><header><h2>' + h + '</h2><button type="button" data-action="mclose" aria-label="Close">×</button></header>' + body + '<footer class="drawer-foot"><button type="button" data-action="mclose">Cancel</button>' + foot + '</footer></form></div>';
  if (m.kind === 'sendest') { const x = st.estimates.find(q => q.id === m.id); return '<div class="overlay"><div class="modal compact"><header><h2>Final review &amp; send</h2><button type="button" data-action="mclose" aria-label="Close">×</button></header><div class="cl-card col"><span>Customer<b>' + e(x.prospectName) + '</b><small>' + e(x.prospectEmail) + '</small></span><span>Job<b>' + e(x.address) + '</b></span><span>Estimate total<b class="big">' + usd(x.total) + '</b></span><span>Attachment<b>Estimate-' + x.id + '.pdf</b></span></div><p class="muted">The customer and the salesperson both receive the estimate by e-mail. Internal cost and margin are never included.</p><footer class="drawer-foot"><button type="button" data-action="mclose">Back to estimate</button><button class="primary" type="button" data-action="sendnow">' + icon('send') + 'Send to customer</button></footer></div></div>'; }
  if (m.kind === 'pw') return wrap('New password', '<input type="hidden" name="id" value="' + m.id + '"><label>Password<input name="password" type="password" required minlength="16" autocomplete="new-password"></label><small class="muted">At least 16 characters. The member is signed out.</small>', '<button class="primary" type="submit">Save</button>');
  if (m.kind === 'visit') return wrap(e(p.address || 'Site visit'), '<label>Measurements<textarea name="measurements" rows="4" placeholder="Rooms, linear ft, sq ft, panel size…"></textarea></label><label>Notes for the office<textarea name="notes" rows="3" placeholder="Access, owner remarks, materials…"></textarea></label><label>Photos (up to 6)<input type="file" name="photos" accept="image/*" multiple data-photos></label><div class="cl-photos" id="vthumbs"></div>', '<button class="primary" type="submit">Send visit</button>');
  if (m.kind === 'estreq') { const x = m.edit || {}; return wrap('Request an estimate', '<p class="muted">' + e(p?.address || x.address || '') + ', ' + e(p?.city || x.city || '') + '</p><div class="cl-callout"><b>The Owner creates and sends estimates.</b><small>Submit the job information; the customer receives the estimate by e-mail from the Owner.</small></div><input type="hidden" name="id" value="' + (x.id || '') + '"><div class="form-grid"><label>Customer name<input name="prospectName" value="' + e(x.prospectName) + '" maxlength="120"></label><label>Customer e-mail<input name="prospectEmail" type="email" value="' + e(x.prospectEmail) + '"></label></div><label>Scope notes<textarea name="scope" rows="3" placeholder="What work does the customer need?">' + e(x.scope) + '</textarea></label><label>Job measurements<input name="measurements" value="' + e(x.measurements) + '" maxlength="2000" placeholder="Approx. 1,200 sq ft"></label>', '<button type="submit" name="act" value="draft">Save draft</button><button class="primary" type="submit" name="act" value="submit">Submit to Owner</button>'); }
  if (m.kind === 'fu') { const x = m.edit || {}, due = x.dueAt || (new Date().toLocaleDateString('en-CA') + 'T10:00'); return wrap(x.id ? 'Edit follow-up' : 'New follow-up', '<input type="hidden" name="id" value="' + (x.id || '') + '"><label>Task<input name="task" value="' + e(x.task) + '" required maxlength="160" placeholder="Call the customer"></label><div class="form-grid"><label>Date<input type="date" name="date" value="' + e(due.slice(0, 10)) + '" required></label><label>Time<input type="time" name="time" value="' + e(due.slice(11, 16)) + '" required></label><label>Type<select name="kind">' + ['call', 'email', 'meeting', 'task'].map(k => '<option value="' + k + '" ' + (x.kind === k ? 'selected' : '') + '>' + k[0].toUpperCase() + k.slice(1) + '</option>').join('') + '</select></label></div><label>Notes<textarea name="notes" rows="3">' + e(x.notes) + '</textarea></label>', '<button class="primary" type="submit">Save follow-up</button>'); }
  return '';
}

function render() {
  const r = !st.me ? loginView() : st.me.role === 'employee' ? shell(employeeView()) : shell(({radar: radarView, lists: listsView, estimates: estimatesView, followups: followupsView, visits: visitsView, team: teamView})[st.tab]());
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
  if (tab === 'team') { st.team = await api('/api/client/team'); return render(); }
}
async function openList(id) { st.listId = id; st.listData = null; render(); st.listData = await api('/api/client/list-permits?listId=' + id + '&page=' + st.f.page); render(); }
async function openPermit(key) {
  const d = await api('/api/client/permit?key=' + key), v = await api('/api/client/visits?permitKey=' + key);
  if (!st.lists) st.lists = (await api('/api/client/lists')).lists;
  st.drawer = {...d, visits: v.visits}; render();
}
async function start() { try { st.me = (await api('/api/client/me')).client; if (st.me.role !== 'employee') await enter('radar'); else render(); } catch { st.me = null; render(); } }
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
    if (a === 'rtab') { st.radarTab = id; st.f.page = 1; return load(); }
    if (a === 'list') { st.f.page = 1; return openList(id); }
    if (a === 'dellist') { await api('/api/client/lists', {op: 'delete', id: Number(id)}); st.lists = (await api('/api/client/lists')).lists; st.listId = 'fav'; return openList('fav'); }
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
    if (a === 'pw') { st.modal = {kind: 'pw', id}; return render(); }
    if (a === 'setActive') { await api('/api/client/team', {op: 'setActive', id: Number(id), active: t.dataset.on === '1'}); st.team = await api('/api/client/team'); return render(); }
  } catch (err) { toast(err.message); }
});
document.addEventListener('input', ev => { if (ev.target.closest('[data-estform]')) recalc(); });
document.addEventListener('change', async ev => {
  const el = ev.target;
  try {
    if (el.matches('[data-photos]')) { st.modal.photos = []; for (const f of [...el.files].slice(0, 6)) st.modal.photos.push(await shrink(f)); $('#vthumbs').innerHTML = st.modal.photos.map(u => '<img src="' + u + '" alt="">').join(''); return; }
    if (el.matches('[data-city]')) { st.f.city = [...document.querySelectorAll('[data-city]')].filter(x => x.checked).map(x => x.dataset.city); return; }
    if (el.matches('[data-addlist]') && el.value) { await api('/api/client/lists', {op: 'item', id: Number(el.value), permitKey: st.drawer.permit.key, on: true}); st.drawer.lists.push(Number(el.value)); st.lists = (await api('/api/client/lists')).lists; return render(); }
    if (el.matches('[data-note]')) { await api('/api/client/note', {permitKey: st.drawer.permit.key, note: el.value}); st.drawer.note = el.value; toast('Note saved.'); }
  } catch (err) { toast(err.message); }
});
document.addEventListener('submit', async ev => {
  ev.preventDefault(); const form = ev.target, v = Object.fromEntries(new FormData(form)), act = ev.submitter?.value, kind = form.dataset.form;
  try {
    if (kind === 'login') { await api('/api/client/login', {email: v.email, password: v.password}); st.error = ''; st.me = (await api('/api/client/me')).client; if (st.me.role !== 'employee') await enter('radar'); else render(); return; }
    if (kind === 'filters') { Object.assign(st.f, {from: v.from || '', to: v.to || '', state: v.state || '', trade: v.trade || '', q: v.q || '', page: 1}); return load(); }
    if (kind === 'newlist') { const r = await api('/api/client/lists', {op: 'create', name: v.name}); st.lists = (await api('/api/client/lists')).lists; return openList(r.id); }
    if (kind === 'visit') { await api('/api/client/visits', {permitKey: st.drawer.permit.key, measurements: v.measurements, notes: v.notes, photos: st.modal.photos}); st.modal = null; st.drawer.visits = (await api('/api/client/visits?permitKey=' + st.drawer.permit.key)).visits; render(); return toast('Visit sent to the office.'); }
    if (kind === 'estreq') { const p = st.drawer?.permit; await api('/api/client/estimates', {op: 'save', id: Number(v.id) || undefined, permitKey: p?.key, prospectName: v.prospectName, prospectEmail: v.prospectEmail, scope: v.scope, measurements: v.measurements, submit: act === 'submit'}); st.modal = null; st.estimates = (await api('/api/client/estimates')).estimates; render(); return toast(act === 'submit' ? 'Sent to the Owner.' : 'Draft saved.'); }
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
    if (kind === 'pw') { await api('/api/client/team', {op: 'setPassword', id: Number(v.id), password: v.password}); st.modal = null; render(); return toast('Password updated.'); }
  } catch (err) { if (kind === 'login') { st.error = err.message; render(); } else toast(err.message); }
});
start();
