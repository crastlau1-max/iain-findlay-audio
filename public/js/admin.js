// Seller side dashboard: overview, clients, sessions, rate locks, bookings, settings.
import { $, $$, el, api, money } from './lib.js';

const view = $('#view');
let settingsCache = null;

const toastEl = $('#toast');
let tt;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 2600); }
const fmtDate = d => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const today = () => new Date().toISOString().slice(0, 10);
const enc = s => encodeURIComponent(s);
const dollars = c => (Number.isInteger(c) ? money(c) : '');
const SRC = { direct: 'Direct', soundbetter: 'SoundBetter', manual: 'Manual' };

async function call(path, opts) {
  try { return await api(`/api/admin${path}`, opts); }
  catch (e) {
    if (e.status === 401) { showLogin(); throw e; }
    toast(e.message); throw e;
  }
}

// Two step confirm for destructive buttons, no browser dialogs.
function armed(btn, label, fn) {
  btn.addEventListener('click', async () => {
    if (!btn.classList.contains('arming')) {
      btn.classList.add('arming'); const orig = btn.textContent; btn.textContent = label;
      setTimeout(() => { btn.classList.remove('arming'); btn.textContent = orig; }, 3000);
      return;
    }
    await fn();
  });
}

function dots(n, total) {
  return el('span', { class: 'dots', title: `${n} of ${total}` }, Array.from({ length: total }, (_, i) => el('i', { class: i < n ? 'on' : '' })));
}
function lockPill(l) {
  if (!l) return el('span', { class: 'pill dim' }, 'None');
  return el('span', { class: 'pill gold' }, `${l.discountPercent}% off, ${l.remaining} left, until ${fmtDate(l.expiresAt)}`);
}
const statusPill = s => el('span', { class: `pill ${s === 'paid' ? 'green' : s === 'deposit_paid' ? 'gold' : s === 'cancelled' ? 'red' : 'dim'}` },
  { paid: 'Paid', deposit_paid: 'Deposit paid', pending: 'Awaiting payment', cancelled: 'Cancelled', demo: 'Preview mode' }[s] || s);

// ---------- auth ----------
function showLogin(hint) {
  $('#login').hidden = false;
  view.replaceChildren();
  $$('.admin-tabs, .admin-tabs-mobile').forEach(n => n.hidden = true);
  $('#logout').hidden = true;
  if (hint) $('#login-hint').textContent = hint;
  $('#pw').focus();
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('#pw').value } });
    $('#pw').value = '';
    start();
  } catch (err) { $('#login-error').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); showLogin(); });

// ---------- router ----------
function route() {
  const h = location.hash.slice(1) || 'overview';
  const [name, arg] = h.split('=');
  $$('[data-view]').forEach(a => a.classList.toggle('on', a.dataset.view === (name === 'client' ? 'clients' : name === 'project' ? 'projects' : name)));
  window.scrollTo(0, 0);
  if (name === 'clients') return renderClients();
  if (name === 'client') return renderClient(decodeURIComponent(arg || ''));
  if (name === 'bookings') return renderBookings();
  if (name === 'projects') return renderProjects();
  if (name === 'project') return renderProject(decodeURIComponent(arg || ''));
  if (name === 'settings') return renderSettings();
  return renderOverview();
}
window.addEventListener('hashchange', route);

// ---------- overview ----------
async function renderOverview() {
  refreshUnread();
  const [s, cl, bk] = await Promise.all([call('/summary'), call('/clients'), call('/bookings')]);
  const close = cl.clients.filter(c => !c.activeLock && c.punches >= c.bookingsRequired - 2 && c.countedSessions > 0).slice(0, 8);
  const locks = cl.clients.filter(c => c.activeLock).slice(0, 8);
  const owing = bk.bookings.filter(b => b.status === 'deposit_paid');
  view.replaceChildren(
    el('div', { class: 'a-head' }, el('div', {}, el('h1', {}, 'Overview'), el('div', { class: 'sub' }, s.stripe ? 'Stripe is connected.' : 'Stripe is not connected yet, so checkout runs in preview mode.'))),
    el('div', { class: 'tiles' },
      tile(s.projects.newRequests, 'New requests'), tile(s.projects.unread, 'Unread messages'), tile(s.projects.active, 'Active projects'),
      tile(s.projects.balanceDue, 'Awaiting final balance'), tile(money(s.projects.paidThisMonthCents) || '$0', 'Received this month')),
    el('div', { class: 'two' },
      panel('Close to a reward', close.length ? table(['Client', 'Progress', ''], close.map(c => [clientCell(c), dots(c.punches, c.bookingsRequired), `${c.bookingsRequired - c.punches} to go`]), close.map(c => `#client=${enc(c.email)}`)) : empty('Nobody is one or two sessions away yet.')),
      panel('Rate locks running', locks.length ? table(['Client', 'Rate lock'], locks.map(c => [clientCell(c), lockPill(c.activeLock)]), locks.map(c => `#client=${enc(c.email)}`)) : empty('No open rate lock windows.'))),
    await projectsPanel('Needs your attention', { status: 'open' }, true)
  );
}
const tile = (v, k) => el('div', { class: 'tile' }, el('div', { class: 'v' }, String(v)), el('div', { class: 'k' }, k));
const empty = msg => el('div', { class: 'empty' }, msg);
function panel(title, body, actions) {
  return el('section', { class: 'panel' }, el('div', { class: 'panel-h' }, el('h2', {}, title), actions || ''), body);
}
function clientCell(c) {
  return el('div', {}, el('div', { class: 'strong' }, c.name || c.email), c.name ? el('div', { class: 'muted', style: 'font-size:13px' }, c.email) : '');
}
function table(head, rows, links) {
  const t = el('table', { class: 't' }, el('thead', {}, el('tr', {}, head.map(h => el('th', {}, h)))),
    el('tbody', {}, rows.map((r, i) => {
      const tr = el('tr', { class: links ? 'click' : '' }, r.map(c => el('td', {}, c)));
      if (links) tr.addEventListener('click', e => { if (!e.target.closest('button, a, input, select')) location.hash = links[i]; });
      return tr;
    })));
  return el('div', { class: 't-wrap' }, t);
}

