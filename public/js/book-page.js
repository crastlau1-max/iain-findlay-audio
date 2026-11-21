// Booking profile: tabs for overview, services, samples, reviews and FAQ, with a quote card.
import { $, $$, el, api, icons, artwork, badges, money } from './lib.js?v=5';
import * as player from './player.js?v=5';
import { initNav } from './nav.js?v=5';

initNav();

// ---------- tabs (one panel at a time, kept in the address) ----------
const tabs = $$('.pf-tabs [role="tab"]');
function show(name) {
  if (!tabs.some(t => t.dataset.tab === name)) name = 'services';
  tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('.pf-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
}
tabs.forEach(t => t.addEventListener('click', () => { history.replaceState(null, '', `#${t.dataset.tab}`); show(t.dataset.tab); }));
show(location.hash.slice(1));
addEventListener('hashchange', () => show(location.hash.slice(1)));

const [cfg, stats, hl, top, rv] = await Promise.all([
  api('/api/config'),
  api('/api/credits/stats'),
  api('/api/credits/highlights?limit=8'),
  api('/api/credits?sort=popularity&category=mixing&limit=12'),
  api('/api/reviews').catch(() => ({ count: 0, average: null, reviews: [] }))
]);
$$('[data-soundbetter]').forEach(a => { a.href = cfg.soundbetterUrl; });
const L = cfg.loyalty || {};
$$('[data-loy]').forEach(n => { const v = L[n.dataset.loy]; if (v != null) n.textContent = v; });

const stars = n => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));
const fromPrice = s => Number.isInteger(s.rateCents) ? `From ${money(s.rateCents)} / ${s.unit}` : 'Quoted per project';

// ---------- header meta ----------
$('#pf-meta').replaceChildren(...[
  rv.count ? el('span', { class: 'pf-rating' }, el('span', { class: 'stars', 'aria-hidden': 'true' }, stars(rv.average)), ` ${rv.average.toFixed(1)} (${rv.count})`) : null,
  el('span', {}, `${stats.totalCount} credits`),
  stats.certifiedUnits ? el('span', {}, `${Math.round(stats.certifiedUnits / 1e6)}M RIAA certified units`) : null
].filter(Boolean));
$('#rev-count').textContent = rv.count ? String(rv.count) : '';

// ---------- overview ----------
const facts = [
  ['Location', 'Los Angeles, CA'],
  ['Services', cfg.services.map(s => s.name).join(', ')],
  ['Add-ons', cfg.addOns.map(s => s.name).join(', ')],
  ['Credits', `${stats.totalCount} (Muso.ai)`],
  ['Artists', (cfg.featuredArtists || []).join(', ')],
  ['Included', cfg.includedDeliverables.join(', ')],
  ['Revisions', 'Two rounds per song'],
  ['Payment', `Stripe. ${cfg.payment?.depositPercent || 50}% deposit or paid in full`]
].filter(([, v]) => v);
$('#pf-facts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));

function playable(c, cls) {
  const b = el('button', { class: cls, type: 'button', 'aria-label': `Play ${c.title} by ${c.artist}`, dataset: { id: c.id } },
    artwork(c.artworkUrl, ''), badges(c, { max: 1 }),
    el('span', { class: 'cv-meta' }, el('span', { class: 't' }, c.title.replace(/\s*\((feat|with)\.?[^)]*\)/i, '')), el('span', { class: 'a' }, c.artist)));
  b.addEventListener('click', () => player.play(c));
  return b;
}
$('#pf-selected').replaceChildren(...hl.credits.slice(0, 8).map(c => playable(c, 'pf-cover-tile')));

// ---------- services ----------
const svcCard = s => el('article', { class: 'pf-svc' },
  el('div', { class: 'pf-svc-top' }, el('h3', { class: 'h3' }, s.name), el('span', { class: 'pf-price' }, fromPrice(s))),
  el('ul', { class: 'pf-incl' }, cfg.includedDeliverables.map(d => el('li', { html: icons.check }, d))),
  el('a', { class: 'btn btn-sm', href: `/book/request?service=${encodeURIComponent(s.id)}` }, 'Request a quote'));
