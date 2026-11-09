// Navbar: live status pill (fixed slot, never shifts) and mobile menu.
import { $, api } from './lib.js';

const subscribers = new Set();
let last = null;

function compact(n) {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function renderPill(s) {
  const pill = $('#status-pill');
  if (!pill) return;
  const live = Boolean(s && s.live);
  pill.classList.toggle('is-live', live);
  pill.querySelector('.txt').textContent = live ? `Live • ${compact(s.viewers || 0)}` : 'Off-Air';
  pill.title = live ? `Streaming now on twitch.tv/${s.channel}` : 'Not streaming right now';
  pill.setAttribute('aria-label', live ? `Live on Twitch now, ${s.viewers} viewers. Opens the stream` : '');
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

export function initNav() {
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