// ---------- clients ----------
async function renderClients(q = '') {
  const data = await call(`/clients?q=${enc(q)}`);
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search name or email', value: q, style: 'width:260px' });
  let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(async () => { await renderClients(search.value); const s = $('input[type=search]', view); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 200); });

  const add = el('form', { class: 'form-row', style: 'grid-template-columns: minmax(0,1fr) minmax(0,1fr) auto' },
    field('Email', el('input', { class: 'input', name: 'email', type: 'email', required: true, placeholder: 'client@email.com' })),
    field('Name', el('input', { class: 'input', name: 'name', placeholder: 'Artist or contact name' })),
    el('button', { class: 'btn btn-gold btn-sm', type: 'submit' }, 'Add client'));
  add.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(add);
    const c = await call('/clients', { method: 'POST', body: { email: fd.get('email'), name: fd.get('name') } });
    toast('Client added'); location.hash = `client=${enc(c.email)}`;
  });

  const rows = data.clients.map(c => [
    clientCell(c), dots(c.punches, c.bookingsRequired), String(c.countedSessions), lockPill(c.activeLock),
    fmtDate(c.lastSession), el('span', { class: 'num' }, dollars(c.totalSpentCents))
  ]);
  view.replaceChildren(
    el('div', { class: 'a-head' }, el('div', {}, el('h1', {}, 'Clients'), el('div', { class: 'sub' }, `${data.clients.length} client${data.clients.length === 1 ? '' : 's'}. Direct bookings appear here automatically once paid.`)), search),
    panel('Add a client', el('div', { class: 'panel-b' }, add)),
    panel('All clients', rows.length ? table(['Client', 'Card', 'Counted', 'Rate lock', 'Last session', 'Spent'], rows, data.clients.map(c => `#client=${enc(c.email)}`)) : empty(q ? 'No matches.' : 'No clients yet. Add one above, or they appear after their first paid booking.'))
  );
}
function field(label, input, cls = 'field-sm') { return el('div', { class: cls }, el('label', {}, label), input); }

