// Studio Live: the Twitch player is always on the page. When the channel is offline,
// Twitch shows its own offline screen and past broadcasts.
import { $, api } from './lib.js';
import { onStatus, refreshStatus, renderPill } from './nav.js';

export function mountLive(channel) {
  const screen = $('#live-screen');
  const meta = $('#live-meta-text');
  const toggle = $('#sim-toggle');
  const toggleWrap = $('#sim-wrap');
  const parent = location.hostname || 'localhost';
  const frame = document.createElement('iframe');
  frame.src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&muted=true&autoplay=false`;
  frame.title = `twitch.tv/${channel}`;
  frame.allow = 'autoplay; fullscreen';
  frame.allowFullscreen = true;
  frame.loading = 'lazy';
  screen.append(frame);

  onStatus(s => {
    meta.textContent = s.live ? (s.title ? `On air now: ${s.title}` : 'On air now') : `twitch.tv/${channel}`;
    toggleWrap.hidden = !(s.canSimulate && new URLSearchParams(location.search).has('demo'));
    toggle.checked = Boolean(s.live && s.source === 'simulated');
  });
  toggle.addEventListener('change', async () => {
    try { const s = await api('/api/twitch/simulate', { method: 'POST', body: { live: toggle.checked } }); renderPill(s); refreshStatus(); }
    catch { toggle.checked = !toggle.checked; }
  });
}
