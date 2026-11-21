// Client project page: thread, proposal, payment, delivery approval, revisions and review.
// Opens by project id for a signed in client, or by the private token link from older emails.
import { $, el, api, money, dropZone, uploadFile, bytes } from './lib.js?v=5';
import { initNav, me } from './nav.js?v=5';

initNav();

const root = $('#pj-root');
const token = location.pathname.split('/').pop();
const toastEl = $('#toast'); let tt;
const toast = m => { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3000); };
const when = d => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STEPS = [['request', 'Request sent'], ['proposal', 'Proposal'], ['awaiting_payment', 'Accepted'], ['in_progress', 'In progress'], ['delivered', 'Delivered'], ['completed', 'Completed']];
const act = async (path, body) => { data = await api(`/api/projects/${token}/${path}`, { method: 'POST', body: body || {} }); render(); };
let data = null, lastCount = 0;

// Messages are plain text; links become clickable, nothing else is interpreted.
function richText(text) {
  const frag = document.createDocumentFragment();
  String(text).split(/(https?:\/\/[^\s<]+)/g).forEach((part, i) => {
    frag.append(i % 2 ? el('a', { href: part, target: '_blank', rel: 'noopener nofollow' }, part) : part);
  });
  return frag;
}

function thread() {
  const box = el('div', { class: 'thread', id: 'thread' }, data.messages.map(m =>
    el('div', { class: `msg ${m.from === 'client' ? 'me' : m.from === 'system' ? 'sys' : 'them'}` },
      richText(m.body), m.from !== 'system' ? el('div', { class: 'meta' }, `${m.from === 'client' ? 'You' : 'Iain'} · ${when(m.at)}`) : el('span', { class: 'meta' }, ` · ${when(m.at)}`))));
  const ta = el('textarea', { class: 'input', maxlength: 4000, placeholder: data.status === 'cancelled' ? 'This project is closed' : 'Message', disabled: data.status === 'cancelled' });
  const send = el('button', { class: 'btn btn-primary', type: 'button', disabled: data.status === 'cancelled' }, 'Send');
  const go = async () => {
    if (!ta.value.trim()) return;
    send.disabled = true;
    try { data = await api(`/api/projects/${token}/messages`, { method: 'POST', body: { body: ta.value } }); ta.value = ''; render(); }
    catch (e) { toast(e.message); } finally { send.disabled = false; }
  };
  send.addEventListener('click', go);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(); });
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Messages'), box, el('div', { class: 'composer' }, ta, send));
}

function steps() {
  const idx = STEPS.findIndex(s => s[0] === data.status);
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Status', el('span', { class: 'badge-status' }, data.statusLabel)),
    el('div', { class: 'pb' }, data.status === 'cancelled' ? el('p', { class: 'label', style: 'margin:0' }, 'Closed.')
      : el('ol', { class: 'status-steps' }, STEPS.map((s, i) => el('li', { class: i < idx ? 'done' : i === idx ? 'now' : '' }, el('i'), s[1]))),
      ['request', 'proposal'].includes(data.status) && !data.paidCents ? cancelLink() : null));
}

function cancelLink() {
  const b = el('button', { class: 'link-btn', type: 'button' }, 'Cancel request');
  b.addEventListener('click', async () => {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Click again to cancel'; return; }
    try { await act('cancel'); toast('Request cancelled.'); } catch (e) { toast(e.message); }
  });
  return el('div', { style: 'margin-top:12px' }, b);
}

// Delivered: approve, or ask for a revision while rounds remain.
function deliveryCard() {
  if (data.status !== 'delivered' || data.approvedAt) return '';
  const left = Math.max(0, (data.revisionsIncluded || 0) - (data.revisionsUsed || 0));
  const approve = el('button', { class: 'btn btn-primary', type: 'button' }, data.balanceCents ? 'Approve and pay balance' : 'Approve');
  approve.addEventListener('click', async () => {
    approve.disabled = true;
    try {
      await act('approve');
      if (data.balanceCents) { const r = await api(`/api/projects/${token}/pay`, { method: 'POST', body: { kind: 'balance' } }); if (r.url) location.href = r.url; else toast(r.message); }
      else toast('Approved.');
    } catch (e) { toast(e.message); approve.disabled = false; }
  });
  const notes = el('textarea', { class: 'input', placeholder: 'Revision notes', rows: 4, maxlength: 4000 });
  const ask = el('button', { class: 'btn', type: 'button', disabled: !left }, `Request revision (${left} left)`);
  ask.addEventListener('click', async () => {
    try { await act('revision', { notes: notes.value }); toast('Revision requested.'); } catch (e) { toast(e.message); }
  });
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Review the delivery'),
    el('div', { class: 'pb' }, el('div', { class: 'pay-actions', style: 'margin-top:0' }, approve),
      left ? el('div', { class: 'rev-box' }, notes, ask) : el('p', { class: 'label', style: 'margin:12px 0 0' }, 'No revision rounds left. Message Iain to add more.')));
}