// ---------- client detail ----------
async function renderClient(email) {
  let c;
  try { c = await call(`/clients/${enc(email)}`); } catch { location.hash = 'clients'; return; }
  const cardUrl = `${location.origin}/card/${c.cardToken}`;

  // card summary
  const punches = el('div', { class: 'punches', style: `grid-template-columns: repeat(${Math.min(5, c.bookingsRequired)}, 1fr)` },
    Array.from({ length: c.bookingsRequired }, (_, i) => el('span', { class: `punch${i < c.punches ? ' on' : ''}${i === c.bookingsRequired - 1 ? ' reward' : ''}` }, i === c.bookingsRequired - 1 ? '★' : String(i + 1))));
  const linkInput = el('input', { class: 'input', readonly: true, value: cardUrl });
  const copy = el('button', { class: 'mini-btn gold', type: 'button' }, 'Copy');
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(cardUrl); toast('Card link copied'); } catch { linkInput.select(); } });
  const regen = el('button', { class: 'mini-btn', type: 'button' }, 'New link');
  armed(regen, 'Old link stops working', async () => { await call(`/clients/${enc(c.email)}/card`, { method: 'POST' }); toast('New card link made'); renderClient(c.email); });

  const summary = el('div', { class: 'card-mini' },
    el('div', { class: 'label' }, 'Punch card'),
    el('div', { class: 'big' }, `${c.punches} / ${c.bookingsRequired}`),
    punches,
    el('dl', { class: 'kv' },
      el('dt', {}, 'Counted sessions'), el('dd', {}, String(c.countedSessions)),
      el('dt', {}, 'All sessions'), el('dd', {}, String(c.totalSessions)),
      el('dt', {}, 'Windows earned'), el('dd', {}, String(c.windowsEarned)),
      el('dt', {}, 'Total spent'), el('dd', {}, dollars(c.totalSpentCents) || '$0'),
      el('dt', {}, 'Rate lock'), el('dd', {}, lockPill(c.activeLock))),
    el('div', { class: 'label', style: 'margin-top:16px' }, 'Private card link for this client'),
    el('div', { class: 'link-box' }, linkInput, copy, regen));

  // profile
  const prof = el('form', { class: 'panel-b', style: 'display:grid;gap:12px' },
    field('Name', el('input', { class: 'input', name: 'name', value: c.name || '' })),
    field('Billing email', el('input', { class: 'input', name: 'email', type: 'email', value: c.email })),
    field('Private notes', el('textarea', { class: 'input', name: 'notes', style: 'height:90px;padding:8px 10px' }, c.notes || '')),
    el('div', { class: 'a-actions' }, el('button', { class: 'btn btn-sm', type: 'submit' }, 'Save details')));
  prof.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(prof);
    const r = await call(`/clients/${enc(c.email)}`, { method: 'PATCH', body: { name: fd.get('name'), email: fd.get('email'), notes: fd.get('notes') } });
    toast('Saved'); if (r.email !== c.email) location.hash = `client=${enc(r.email)}`; else renderClient(r.email);
  });
  const del = el('button', { class: 'mini-btn danger', type: 'button' }, 'Delete client');
  armed(del, 'Click again to delete everything', async () => { await call(`/clients/${enc(c.email)}`, { method: 'DELETE' }); toast('Client deleted'); location.hash = 'clients'; });

  // add session
  const addForm = el('form', { class: 'form-row' },
    field('Date', el('input', { class: 'input', type: 'date', name: 'date', value: today() })),
    field('Project or song', el('input', { class: 'input', name: 'title', placeholder: 'Song title' })),
    field('Source', el('select', { class: 'select', name: 'source' }, Object.entries(SRC).map(([k, v]) => el('option', { value: k, selected: k === 'soundbetter' }, v)))),
    field('Amount', el('div', { class: 'money' }, el('span', {}, '$'), el('input', { class: 'input', name: 'amount', inputmode: 'decimal', placeholder: '0' }))),
    el('label', { class: 'inline-check' }, el('input', { type: 'checkbox', name: 'counts', checked: true }), 'Counts toward card'),
    el('button', { class: 'btn btn-gold btn-sm', type: 'submit' }, 'Add session'));
  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(addForm);
    const before = c.activeLock;
    const r = await call(`/clients/${enc(c.email)}/sessions`, { method: 'POST', body: { date: fd.get('date'), title: fd.get('title'), source: fd.get('source'), amount: fd.get('amount'), counts: fd.get('counts') === 'on' } });
    toast(!before && r.activeLock ? 'Session added. That completed the card and opened a rate lock.' : 'Session added');
    renderClient(c.email);
  });

  // sessions table
  const sessRows = c.sessions.map(s => {
    const counts = el('input', { type: 'checkbox', checked: s.counts, title: 'Counts toward the card' });
    counts.addEventListener('change', async () => { await call(`/clients/${enc(c.email)}/sessions/${s.id}`, { method: 'PATCH', body: { counts: counts.checked } }); renderClient(c.email); });
    const rm = el('button', { class: 'mini-btn danger', type: 'button' }, 'Remove');
    armed(rm, 'Confirm', async () => { await call(`/clients/${enc(c.email)}/sessions/${s.id}`, { method: 'DELETE' }); toast('Session removed'); renderClient(c.email); });
    return [fmtDate(s.date), el('div', {}, s.title, s.usedLockId ? el('span', { class: 'pill gold', style: 'margin-left:8px' }, 'Used rate lock') : ''), el('span', { class: `src-${s.source}` }, SRC[s.source] || s.source), el('span', { class: 'num' }, dollars(s.amountCents)), el('label', { class: 'inline-check', style: 'height:auto' }, counts), rm];
  });

  // rate locks
  const lockRows = c.rateLocks.slice().reverse().map(l => {
    const exp = el('input', { class: 'mini-input date', type: 'date', value: l.expiresAt.slice(0, 10) });
    const used = el('input', { class: 'mini-input', type: 'number', min: 0, value: l.used });
    const total = el('input', { class: 'mini-input', type: 'number', min: 0, value: l.total });
    const pct = el('input', { class: 'mini-input', type: 'number', min: 1, max: 100, value: l.discountPercent });
    const save = el('button', { class: 'mini-btn', type: 'button' }, 'Save');
    save.addEventListener('click', async () => {
      await call(`/clients/${enc(c.email)}/locks/${l.id}`, { method: 'PATCH', body: { expiresAt: `${exp.value}T23:59:59`, used: +used.value, total: +total.value, discountPercent: +pct.value } });
      toast('Rate lock updated'); renderClient(c.email);
    });
    const toggle = el('button', { class: `mini-btn ${l.revokedAt ? '' : 'danger'}`, type: 'button' }, l.revokedAt ? 'Restore' : 'Revoke');
    toggle.addEventListener('click', async () => { await call(`/clients/${enc(c.email)}/locks/${l.id}`, { method: 'PATCH', body: { revoke: !l.revokedAt } }); renderClient(c.email); });
    const state = { active: el('span', { class: 'pill green' }, 'Active'), used: el('span', { class: 'pill dim' }, 'Used up'), expired: el('span', { class: 'pill dim' }, 'Expired'), revoked: el('span', { class: 'pill red' }, 'Revoked') }[l.state];
    return [state, l.manual ? 'Granted by hand' : `Earned, card ${l.milestone}`, el('div', {}, pct, ' %'), el('div', {}, used, ' of ', total), exp, el('div', { class: 'a-actions' }, save, toggle)];
  });
  const grant = el('form', { class: 'form-row', style: 'grid-template-columns: repeat(3, 120px) minmax(0,1fr) auto' },
    field('Days', el('input', { class: 'input', name: 'days', type: 'number', value: settingsCache?.loyalty?.windowDays || 30 })),
    field('Projects', el('input', { class: 'input', name: 'total', type: 'number', value: settingsCache?.loyalty?.projectLimit || 3 })),
    field('Discount %', el('input', { class: 'input', name: 'discountPercent', type: 'number', value: settingsCache?.loyalty?.discountPercent || 25 })),
    field('Reason', el('input', { class: 'input', name: 'note', placeholder: 'Optional' })),
    el('button', { class: 'btn btn-sm', type: 'submit' }, 'Grant rate lock'));
  grant.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(grant);
    await call(`/clients/${enc(c.email)}/locks`, { method: 'POST', body: Object.fromEntries(fd) });
    toast('Rate lock granted'); renderClient(c.email);
  });

  view.replaceChildren(
    el('a', { class: 'back', href: '#clients' }, '← All clients'),
    el('div', { class: 'a-head' }, el('div', {}, el('h1', {}, c.name || c.email), el('div', { class: 'sub' }, `${c.email} · client since ${fmtDate(c.createdAt)}`)), del),
    el('div', { class: 'client-grid' },
      el('div', {}, summary, el('div', { style: 'height:18px' }), panel('Details', prof)),
      el('div', {},
        panel('Add a session', el('div', { class: 'panel-b' }, addForm, el('p', { class: 'help' }, 'Use this for SoundBetter projects or anything paid outside the site. Direct bookings are added automatically when paid.'))),
        panel(`Sessions (${c.sessions.length})`, sessRows.length ? table(['Date', 'Project', 'Source', 'Amount', 'Counts', ''], sessRows) : empty('No sessions yet.')),
        panel('Rate locks', el('div', {}, lockRows.length ? table(['Status', 'Type', 'Discount', 'Projects used', 'Expires', ''], lockRows) : empty('No rate locks yet.'), el('div', { class: 'panel-b', style: 'border-top:1px solid var(--line)' }, grant))),
        c.bookings?.length ? panel('Direct bookings', bookingsTable(c.bookings)) : ''))
  );
}

