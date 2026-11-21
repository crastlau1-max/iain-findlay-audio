// Recording course page. Everything comes from config/studio.json → course;
// anything not filled in yet shows as "To be announced".
import { $, $$, el, api, money } from './lib.js?v=5';
import { initNav } from './nav.js?v=5';

initNav();

const tabs = $$('.pf-tabs [role="tab"]');
function show(name) {
  if (!tabs.some(t => t.dataset.tab === name)) name = 'schedule';
  tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('.pf-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
}
tabs.forEach(t => t.addEventListener('click', () => { history.replaceState(null, '', `#${t.dataset.tab}`); show(t.dataset.tab); }));
addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1));

const [cfg, stats] = await Promise.all([api('/api/config'), api('/api/credits/stats').catch(() => null)]);
const c = cfg.course || {};
const tbd = () => el('span', { class: 'tbd' }, 'To be announced');
const val = v => (v == null || v === '' || (Array.isArray(v) && !v.length) ? tbd() : v);
const fmtDay = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const next = (c.sessions || []).find(s => s.start >= new Date().toISOString().slice(0, 10));
const place = [c.venue, c.city].filter(Boolean).join(', ');

// ---------- header ----------
if (c.title) $('#c-title').textContent = c.title;
$('#c-sub').textContent = [c.venue, c.city].filter(Boolean).join(' · ');
$('#c-meta').replaceChildren(...[
  c.lengthDays && `${c.lengthDays} days`, c.classSize, Number.isInteger(c.priceCents) && `${money(c.priceCents)} per student`,
  next ? `Next class ${fmtDay(next.start)}` : 'Next class to be announced'
].filter(Boolean).map(t => el('span', {}, t)));

// ---------- schedule ----------
$('#c-days').replaceChildren(...(c.days || []).map((d, i) => el('article', { class: 'c-day' },
  el('div', { class: 'c-day-n' }, String(i + 1)),
  el('div', {},
    el('h3', { class: 'h3' }, d.title || `Day ${i + 1}`),
    el('div', { class: 'label' }, d.hours || c.dailyHours || 'Hours to be announced'),
    el('ul', { class: 'c-topics' }, (d.topics || []).map(t => el('li', {}, t)))))));
$('#c-prep').replaceChildren(...[
  ['Daily hours', c.dailyHours], ['Requirements', c.requirements], ['What to bring', c.bring], ['Included', c.included]
].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, val(v))]));

// ---------- dates ----------
const sessions = c.sessions || [];
$('#c-dates').replaceChildren(sessions.length
  ? el('ul', { class: 'c-sessions' }, sessions.map(s => el('li', {},
      el('div', {}, el('div', { class: 'c-when' }, s.end && s.end !== s.start ? `${fmtDay(s.start)} – ${fmtDay(s.end)}` : fmtDay(s.start)), s.note ? el('div', { class: 'label' }, s.note) : null),
      el('span', { class: `status${s.full ? '' : ' s-proposal'}` }, s.full ? 'Full' : s.seatsLeft != null ? `${s.seatsLeft} spots left` : 'Open'),
      s.full ? null : el('a', { class: 'btn btn-sm', href: '/book/request?course=1' }, 'Enroll'))))
  : el('div', { class: 'rv-empty' }, el('p', {}, 'No dates announced yet.'), el('a', { class: 'btn btn-sm', href: '/book/request?course=1' }, 'Ask about the next class')));

// ---------- instructor ----------
$('#c-instructor').replaceChildren(el('div', { class: 'c-instructor' },
  el('div', { class: 'pf-avatar c-avatar', 'aria-hidden': 'true' }, 'IF'),
  el('div', {},
    el('h3', { class: 'pf-name', style: 'font-size:28px' }, 'Iain Findlay'),
    el('div', { class: 'pf-sub' }, 'Recording, mixing and mastering engineer · Los Angeles'),
    stats ? el('div', { class: 'pf-meta' }, el('span', {}, `${stats.totalCount} credits`), stats.certifiedUnits ? el('span', {}, `${Math.round(stats.certifiedUnits / 1e6)}M RIAA certified units`) : null) : null,
    (cfg.featuredArtists || []).length ? el('p', { class: 'c-artists' }, cfg.featuredArtists.slice(0, 8).join(', ')) : null,
    el('div', { class: 'c-links' }, el('a', { href: '/credits' }, 'Credits'), el('a', { href: '/book' }, 'Booking profile')))));

// ---------- location ----------
$('#c-location').replaceChildren(...[
  ['Studio', c.venue], ['City', c.city], ['Address', c.address], ['Parking', c.parking]
].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, val(v))]));
$('#c-gear').replaceChildren((c.gear || []).length ? el('ul', { class: 'c-list' }, c.gear.map(g => el('li', {}, g))) : el('p', { class: 'label', style: 'margin:0' }, el('span', { class: 'tbd' }, 'To be announced')));

// ---------- FAQ and policies ----------
$('#c-faq').replaceChildren(...(c.faq || []).map(f => el('details', {}, el('summary', {}, f.q), el('div', { class: 'ans' }, val(f.a)))));
$('#c-policies').replaceChildren(...(c.policies || []).map(p => el('li', {}, p)));

// ---------- details card ----------
$('#c-details').replaceChildren(...[
  ['Length', c.lengthDays ? `${c.lengthDays} days` : null], ['Location', place || null], ['Class size', c.classSize],
  ['Hours', c.dailyHours], ['Next class', next ? fmtDay(next.start) : null]
].map(([k, v]) => el('li', {}, el('span', {}, k), el('span', {}, val(v)))));
if (Number.isInteger(c.priceCents)) $('#c-price').textContent = money(c.priceCents);