function reviewCard() {
  if (data.status !== 'completed') return '';
  if (data.review) return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Your review'),
    el('div', { class: 'pb' }, el('div', { class: 'stars' }, '★'.repeat(data.review.stars) + '☆'.repeat(5 - data.review.stars)), el('p', { style: 'margin:8px 0 0;color:var(--text-2)' }, data.review.text)));
  let stars = 0;
  const row = el('div', { class: 'star-input', role: 'radiogroup', 'aria-label': 'Rating' });
  const paint = () => [...row.children].forEach((b, i) => { b.textContent = i < stars ? '★' : '☆'; b.setAttribute('aria-checked', String(i + 1 === stars)); });
  for (let i = 1; i <= 5; i++) row.append(el('button', { type: 'button', role: 'radio', 'aria-label': `${i} star${i > 1 ? 's' : ''}`, onclick: () => { stars = i; paint(); } }, '☆'));
  const text = el('textarea', { class: 'input', rows: 4, placeholder: 'How did it go?', maxlength: 2000 });
  const send = el('button', { class: 'btn btn-primary', type: 'button' }, 'Post review');
  send.addEventListener('click', async () => {
    try { await act('review', { stars, text: text.value }); toast('Review posted.'); } catch (e) { toast(e.message); }
  });
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Leave a review'), el('div', { class: 'pb rev-box' }, row, text, send));
}

function proposalCard(p, mode) {
  const lines = p.lines.map(l => el('li', {}, el('span', {}, `${l.label}${l.qty > 1 ? ` × ${l.qty}` : ''}`), el('span', {}, money(l.unitCents * l.qty))));
  if (p.discountCents) lines.push(el('li', { class: 'disc' }, el('span', {}, p.discount?.note || 'Discount'), el('span', {}, `−${money(p.discountCents)}`)));
  const body = el('div', { class: 'pb' },
    el('ul', { class: 'prop-lines' }, lines),
    el('div', { class: 'prop-total' }, el('span', {}, 'Total'), el('span', { class: 'v' }, money(p.totalCents))),
    el('div', { class: 'prop-terms' },
      el('div', {}, `Delivery in ${p.deliveryDays} day${p.deliveryDays === 1 ? '' : 's'} after files arrive`),
      el('div', {}, `${p.revisions} round${p.revisions === 1 ? '' : 's'} of revisions included`),
      p.deliverables?.length ? el('div', {}, `Includes: ${p.deliverables.join(', ')}`) : '',
      p.depositPercent > 0 && p.depositPercent < 100 ? el('div', {}, `${p.depositPercent}% deposit (${money(p.depositCents)}) to start, balance when you approve the final mix`) : el('div', {}, 'Paid in full to start')),
    p.note ? el('div', { class: 'prop-note' }, p.note) : '');

  if (mode === 'open') {
    const terms = el('input', { type: 'checkbox' });
    const accept = el('button', { class: 'btn btn-primary', type: 'button' }, 'Accept proposal');
    accept.addEventListener('click', async () => {
      if (!terms.checked) return toast('Please accept the booking terms first.');
      accept.disabled = true;
      try { data = await api(`/api/projects/${token}/accept`, { method: 'POST', body: { proposalId: p.id, acceptTerms: true } }); render(); toast('Accepted. Choose how to pay below.'); }
      catch (e) { toast(e.message); accept.disabled = false; }
    });
    body.append(el('label', { class: 'check', style: 'margin-top:14px' }, terms, el('span', {}, 'I agree to the ', el('a', { href: '/terms', target: '_blank' }, 'booking terms'), '.')), el('div', { class: 'pay-actions' }, accept));
  }
  if (mode === 'accepted' && data.balanceCents > 0 && (data.status === 'awaiting_payment' || (data.status === 'delivered' && data.approvedAt))) {
    const acts = el('div', { class: 'pay-actions' });
    const pay = async kind => {
      try {
        const r = await api(`/api/projects/${token}/pay`, { method: 'POST', body: { kind } });
        if (r.url) location.href = r.url; else toast(r.message);
      } catch (e) { toast(e.message); }
    };
    if (data.paidCents === 0 && p.depositPercent > 0 && p.depositPercent < 100) {
      acts.append(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => pay('deposit') }, `Pay ${p.depositPercent}% deposit · ${money(p.depositCents)}`));
      acts.append(el('button', { class: 'btn', type: 'button', onclick: () => pay('full') }, `Pay in full · ${money(p.totalCents)}`));
    } else acts.append(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => pay('balance') }, `${data.paidCents ? 'Pay balance' : 'Pay'} · ${money(data.balanceCents)}`));
    acts.append(el('div', { class: 'secure-note' }, 'Secure payment by Stripe'));
    body.append(acts);
  }
  if (mode === 'accepted') body.append(el('div', { class: 'prop-terms', style: 'margin-top:12px' }, `Paid ${money(data.paidCents)} of ${money(p.totalCents)}`));
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, mode === 'open' ? 'Proposal' : 'Your booking'), body);
}

