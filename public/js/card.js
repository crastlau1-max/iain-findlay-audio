// Client side: a private punch card reached by a secret link from Iain.
import { $, el, api } from './lib.js';

const root = $('#card-root');
const token = location.pathname.split('/').pop();
const fmt = d => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

try {
  const c = await api(`/api/card/${encodeURIComponent(token)}`);
  const total = c.bookingsRequired;
  const left = total - c.punches;
  const card = el('div', { class: 'punchcard' },
    el('div', { class: 'pc-top' },
      el('div', {}, el('div', { class: 'pc-title' }, 'Iain Findlay'), el('div', { class: 'pc-sub' }, c.name ? `Client card for ${c.name}` : 'Client card')),
      el('div', { class: 'pc-mark' }, 'Rate lock')),
    el('div', { class: 'punches', style: `grid-template-columns: repeat(${Math.min(5, Math.ceil(total / Math.ceil(total / 5)))}, 1fr)` },
      Array.from({ length: total }, (_, i) => el('span', { class: `punch${i < c.punches ? ' on' : ''}${i === total - 1 ? ' reward' : ''}${c.activeLock && i === total - 1 ? ' lit' : ''}` }, i === total - 1 ? '★' : String(i + 1)))),
    el('div', { class: 'pc-bottom' }, el('span', {}, el('strong', {}, `${c.punches} of ${total}`), ' sessions on this card'), el('span', {}, `${c.countedSessions} sessions in total`)));
  const status = el('div', { class: 'card-status' },
    c.activeLock
      ? el('div', { class: 'lock' }, el('div', { class: 'card-status' }, el('div', { class: 'h' }, 'Your rate lock is open'),
          el('div', {}, 'You have ', el('strong', {}, `${c.activeLock.remaining} project${c.activeLock.remaining === 1 ? '' : 's'}`), ' left at ', el('strong', {}, `${c.activeLock.discountPercent}% off`), ` until ${fmt(c.activeLock.expiresAt)}. Book with the same email and it applies at checkout.`)))
      : el('div', { class: 'h' }, left === total ? 'Your card is ready' : `${left} more session${left === 1 ? '' : 's'} to your rate lock`),
    el('p', { class: 'lede', style: 'margin:0' }, 'Every paid booking counts, whether it is booked here or with me on SoundBetter. Your progress is tied to your billing email.'),
    c.recent.length ? el('div', {}, el('div', { class: 'label' }, 'Recent sessions'), el('ul', { class: 'recent' }, c.recent.map(r => el('li', {}, el('span', {}, r.title), el('span', {}, fmt(r.date)))))) : '',
    el('div', { class: 'hero-ctas' }, el('a', { class: 'btn btn-gold', href: '/#book' }, 'Book a session'), el('a', { class: 'btn', href: '/terms#loyalty' }, 'Program terms')));
  root.replaceChildren(card, status);
} catch {
  root.replaceChildren(el('div', { class: 'card-status' }, el('div', { class: 'h' }, 'This card link is not valid'), el('p', { class: 'lede' }, 'It may have been replaced with a new one. Ask Iain for your current link.'), el('div', {}, el('a', { class: 'btn btn-gold', href: '/' }, 'Go to the site'))));
}