// ---------- projects ----------
const SLABEL = { request: 'New request', proposal: 'Proposal sent', awaiting_payment: 'Awaiting payment', in_progress: 'In progress', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled' };
const sPill = s => el('span', { class: `pill ${s === 'request' ? 'gold' : s === 'completed' ? 'green' : s === 'cancelled' ? 'red' : s === 'delivered' ? 'gold' : 'dim'}` }, SLABEL[s] || s);
async function refreshUnread() {
  try { const { projects } = await call('/summary'); const b = $('#unread-badge'); if (b) { b.hidden = !projects.unread; b.textContent = projects.unread; } } catch {}
}
async function projectsPanel(title, query, compact) {
  const { projects } = await call(`/projects?${new URLSearchParams(query)}`);
  const rows = projects.map(p => [
    el('div', {}, el('div', { class: 'strong' }, p.title, p.unread ? el('span', { class: 'unread' }, String(p.unread)) : ''), el('div', { class: 'muted', style: 'font-size:13px' }, p.client.name || p.client.email)),
    sPill(p.status),
    el('div', { class: 'muted', style: 'font-size:13px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, p.lastMessage ? `${p.lastMessage.from === 'iain' ? 'You: ' : ''}${p.lastMessage.body}` : ''),
    el('span', { class: 'num' }, p.totalCents != null ? `${money(p.paidCents) || '$0'} of ${money(p.totalCents)}` : ''),
    fmtDate(p.updatedAt)]);
  return panel(title, rows.length ? table(['Project', 'Status', 'Latest', 'Paid', 'Updated'], rows, projects.map(p => `#project=${p.id}`)) : empty(compact ? 'Nothing waiting on you.' : 'No projects here yet. Requests from the site land here.'));
}
async function renderProjects(filter = 'open') {
  refreshUnread();
  const f = el('div', { class: 'filters tabs' }, [['open', 'Open'], ['request', 'New requests'], ['completed', 'Completed'], ['all', 'All']].map(([k, v]) =>
    el('button', { class: 'tab', type: 'button', 'aria-selected': String(k === filter), onclick: () => renderProjects(k) }, v)));
  view.replaceChildren(el('div', { class: 'a-head' }, el('div', {}, el('h1', {}, 'Projects'), el('div', { class: 'sub' }, 'Requests, conversations and proposals, like your SoundBetter inbox.')), f), await projectsPanel(filter === 'all' ? 'All projects' : 'Projects', { status: filter }));
}

const rich = text => { const f = document.createDocumentFragment(); String(text).split(/(https?:\/\/[^\s<]+)/g).forEach((p, i) => f.append(i % 2 ? el('a', { href: p, target: '_blank', rel: 'noopener' }, p) : p)); return f; };
const when = d => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function renderProject(id) {
  let p;
  try { p = await call(`/projects/${id}`); } catch { location.hash = 'projects'; return; }
  refreshUnread();
  const r = p.request;
  const svcName = { mixing: 'Mixing', mastering: 'Mastering', production: 'Production' };

  // thread
  const thread = el('div', { class: 'thread', id: 'thread' }, p.messages.map(m =>
    el('div', { class: `msg ${m.from === 'iain' ? 'me' : m.from === 'system' ? 'sys' : 'them'}` }, rich(m.body),
      m.from !== 'system' ? el('div', { class: 'meta' }, `${m.from === 'iain' ? 'You' : (p.client.name || 'Client')} · ${when(m.at)}`) : el('span', { class: 'meta' }, ` · ${when(m.at)}`))));
  const ta = el('textarea', { class: 'input', placeholder: 'Reply to the client. They get an email with a link back here.' });
  const send = el('button', { class: 'btn btn-gold', type: 'button' }, 'Send');
  send.addEventListener('click', async () => { if (!ta.value.trim()) return; send.disabled = true; await call(`/projects/${p.id}/messages`, { method: 'POST', body: { body: ta.value } }).finally(() => send.disabled = false); renderProject(p.id); });

  // proposal builder, prefilled from the request and your rates
  const rate = sid => (p.rates.services || []).find(x => x.id === sid)?.rateCents;
  const drumRate = (p.rates.addOns || []).find(x => x.id === 'live_drums')?.rateCents;
  const last = p.openProposal || [...p.proposals].reverse().find(x => x.status !== 'draft');
  const startLines = last ? last.lines.map(l => ({ label: l.label, qty: l.qty, price: l.unitCents / 100 }))
    : [...r.services.map(sid => ({ label: svcName[sid], qty: r.songs, price: rate(sid) != null ? rate(sid) / 100 : '' })), ...(r.liveDrums ? [{ label: 'Live drum recording', qty: 1, price: drumRate != null ? drumRate / 100 : '' }] : [])];
  const linesBox = el('div');
  const addLine = l => {
    const row = el('div', { class: 'pl' },
      field('Item', el('input', { class: 'input', 'data-k': 'label', value: l.label || '' })),
      field('Qty', el('input', { class: 'input', 'data-k': 'qty', type: 'number', min: 1, value: l.qty || 1 })),
      field('Price each', el('div', { class: 'money' }, el('span', {}, '$'), el('input', { class: 'input', 'data-k': 'price', inputmode: 'decimal', value: l.price ?? '' }))),
      el('button', { class: 'mini-btn danger', type: 'button', style: 'height:38px', title: 'Remove line', onclick: () => { row.remove(); preview(); } }, '×'));
    row.addEventListener('input', preview);
    linesBox.append(row);
  };
  startLines.forEach(addLine);
  const lock = p.loyalty?.activeLock;
  const dSource = el('select', { class: 'select', style: 'width:100%' },
    el('option', { value: 'none' }, 'No discount'), el('option', { value: 'custom' }, 'Custom discount'),
    lock ? el('option', { value: 'loyalty' }, `Rate lock: ${lock.discountPercent}% (${lock.remaining} left)`) : '');
  const dType = el('select', { class: 'select', style: 'width:100%' }, el('option', { value: 'percent' }, 'Percent off'), el('option', { value: 'amount' }, 'Dollars off'));
  const dValue = el('input', { class: 'input', inputmode: 'decimal', placeholder: '10' });
  const dNote = el('input', { class: 'input', placeholder: 'Shown to client, e.g. Returning client' });
  if (last?.discount?.source && last.discount.source !== 'none') { dSource.value = last.discount.source; dType.value = last.discount.type || 'percent'; dValue.value = last.discount.type === 'amount' ? last.discount.value / 100 : last.discount.value; dNote.value = last.discount.note || ''; }
  const deposit = el('input', { class: 'input', type: 'number', min: 0, max: 100, value: last?.depositPercent ?? p.rates.payment?.depositPercent ?? 50 });
  const days = el('input', { class: 'input', type: 'number', min: 1, value: last?.deliveryDays ?? 7 });
  const revs = el('input', { class: 'input', type: 'number', min: 0, value: last?.revisions ?? 2 });
  const note = el('textarea', { class: 'input', style: 'height:80px;padding:8px 10px', placeholder: 'Anything the client should know about this price or timeline' }, last?.note || '');
  const totalEl = el('span', { class: 'v' }); const breakdown = el('span', { class: 'muted', style: 'font-size:13px' });
  const readLines = () => [...linesBox.querySelectorAll('.pl')].map(row => Object.fromEntries([...row.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value])));
  function preview() {
    const ls = readLines();
    const sub = ls.reduce((s2, l) => s2 + (parseInt(l.qty, 10) || 1) * Math.round((parseFloat(String(l.price).replace(/[$,]/g, '')) || 0) * 100), 0);
    let disc = 0;
    if (dSource.value === 'custom') disc = dType.value === 'amount' ? Math.round((parseFloat(dValue.value) || 0) * 100) : Math.round(sub * Math.min(100, parseFloat(dValue.value) || 0) / 100);
    if (dSource.value === 'loyalty' && lock) disc = Math.round(sub * lock.discountPercent / 100);
    disc = Math.min(sub, disc);
    const dp = Math.max(0, Math.min(100, parseInt(deposit.value, 10) || 0));
    totalEl.textContent = money(sub - disc) || '$0';
    breakdown.textContent = `${disc ? `${money(sub)} less ${money(disc)}` : 'No discount'}${dp && dp < 100 ? ` · deposit ${money(Math.round((sub - disc) * dp / 100))}` : ''}`;
    const custom = dSource.value === 'custom';
    [dType, dValue, dNote].forEach(x => { const f = x.closest('.field-sm'); if (f) f.hidden = !custom; });
  }
  [dSource, dType, dValue, deposit].forEach(x => x.addEventListener('input', preview));
  const sendProp = el('button', { class: 'btn btn-gold', type: 'button' }, last ? 'Send updated proposal' : 'Send proposal');
  sendProp.addEventListener('click', async () => {
    sendProp.disabled = true;
    try {
      await call(`/projects/${p.id}/proposals`, { method: 'POST', body: {
        lines: readLines().map(l => ({ ...l, price: String(l.price).replace(/[$,]/g, '') })),
        discount: { source: dSource.value, type: dType.value, value: dValue.value, note: dNote.value },
        depositPercent: deposit.value, deliveryDays: days.value, revisions: revs.value, note: note.value,
        deliverables: p.rates.includedDeliverables || [] } });
      toast('Proposal sent'); renderProject(p.id);
    } catch { sendProp.disabled = false; }
  });
  const canPropose = p.paidCents === 0 && !['completed', 'cancelled'].includes(p.status);
  const builder = canPropose ? panel(p.openProposal ? 'Edit the open proposal' : 'Send a proposal', el('div', { class: 'panel-b prop-builder' },
    linesBox,
    el('button', { class: 'mini-btn', type: 'button', onclick: () => { addLine({ label: '', qty: 1, price: '' }); preview(); } }, '+ Add line'),
    el('div', { class: 'disc' }, field('Discount', dSource), field('Type', dType), field('Amount', dValue)),
    field('Discount label', dNote),
    el('div', { class: 'row3' }, field('Deposit %', deposit), field('Delivery (days)', days), field('Revisions', revs)),
    el('div', { style: 'margin-top:12px' }, field('Note to client', note)),
    el('div', { class: 'prop-preview' }, el('div', {}, el('div', { class: 'label' }, 'Client pays'), breakdown), totalEl),
    el('div', { class: 'a-actions', style: 'margin-top:12px' }, sendProp,
      p.openProposal ? (() => { const w = el('button', { class: 'mini-btn danger', type: 'button' }, 'Withdraw proposal'); armed(w, 'Confirm withdraw', async () => { await call(`/projects/${p.id}/proposals/${p.openProposal.id}/withdraw`, { method: 'POST' }); renderProject(p.id); }); return w; })() : ''),
    el('p', { class: 'help' }, 'Prices are prefilled from your rates in Settings. Change anything for this client; the email and their project page show exactly these lines.'))) : '';
  requestAnimationFrame(preview);

  // status and money
  const acc = p.acceptedProposal;
  const moneyActs = el('div', { class: 'a-actions' });
  const statusBtn = (st, label, cls = 'mini-btn') => { const b = el('button', { class: cls, type: 'button' }, label); b.addEventListener('click', async () => { await call(`/projects/${p.id}/status`, { method: 'POST', body: { status: st } }); toast('Updated'); renderProject(p.id); }); return b; };
  if (p.status === 'in_progress') moneyActs.append(statusBtn('delivered', p.balanceCents ? 'Deliver final mix and request balance' : 'Mark delivered', 'mini-btn gold'));
  if (p.status === 'awaiting_payment' || p.status === 'proposal' && false) {}
  if (acc && p.balanceCents > 0) {
    const amt = el('input', { class: 'mini-input', style: 'width:100px', placeholder: (p.balanceCents / 100).toFixed(0) });
    const rec = el('button', { class: 'mini-btn', type: 'button' }, 'Record payment');
    rec.addEventListener('click', async () => { await call(`/projects/${p.id}/payments`, { method: 'POST', body: { amount: amt.value || p.balanceCents / 100, kind: 'manual', method: 'manual' } }); toast('Payment recorded'); renderProject(p.id); });
    moneyActs.append(el('span', { class: 'muted', style: 'font-size:13px' }, 'Paid outside Stripe? $'), amt, rec);
  }
  if (!['completed', 'cancelled'].includes(p.status)) { const c = el('button', { class: 'mini-btn danger', type: 'button' }, 'Close project'); armed(c, 'Confirm close', async () => { await call(`/projects/${p.id}/status`, { method: 'POST', body: { status: 'cancelled' } }); renderProject(p.id); }); moneyActs.append(c); }

  const linkIn = el('input', { class: 'input', readonly: true, value: p.clientLink });
  const notes = el('textarea', { class: 'input', style: 'height:80px;padding:8px 10px' }, p.notes || '');
  notes.addEventListener('change', () => call(`/projects/${p.id}/notes`, { method: 'POST', body: { notes: notes.value } }).then(() => toast('Notes saved')));

  view.replaceChildren(
    el('a', { class: 'back', href: '#projects' }, '← All projects'),
    el('div', { class: 'a-head' }, el('div', {}, el('h1', {}, r.title), el('div', { class: 'sub' }, `${p.client.name || ''} ${p.client.artist ? `(${p.client.artist}) ` : ''}${p.client.email} · `, el('a', { href: `#client=${enc(p.client.email)}`, class: 'gold' }, 'client card'))), sPill(p.status)),
    el('div', { class: 'pj-grid' },
      el('div', {},
        el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Conversation'), thread, el('div', { class: 'composer' }, ta, send)),
        el('div', { style: 'height:16px' }), builder),
      el('div', {},
        el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Request'), el('div', { class: 'pb' }, el('dl', { class: 'kv2' },
          el('dt', {}, 'Services'), el('dd', {}, r.services.map(x => svcName[x]).join(', ') + (r.liveDrums ? ', live drums' : '')),
          el('dt', {}, 'Songs'), el('dd', {}, String(r.songs)),
          el('dt', {}, 'Deadline'), el('dd', {}, r.deadline || 'None given'),
          el('dt', {}, 'Budget'), el('dd', {}, r.budget || 'None given'),
          r.references ? [el('dt', {}, 'References'), el('dd', {}, rich(r.references))] : ''))),
        el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Money'), el('div', { class: 'pb' },
          acc ? el('dl', { class: 'kv2' }, el('dt', {}, 'Accepted'), el('dd', {}, money(acc.totalCents)), el('dt', {}, 'Paid'), el('dd', {}, money(p.paidCents) || '$0'), el('dt', {}, 'Balance'), el('dd', {}, money(p.balanceCents) || '$0'))
            : el('p', { class: 'muted', style: 'margin:0;font-size:14px' }, p.openProposal ? `Proposal of ${money(p.openProposal.totalCents)} waiting on the client.` : 'No proposal accepted yet.'),
          p.payments.length ? el('ul', { class: 'prop-lines', style: 'margin-top:10px' }, p.payments.map(x => el('li', {}, el('span', {}, `${x.kind} · ${x.method} · ${fmtDate(x.at)}`), el('span', {}, money(x.amountCents))))) : '',
          el('div', { style: 'margin-top:12px' }, moneyActs))),
        el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Loyalty'), el('div', { class: 'pb' },
          p.loyalty ? el('div', {}, dots(p.loyalty.punches, p.loyalty.bookingsRequired), el('span', { class: 'muted', style: 'margin-left:10px;font-size:13px' }, `${p.loyalty.punches} of ${p.loyalty.bookingsRequired}`), el('div', { style: 'margin-top:8px' }, lockPill(p.loyalty.activeLock)))
            : el('p', { class: 'muted', style: 'margin:0;font-size:14px' }, 'First project. They get a punch when this is paid in full.'))),
        el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Client link'), el('div', { class: 'pb' }, el('div', { class: 'link-box', style: 'margin:0' }, linkIn,
          el('button', { class: 'mini-btn gold', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(p.clientLink); toast('Copied'); } catch { linkIn.select(); } } }, 'Copy')))),
        el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Private notes'), el('div', { class: 'pb' }, notes))))
  );
  const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight;
}

