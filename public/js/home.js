// Old one-page anchors now have their own pages.
const moved = { '#book': '/book', '#loyalty': '/book#loyalty', '#course': '/course', '#live': '/live', '#work': '/credits' };
if (moved[location.hash]) location.replace(moved[location.hash].replace(/(#.*)?$/, m => location.search + m));

import { $, el, api, icons, artwork, badges } from './lib.js?v=5';
import * as player from './player.js?v=5';
import { initNav } from './nav.js?v=5';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

initNav();

const [cfg, stats, hl] = await Promise.all([
  api('/api/config'),
  api('/api/credits/stats'),
  api('/api/credits/highlights?limit=24')
]);
window.__musoUrl = cfg.musoProfileUrl;
if (cfg.heroImage) { const hi = $('.hero-photo img'); if (hi && !hi.src.endsWith(cfg.heroImage)) hi.src = cfg.heroImage; }

// ---------- hero plaques: rotate through the most popular records, one release per tile ----------
// The wall always opens on the original six (strongest certification leads, one record per artist),
// then rotates through the most popular releases on Muso.
function pickPlaques(list, n) {
  const out = [], seen = new Set();
  for (const c of list) { const k = c.artist.split(',')[0]; if (!seen.has(k)) { seen.add(k); out.push(c); } if (out.length === n) return out; }
  for (const c of list) { if (!out.includes(c)) out.push(c); if (out.length === n) break; }
  return out;
}
const opening = pickPlaques(hl.credits, 6);
const top = await api('/api/credits?sort=popularity&limit=60');
const pool = [...opening];
{
  const seenArt = new Set(opening.map(c => c.artworkUrl || c.id));
  for (const c of top.credits) {
    const key = c.artworkUrl || `${c.artist}|${c.album}`;
    if (seenArt.has(key)) continue;
    seenArt.add(key); pool.push(c);
    if (pool.length === 20) break;
  }
}
const leadPool = [opening[0], ...pool.filter(c => c !== opening[0] && (c.certifications?.riaa || c.certifications?.grammy))].slice(0, 6);
const wall = $('#plaques');
const tiles = [];

function face(c, kind) {
  return el('div', { class: 'face' },
    artwork(c.artworkUrl, c.album ? `${c.album} cover` : ''),
    badges(c, { max: kind === 'lead' ? 2 : 1 }),
    el('div', { class: 'meta' }, el('div', { class: 't' }, c.title.replace(/\s*\((feat|with)\.?[^)]*\)/i, '')), el('div', { class: 'a' }, `${c.artist} · ${c.year}`)),
    el('span', { class: 'play-hint', html: icons.play }));
}
function setTile(tile, c, animate) {
  tile._credit = c;
  tile.dataset.id = c.id;
  tile.setAttribute('aria-label', `Play ${c.title} by ${c.artist}`);
  const next = face(c, tile._kind);
  const old = tile.querySelector('.face');
  if (!animate || !old) { tile.replaceChildren(next); return; }
  next.classList.add('entering');
  tile.append(next);
  requestAnimationFrame(() => requestAnimationFrame(() => { next.classList.remove('entering'); old.classList.add('leaving'); }));
  setTimeout(() => old.remove(), 900);
}
const first = opening;
first.forEach((c, i) => {
  const kind = i === 0 ? 'lead' : i < 3 ? 'side' : 'small';
  const tile = el('button', { class: `plaque ${kind}`, type: 'button' });
  tile._kind = kind;
  tile.addEventListener('click', () => player.play(tile._credit));
  setTile(tile, c, false);
  tiles.push(tile);
  wall.append(tile);
});

// Swap one tile at a time. Pauses on hover, while a hero record plays, and when the tab is hidden.
let paused = false, step = 0;
wall.addEventListener('mouseenter', () => paused = true);
wall.addEventListener('mouseleave', () => paused = false);
wall.addEventListener('focusin', () => paused = true);
wall.addEventListener('focusout', () => paused = false);
const playingHere = () => { const { id, playing } = player.current(); return playing && tiles.some(t => t.dataset.id === id); };
function rotate() {
  if (paused || document.hidden || playingHere()) return;
  const visible = new Set(tiles.map(t => t._credit.id));
  step++;
  const useLead = step % 4 === 0 && leadPool.length > 1;
  const tile = useLead ? tiles[0] : tiles[1 + ((step - 1) % (tiles.length - 1))];
  const source = useLead ? leadPool : pool;
  const start = source.indexOf(tile._credit);
  for (let k = 1; k <= source.length; k++) {
    const c = source[(Math.max(start, 0) + k) % source.length];
    if (!visible.has(c.id)) { setTile(tile, c, true); break; }
  }
}
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(rotate, 4200);

player.onChange(({ id, playing }) => {
  tiles.forEach(p => {
    const on = playing && p.dataset.id === id;
    p.classList.toggle('is-playing', on);
    p.querySelectorAll('.play-hint').forEach(h => h.innerHTML = on ? icons.pause : icons.play);
  });
});
$('#hear-btn').addEventListener('click', () => player.play(tiles[0]._credit));

// ---------- metrics: count up on load; streams keep ticking at a conservative rate ----------
const fmtInt = n => Math.floor(n).toLocaleString('en-US');
const streamsNow = () => stats.spotifyStreams;
const metrics = [
  ...(stats.spotifyStreams ? [{ k: 'Streams', ticker: true }] : []),
  { v: stats.totalCount, k: 'Credits' },
  ...(stats.certifiedUnits ? [{ v: stats.certifiedUnits / 1e6, k: 'RIAA certified units', suffix: 'M' }] : [{ v: stats.certifiedCount, k: 'RIAA certified records' }]),
  { v: stats.artistCount, k: 'Artists' },
  { v: new Date().getFullYear() - stats.firstYear, k: 'Years of credits' }
].slice(0, 5);
const metricEls = metrics.map(m => {
  const v = el('div', { class: `v${m.ticker ? ' ticker' : ''}` });
  return { m, v, node: el('div', { class: 'metric' }, v, el('div', { class: 'k' }, m.k)) };
});
$('#metrics').replaceChildren(...metricEls.map(x => x.node));
function paint(x, t) {
  const { m, v } = x;
  if (m.ticker) v.textContent = `${fmtInt(streamsNow() * t)}+`;
  else if (m.plain) v.textContent = String(m.v);
  else v.textContent = `${Math.round(m.v * t)}${m.suffix || ''}`;
}
const ease = t => 1 - Math.pow(1 - t, 3);
if (reduceMotion) metricEls.forEach(x => paint(x, 1));
else {
  const t0 = performance.now(), dur = 1600;
  (function step(now) {
    const t = Math.min(1, (now - t0) / dur);
    metricEls.forEach(x => paint(x, ease(t)));
    if (t < 1) requestAnimationFrame(step);
  })(t0);
}
// The stream total is the last verified sum; the server re-checks it daily.

// ---------- plaque lighting ----------
if (!reduceMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  wall.addEventListener('pointermove', e => {
    const p = e.target.closest('.plaque'); if (!p) return;
    const r = p.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    p.style.setProperty('--mx', `${x * 100}%`); p.style.setProperty('--my', `${y * 100}%`);
    const k = p.classList.contains('lead') ? 3 : 5;
    p.style.setProperty('--ry', `${(x - .5) * k}deg`); p.style.setProperty('--rx', `${(.5 - y) * k}deg`);
  });
  wall.addEventListener('pointerout', e => {
    const p = e.target.closest('.plaque'); if (!p || p.contains(e.relatedTarget)) return;
    p.style.setProperty('--rx', '0deg'); p.style.setProperty('--ry', '0deg');
  });
}

// ---------- services ----------
$('#svc-cards').replaceChildren(...cfg.services.map(sv => el('a', { class: 'card', href: '/book' },
  el('h3', { class: 'h3' }, sv.name), el('span', { class: 'more' }, 'Request a quote'))));
document.querySelectorAll('[data-soundbetter]').forEach(a => a.href = cfg.soundbetterUrl);
