// Navbar: live status pill (fixed slot, never shifts) and mobile menu.
import { $, api } from './lib.js';

const subscribers = new Set();
let last = null;

export function renderPill(s) {
  const pill = $('#status-pill');
  if (!pill) return;
  const live = Boolean(s && s.live);
  pill.classList.toggle('is-live', live);
  pill.querySelector('.txt').textContent = live ? 'Live' : 'Off-Air';
  pill.title = live ? `Streaming now on twitch.tv/${s.channel}` : 'Not streaming right now';
  pill.setAttribute('aria-label', live ? 'Live on Twitch now. Opens the stream' : '');
  pill.setAttribute('aria-hidden', String(!live));
  pill.tabIndex = live ? 0 : -1;
  if (s && s.channel) pill.href = `https://www.twitch.tv/${s.channel}`;
}

export async function refreshStatus() {
  try {
    last = await api('/api/twitch/status');
    renderPill(last);
    subscribers.forEach(fn => fn(last));
  } catch { /* keep the previous state */ }
  return last;
}

export function onStatus(fn) { subscribers.add(fn); if (last) fn(last); }

// Signed in user, shared by every page. Resolves to null when signed out.
let mePromise = null;
export function me() {
  mePromise ||= api('/api/account/me').then(r => r.user).catch(() => null);
  return mePromise;
}

function accountLinks(user) {
  const label = user ? 'Account' : 'Sign in';
  const href = user ? '/account' : `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;
  const right = $('.nav-right');
  if (right && !$('#nav-acct')) {
    const a = document.createElement('a');
    a.id = 'nav-acct'; a.className = 'nav-acct'; a.href = href; a.textContent = label;
    if (location.pathname === '/account' || location.pathname === '/signin') a.setAttribute('aria-current', 'page');
    right.insertBefore(a, $('.nav-book', right) || right.firstChild);
  }
  const menu = $('#mobile-menu');
  if (menu && !$('#menu-acct')) {
    const a = document.createElement('a');
    a.id = 'menu-acct'; a.href = href; a.textContent = label;
    menu.append(a);
  }
}

function attachCounters(root = document) {
  root.querySelectorAll('textarea[maxlength]:not([data-counted])').forEach(t => {
    t.dataset.counted = '1';
    const max = Number(t.getAttribute('maxlength'));
    const c = document.createElement('div');
    c.className = 'char-count'; c.setAttribute('aria-live', 'polite');
    const paint = () => { c.textContent = `${t.value.length.toLocaleString()} / ${max.toLocaleString()}`; c.classList.toggle('near', t.value.length > max * 0.9); };
    t.addEventListener('input', paint);
    t.after(c); paint();
  });
}

export function initNav() {
  me().then(accountLinks);
  attachCounters();
  new MutationObserver(() => attachCounters()).observe(document.body, { childList: true, subtree: true });
  const btn = $('#menu-btn');
  const menu = $('#mobile-menu');
  if (btn && menu) {
    btn.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', e => { if (e.target.closest('a')) { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  }
  refreshStatus();
  setInterval(refreshStatus, 60000);
}