function filesCard() {
  const when2 = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const list = el('ul', { class: 'file-list', style: 'margin:0' }, (data.files || []).map(f => el('li', {},
    el('a', { class: 'fn', href: `/api/projects/${token}/files/${f.id}`, download: f.name }, f.name),
    el('span', { class: 'fs' }, bytes(f.size)),
    el('span', { class: 'file-meta' }, `${f.from === 'client' ? 'You' : 'Iain'} · ${when2(f.at)}`))));
  const body = el('div', { class: 'pb' }, data.files?.length ? list : el('p', { class: 'label', style: 'margin:0 0 12px' }, 'No files yet.'));
  if (data.status !== 'cancelled') {
    const drop = dropZone();
    const send = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Upload');
    const bar = el('div', { class: 'up-bar', hidden: true }, el('i'));
    send.addEventListener('click', async () => {
      const picked = drop.files();
      if (!picked.length) return toast('Choose a file first.');
      send.disabled = true; bar.hidden = false;
      const total = picked.reduce((s, f) => s + f.size, 0); let done = 0;
      for (const [i, f] of picked.entries()) {
        send.textContent = `Uploading ${i + 1} of ${picked.length}`;
        try { data = await uploadFile(`/api/projects/${token}/files`, f, p => { bar.firstChild.style.width = `${Math.round((done + f.size * p) / total * 100)}%`; }); }
        catch (e) { toast(`${f.name}: ${e.message}`); }
        done += f.size;
      }
      render(); toast('Upload finished.');
    });
    body.append(el('div', { style: 'margin-top:14px;display:grid;gap:10px;justify-items:start' }, drop.node, bar, send));
  }
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Files', data.files?.length ? el('span', { class: 'label' }, String(data.files.length)) : null), body);
}

function requestCard() {
  const r = data.request;
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Your request'),
    el('div', { class: 'pb' }, el('dl', { class: 'kv2' },
      el('dt', {}, 'Services'), el('dd', {}, r.services.map(s => s[0].toUpperCase() + s.slice(1)).join(', ')),
      r.liveDrums ? [el('dt', {}, 'Add-on'), el('dd', {}, 'Live Drum Recording')] : '',
      el('dt', {}, 'Songs'), el('dd', {}, String(r.songs)),
      r.deadline ? [el('dt', {}, 'Deadline'), el('dd', {}, r.deadline)] : '',
      r.budget ? [el('dt', {}, 'Budget'), el('dd', {}, r.budget)] : '',
      r.references ? [el('dt', {}, 'References'), el('dd', {}, richText(r.references))] : '')));
}

function intakeCard() {
  if (!data.intake) return '';
  const url = data.intake.dropboxUrl;
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Send your files'),
    el('div', { class: 'pb' },
      /^https?:/.test(url || '') ? el('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener', style: 'width:100%' }, 'Upload to my Dropbox') : el('p', { class: 'label', style: 'margin:0 0 10px' }, 'I\'ll send the upload link in the messages.'),
      el('ol', { class: 'spec-list', style: 'margin:14px 0 0' }, (data.intake.guidelines || []).map(g => el('li', {}, g)))));
}

function render() {
  const sideItems = [steps()];
  sideItems.push(deliveryCard(), reviewCard());
  if (data.openProposal) sideItems.push(proposalCard(data.openProposal, 'open'));
  else if (data.acceptedProposal) sideItems.push(proposalCard(data.acceptedProposal, 'accepted'));
  sideItems.push(intakeCard(), requestCard());
  root.replaceChildren(
    el('div', { class: 'pj-head' }, el('div', {}, signedIn ? el('a', { class: 'label', href: '/account' }, '← Projects') : el('div', { class: 'label' }, 'Project'), el('h1', {}, data.request.title), el('div', { class: 'sub' }, `Started ${when(data.createdAt)}`))),
    el('div', { class: 'pj-grid' }, el('div', {}, thread(), filesCard()), el('div', { class: 'pj-side' }, sideItems)));
  const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight;
  lastCount = data.messages.length;
}

async function load(quiet) {
  try {
    const next = await api(`/api/projects/${encodeURIComponent(token)}`);
    if (!quiet || next.messages.length !== lastCount || next.status !== data?.status) { data = next; render(); }
  } catch {
    if (!quiet) root.replaceChildren(el('div', {}, el('h1', { class: 'display', style: 'font-size:48px' }, 'Project not found'),
      signedIn ? el('a', { class: 'btn', href: '/account' }, 'Your projects') : el('a', { class: 'btn btn-primary', href: `/signin?next=${encodeURIComponent(location.pathname)}` }, 'Sign in')));
  }
}
const signedIn = Boolean(await me());
await load(false);
const q = new URLSearchParams(location.search);
if (q.has('new')) {
  let failed = null; try { failed = sessionStorage.getItem('uploadErrors'); sessionStorage.removeItem('uploadErrors'); } catch {}
  toast(failed ? `Request sent. Some files didn't upload: ${failed}` : 'Request sent.');
}
if (q.has('paid')) toast('Payment received. Thank you.');
if (q.has('new') || q.has('paid')) history.replaceState(null, '', location.pathname);
setInterval(() => { if (!document.hidden) load(true); }, 20000);
