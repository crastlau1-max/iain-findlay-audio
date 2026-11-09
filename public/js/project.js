// Client project page: thread, proposal, accept and pay. Reached only by private link.
import { $, el, api, money } from './lib.js';

const root = $('#pj-root');
const token = location.pathname.split('/').pop();
const toastEl = $('#toast'); let tt;
const toast = m => { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3000); };
const when = d => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STEPS = [['request', 'Request sent'], ['proposal', 'Proposal'], ['awaiting_payment', 'Accepted'], ['in_progress', 'In progress'], ['delivered', 'Final mix delivered'], ['completed', 'Completed']];
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
  const ta = el('textarea', { class: 'input', placeholder: data.status === 'cancelled' ? 'This project is closed' : 'Write a message. Paste links to files or references.', disabled: data.status === 'cancelled' });
  const send = el('button', { class: 'btn btn-gold', type: 'button', disabled: data.status === 'cancelled' }, 'Send');
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
    el('div', { class: 'pb' }, data.status === 'cancelled' ? el('p', { class: 'label', style: 'margin:0' }, 'This project was closed. Start a new request any time from the homepage.')
      : el('ol', { class: 'status-steps' }, STEPS.map((s, i) => el('li', { class: i < idx ? 'done' : i === idx ? 'now' : '' }, el('i'), s[1])))));
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
    const accept = el('button', { class: 'btn btn-gold', type: 'button' }, 'Accept proposal');
    accept.addEventListener('click', async () => {
      if (!terms.checked) return toast('Please accept the booking terms first.');
      accept.disabled = true;
      try { data = await api(`/api/projects/${token}/accept`, { method: 'POST', body: { proposalId: p.id, acceptTerms: true } }); render(); toast('Accepted. Choose how to pay below.'); }
      catch (e) { toast(e.message); accept.disabled = false; }
    });
    body.append(el('label', { class: 'check', style: 'margin-top:14px' }, terms, el('span', {}, 'I agree to the ', el('a', { href: '/terms', target: '_blank' }, 'booking terms'), '.')), el('div', { class: 'pay-actions' }, accept));
  }
  if (mode === 'accepted' && data.balanceCents > 0 && ['awaiting_payment', 'delivered'].includes(data.status)) {
    const acts = el('div', { class: 'pay-actions' });
    const pay = async kind => {
      try {
        const r = await api(`/api/projects/${token}/pay`, { method: 'POST', body: { kind } });
        if (r.url) location.href = r.url; else toast(r.message);
      } catch (e) { toast(e.message); }
    };
    if (data.paidCents === 0 && p.depositPercent > 0 && p.depositPercent < 100) {
      acts.append(el('button', { class: 'btn btn-gold', type: 'button', onclick: () => pay('deposit') }, `Pay ${p.depositPercent}% deposit · ${money(p.depositCents)}`));
      acts.append(el('button', { class: 'btn', type: 'button', onclick: () => pay('full') }, `Pay in full · ${money(p.totalCents)}`));
    } else acts.append(el('button', { class: 'btn btn-gold', type: 'button', onclick: () => pay('balance') }, `${data.paidCents ? 'Pay balance' : 'Pay'} · ${money(data.balanceCents)}`));
    acts.append(el('div', { class: 'secure-note' }, 'Secure payment by Stripe'));
    body.append(acts);
  }
  if (mode === 'accepted') body.append(el('div', { class: 'prop-terms', style: 'margin-top:12px' }, `Paid ${money(data.paidCents)} of ${money(p.totalCents)}`));
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, mode === 'open' ? 'Proposal' : 'Your booking'), body);
}

function requestCard() {
  const r = data.request;
  return el('section', { class: 'pj-panel' }, el('div', { class: 'ph' }, 'Your request'),
    el('div', { class: 'pb' }, el('dl', { class: 'kv2' },
      el('dt', {}, 'Services'), el('dd', {}, r.services.map(s => s[0].toUpperCase() + s.slice(1)).join(', ') + (r.liveDrums ? ', live drums' : '')),
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
      /^https?:/.test(url || '') ? el('a', { class: 'btn btn-gold', href: url, target: '_blank', rel: 'noopener', style: 'width:100%' }, 'Upload to my Dropbox') : el('p', { class: 'label', style: 'margin:0 0 10px' }, 'I\'ll send the upload link in the messages.'),
      el('ol', { class: 'spec-list', style: 'margin:14px 0 0' }, (data.intake.guidelines || []).map(g => el('li', {}, g)))));
}

function render() {
  const sideItems = [steps()];
  if (data.openProposal) sideItems.push(proposalCard(data.openProposal, 'open'));
  else if (data.acceptedProposal) sideItems.push(proposalCard(data.acceptedProposal, 'accepted'));
  sideItems.push(intakeCard(), requestCard());
  root.replaceChildren(
    el('div', { class: 'pj-head' }, el('div', {}, el('div', { class: 'label' }, 'Your project'), el('h1', {}, data.request.title), el('div', { class: 'sub' }, `Started ${when(data.createdAt)}. Bookmark this page; the link is private to you.`))),
    el('div', { class: 'pj-grid' }, el('div', {}, thread()), el('div', { class: 'pj-side' }, sideItems)));
  const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight;
  lastCount = data.messages.length;
}

async function load(quiet) {
  try {
    const next = await api(`/api/projects/${encodeURIComponent(token)}`);
    if (!quiet || next.messages.length !== lastCount || next.status !== data?.status) { data = next; render(); }
  } catch {
    if (!quiet) root.replaceChildren(el('div', {}, el('h1', { class: 'display', style: 'font-size:48px' }, 'Project not found'), el('p', { class: 'lede' }, 'Check the link in your email, or start a new request.'), el('a', { class: 'btn btn-gold', href: '/#book' }, 'Start a request')));
  }
}
await load(false);
const q = new URLSearchParams(location.search);
if (q.has('new')) toast('Request sent. I\'ll reply here, and you\'ll get an email when I do.');
if (q.has('paid')) toast('Payment received. Thank you.');
if (q.has('new') || q.has('paid')) history.replaceState(null, '', location.pathname);
setInterval(() => { if (!document.hidden) load(true); }, 20000);