// ---------- bookings ----------
function bookingsTable(list) {
  const rows = list.map(b => {
    const acts = el('div', { class: 'a-actions' });
    if (b.status === 'deposit_paid') {
      const link = el('button', { class: 'mini-btn gold', type: 'button' }, 'Copy balance link');
      link.addEventListener('click', async () => {
        const r = await call(`/bookings/${b.id}/balance-link`, { method: 'POST' });
        try { await navigator.clipboard.writeText(r.url); toast('Balance payment link copied. Send it to the client.'); } catch { prompt('Balance link', r.url); }
      });
      acts.append(link);
    }
    const mark = (status, label) => { const x = el('button', { class: 'mini-btn', type: 'button' }, label); x.addEventListener('click', async () => { await call(`/bookings/${b.id}/status`, { method: 'POST', body: { status } }); toast('Booking updated'); route(); }); return x; };
    if (b.status === 'pending' || b.status === 'demo') acts.append(mark('deposit_paid', 'Mark deposit paid'));
    if (b.status !== 'paid' && b.status !== 'cancelled') acts.append(mark('paid', 'Mark paid in full'));
    if (b.status !== 'cancelled' && b.status !== 'paid') { const x = el('button', { class: 'mini-btn danger', type: 'button' }, 'Cancel'); armed(x, 'Confirm cancel', async () => { await call(`/bookings/${b.id}/status`, { method: 'POST', body: { status: 'cancelled' } }); route(); }); acts.append(x); }
    const what = `${(b.services || []).map(s => s[0].toUpperCase() + s.slice(1)).join(' + ')} · ${b.songs} song${b.songs > 1 ? 's' : ''}`;
    return [fmtDate(b.createdAt), el('a', { href: `#client=${enc(b.email)}` }, b.name || b.email), el('div', {}, b.project || what, b.project ? el('div', { class: 'muted', style: 'font-size:12.5px' }, what) : ''),
      el('span', { class: 'num' }, Number.isInteger(b.totalCents) ? `${money(b.paidCents || 0)} of ${money(b.totalCents)}` : 'Rates not set'), statusPill(b.status), acts];
  });
  return table(['Created', 'Client', 'Project', 'Paid', 'Status', ''], rows);
}
async function renderBookings() {
  const { bookings } = await call('/bookings');
  view.replaceChildren(
    el('div', { class: 'a-head' }, el('div', {}, el('h1', {}, 'Bookings'), el('div', { class: 'sub' }, 'Every checkout started on the site. Marking a booking paid in full adds it to the client\'s card.'))),
    panel(`All bookings (${bookings.length})`, bookings.length ? bookingsTable(bookings) : empty('No bookings yet.')));
}

