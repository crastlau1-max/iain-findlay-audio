import { api } from './lib.js';
import { initNav } from './nav.js';
import { mountLive } from './live.js';

initNav();
const cfg = await api('/api/config');
mountLive(cfg.twitchChannel);
