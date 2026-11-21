import { $, api } from './lib.js?v=5';
import { initNav } from './nav.js?v=5';
import { mountConsole, syncLine } from './discography.js?v=5';

initNav();
const cfg = await api('/api/config');
window.__musoUrl = cfg.musoProfileUrl;
const root = $('#console');
root.addEventListener('catalog', e => {
  $('#sync-note').innerHTML = syncLine(e.detail, cfg.musoProfileUrl);
  $('#count').textContent = e.detail.totalCount;
}, { once: true });
mountConsole(root, { bounded: false, perPage: 50 });
