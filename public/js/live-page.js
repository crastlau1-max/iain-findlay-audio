import { api } from './lib.js?v=5';
import { initNav } from './nav.js?v=5';
import { mountLive } from './live.js?v=5';

initNav();
const cfg = await api('/api/config');
mountLive(cfg.twitchChannel);