const addonRow = a => el('li', { class: 'pf-addon' },
  el('div', { class: 'name' }, a.name),
  el('span', { class: 'pf-price' }, Number.isInteger(a.rateCents) ? `+${money(a.rateCents)} / ${a.unit}` : 'Quoted per project'));
$('#pf-services').replaceChildren(...cfg.services.map(svcCard),
  cfg.addOns.length ? el('div', { class: 'pf-addons' }, el('h3', { class: 'pf-h', style: 'margin-top:12px' }, 'Add-ons'),
    el('ul', {}, cfg.addOns.map(addonRow))) : null);

// ---------- samples ----------
function sampleRow(c) {
  const btn = el('button', { class: 'play-btn', type: 'button', 'aria-label': `Play ${c.title}`, html: icons.play });
  const li = el('li', { class: 'pf-sample', dataset: { id: c.id } }, artwork(c.artworkUrl, ''),
    el('div', { class: 'txt' }, el('div', { class: 't' }, c.title), el('div', { class: 'a' }, `${c.artist} · ${c.role}`)), btn);
  li.addEventListener('click', () => player.play(c));
  return li;
}
$('#pf-samples').replaceChildren(...top.credits.slice(0, 12).map(sampleRow));
player.onChange(({ id, playing }) => {
  $$('.pf-sample').forEach(r => { const on = playing && r.dataset.id === id; r.classList.toggle('is-playing', on); r.querySelector('.play-btn').innerHTML = on ? icons.pause : icons.play; });
  $$('.pf-cover-tile').forEach(t => t.classList.toggle('is-playing', playing && t.dataset.id === id));
});

// ---------- reviews ----------
const fmtDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
$('#pf-reviews').replaceChildren(rv.count
  ? el('div', {},
      el('div', { class: 'rv-sum' }, el('span', { class: 'rv-avg' }, rv.average.toFixed(1)), el('span', { class: 'stars' }, stars(rv.average)), el('span', { class: 'label' }, `${rv.count} review${rv.count === 1 ? '' : 's'}`)),
      el('ul', { class: 'rv-list' }, rv.reviews.map(r => el('li', {},
        el('div', { class: 'rv-top' }, el('strong', {}, r.name), el('span', { class: 'stars', 'aria-label': `${r.stars} of 5` }, stars(r.stars)), el('span', { class: 'label' }, `${fmtDate(r.createdAt)}${r.source !== 'site' ? ` · ${r.source[0].toUpperCase()}${r.source.slice(1)}` : ''}`)),
        r.services?.length ? el('div', { class: 'label' }, r.services.map(s => s[0].toUpperCase() + s.slice(1)).join(', ')) : null,
        el('p', {}, r.text),
        r.reply ? el('div', { class: 'rv-reply' }, el('strong', {}, 'Iain: '), r.reply) : null))))
  : el('div', { class: 'rv-empty' }, el('p', {}, 'No reviews yet.'), el('a', { href: cfg.soundbetterUrl, target: '_blank', rel: 'noopener' }, 'Reviews on SoundBetter')));

// ---------- FAQ ----------
const faq = [
  ['What files do I send?', el('ul', {}, (cfg.intake?.guidelines || []).map(g => el('li', {}, g)))],
  ['What is included?', cfg.includedDeliverables.join(', ') + '.'],
  ['How many revisions?', 'Two rounds per song. More can be added to a proposal.'],
  ['How does payment work?', `Through Stripe after you accept a proposal: a ${cfg.payment?.depositPercent || 50}% deposit with the balance due on approval, or the full amount up front.`],
  ['How long does it take?', 'Each proposal states a delivery time. It starts once files and payment are in.'],
  ['Who owns the music?', 'You do. Files are yours once the project is paid in full.']
];
$('#pf-faq').replaceChildren(...faq.map(([q, a]) => el('details', {}, el('summary', {}, q), el('div', { class: 'ans' }, a))),
  el('p', { class: 'pf-more' }, el('a', { href: '/terms' }, 'Booking terms')));

// ---------- quote card ----------
$('#quote-lines').replaceChildren(
  ...cfg.services.map(s => el('li', {}, el('span', {}, s.name), el('span', {}, Number.isInteger(s.rateCents) ? `from ${money(s.rateCents)}` : 'Quote'))),
  el('li', {}, el('span', {}, 'Reply time'), el('span', {}, 'Usually within a day')));
