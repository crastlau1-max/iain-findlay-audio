// Shared helpers for every page.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status, body: json });
  return json;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

export const icons = {
  play: '<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8v10.4c0 .5.6.8 1 .5l8-5.2a.6.6 0 000-1L5.5 2.3c-.4-.3-1 0-1 .5z"/></svg>',
  pause: '<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx=".6"/><rect x="9.5" y="2.5" width="3" height="11" rx=".6"/></svg>',
  check: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  search: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  close: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  out: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3H3.5v9.5H13V10M9 3h4v4M13 3L7.5 8.5"/></svg>',
  lock: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>',
  menu: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 4.5h12M2 8h12M2 11.5h12"/></svg>',
  disc: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="6" cy="6" r="5"/><circle cx="6" cy="6" r="1.4"/></svg>',
  grammy: '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M6 1.2a3.6 3.6 0 00-3.4 2.4l2.9 3V10H4v.8h4V10H6.5V6.6l2.9-3A3.6 3.6 0 006 1.2z"/></svg>'
};

const VINYL = '/assets/vinyl.svg';

// Artwork with an automatic vinyl fallback on missing art or load errors.
export function artwork(url, alt = '') {
  const box = el('div', { class: 'art' });
  const img = el('img', { alt, loading: 'lazy', decoding: 'async', draggable: 'false' });
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    if (img.dataset.fallback) return;
    img.dataset.fallback = '1';
    box.classList.add('is-vinyl');
    img.src = VINYL;
  });
  if (url) img.src = url;
  else { box.classList.add('is-vinyl'); img.dataset.fallback = '1'; img.src = VINYL; }
  box.append(img);
  return box;
}

export function badges(credit, { max = 2 } = {}) {
  const wrap = el('div', { class: 'badges' });
  const c = credit.certifications || {};
  if (c.riaa) wrap.append(el('span', { class: `badge${/diamond/i.test(c.riaa) ? ' diamond' : ''}`, html: `${icons.disc}${c.riaa}` }));
  if (c.grammy && wrap.children.length < max) wrap.append(el('span', { class: 'badge grammy', title: c.grammy.detail || '', html: `${icons.grammy}${c.grammy.status}` }));
  return wrap;
}

export function money(cents) {
  if (!Number.isInteger(cents)) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

let toastTimer;
export function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

export function reveal() {
  const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach(n => io.observe(n));
}

// In page anchors: smooth scroll to the target. If content above it grows while scrolling,
// glide again once the motion stops, never jump mid animation.
export function stableAnchors() {
  const navH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 68;
  let target = null, until = 0, lastY = -1, still = 0, raf = 0;
  const cancel = () => { target = null; };
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => window.addEventListener(ev, cancel, { passive: true }));
  const y = el => Math.max(0, Math.min(el.getBoundingClientRect().top + window.scrollY - navH() - 16, document.documentElement.scrollHeight - innerHeight));
  function watch() {
    raf = 0;
    if (!target || performance.now() > until) { target = null; return; }
    const sy = window.scrollY;
    still = Math.abs(sy - lastY) < 0.5 ? still + 1 : 0;
    lastY = sy;
    if (still > 6) { // stopped for ~100ms
      const want = y(target);
      if (Math.abs(sy - want) > 3) { still = 0; window.scrollTo({ top: want, behavior: 'smooth' }); }
    }
    raf = requestAnimationFrame(watch);
  }
  function go(hash, smooth) {
    const el = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return false;
    target = el; until = performance.now() + 3000; lastY = -1; still = 0;
    window.scrollTo({ top: y(el), behavior: smooth ? 'smooth' : 'instant' });
    if (!raf) raf = requestAnimationFrame(watch);
    return true;
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href*="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    const url = new URL(a.href, location.href);
    if (url.pathname !== location.pathname || !url.hash || a.target) return;
    if (go(url.hash, true)) { e.preventDefault(); history.pushState(null, '', url.hash); }
  });
  if (location.hash) go(location.hash, false);
}