// ---------- settings ----------
async function renderSettings() {
  const s = settingsCache = await call('/settings');
  const rateField = (item, group) => field(`${item.name} (per ${item.unit})`,
    el('div', { class: 'money' }, el('span', {}, '$'), el('input', { class: 'input', name: `${group}.${item.id}`, inputmode: 'decimal', placeholder: 'Not set', value: Number.isInteger(item.rateCents) ? item.rateCents / 100 : '' })), 'field');
  const form = el('form', {},
    panel('Rates', el('div', { class: 'panel-b' },
      el('div', { class: 'settings-grid' }, s.services.map(x => rateField(x, 'services')), s.addOns.map(x => rateField(x, 'addOns'))),
      el('p', { class: 'help' }, 'Leave a rate blank to show [$RATE] on the site. Checkout only takes real payments once every chosen service has a rate and Stripe is connected.'))),
    panel('Payment', el('div', { class: 'panel-b settings-grid' },
      field('Deposit percent', el('input', { class: 'input', name: 'depositPercent', type: 'number', min: 10, max: 100, value: s.depositPercent }), 'field'),
      field('Dropbox file request link', el('input', { class: 'input', name: 'dropboxUrl', placeholder: 'https://www.dropbox.com/request/...', value: s.dropboxUrl.startsWith('[') ? '' : s.dropboxUrl }), 'field'))),
    panel('Loyalty card', el('div', { class: 'panel-b' },
      el('div', { class: 'settings-grid' },
        field('Sessions to fill a card', el('input', { class: 'input', name: 'loyalty.bookingsRequired', type: 'number', min: 1, value: s.loyalty.bookingsRequired }), 'field'),
        field('Rate lock window (days)', el('input', { class: 'input', name: 'loyalty.windowDays', type: 'number', min: 1, value: s.loyalty.windowDays }), 'field'),
        field('Discounted projects per window', el('input', { class: 'input', name: 'loyalty.projectLimit', type: 'number', min: 1, value: s.loyalty.projectLimit }), 'field'),
        field('Discount percent', el('input', { class: 'input', name: 'loyalty.discountPercent', type: 'number', min: 1, max: 100, value: s.loyalty.discountPercent }), 'field')),
      el('p', { class: 'help' }, 'The punch card, the loyalty section and the terms page all update to match. Windows already open keep their original terms.'))),
    el('div', { class: 'a-actions' }, el('button', { class: 'btn btn-gold', type: 'submit' }, 'Save settings')));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = { services: {}, addOns: {}, loyalty: {} };
    for (const [k, v] of new FormData(form)) {
      const [g, key] = k.split('.');
      if (key && (g === 'services' || g === 'addOns')) body[g][key] = { rate: v.trim() === '' ? null : v.replace(/[$,\s]/g, '') };
      else if (key && g === 'loyalty') body.loyalty[key] = v;
      else body[k] = v;
    }
    await call('/settings', { method: 'PUT', body });
    toast('Settings saved'); renderSettings();
  });
  view.replaceChildren(el('div', { class: 'a-head' }, el('div', {}, el('h1', {}, 'Settings'), el('div', { class: 'sub' }, 'Rates and program rules. Changes go live on the site immediately.'))), form);
}

// ---------- start ----------
async function start() {
  const me = await api('/api/admin/me');
  if (!me.admin) return showLogin(me.passwordSet ? undefined : 'Admin is locked until you add ADMIN_PASSWORD to your .env file and restart the server.');
  $('#login').hidden = true;
  $$('.admin-tabs, .admin-tabs-mobile').forEach(n => n.hidden = false);
  $('#logout').hidden = false;
  call('/settings').then(s => { settingsCache = s; }).catch(() => {});
  route();
  refreshUnread();
  setInterval(() => { if (!document.hidden) refreshUnread(); }, 30000);
}
start();
