'use strict';
const path = require('path');
const fs = require('fs');
const { loadEnv } = require('./lib/store');
loadEnv(path.join(__dirname, '.env'));

const express = require('express');
const catalog = require('./lib/catalog');
const booking = require('./lib/booking');
const twitch = require('./lib/twitch');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const PREVIEW_DIR = path.join(__dirname, 'data', 'audio-cache');
const PROFILE_ID = require('./config/studio.json').musoProfileId;
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');

// Stripe needs the raw body to verify signatures, so this route comes before express.json().
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!booking.verifyStripeSignature(raw, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  try {
    res.json(booking.handleStripeEvent(JSON.parse(raw)));
  } catch (err) {
    console.error('[stripe] webhook error', err);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

app.use(express.json({ limit: '64kb' }));

const auth = require('./lib/auth');
const clients = require('./lib/clients');
const requireAdmin = auth.requireAdmin;

// Seller side: /api/admin/* (login, clients, sessions, rate locks, bookings, settings)
app.use('/api/admin', require('./lib/admin-routes'));

// Client side projects: request, thread, proposal, payment (private token links).
app.use('/api/projects', require('./lib/project-routes'));

// Client side: private punch card by secret link. No lookup by email or name.
app.get('/api/card/:token', (req, res) => {
  const card = clients.byCardToken(String(req.params.token));
  if (!card) return res.status(404).json({ error: 'Card not found' });
  res.set('Cache-Control', 'no-store').json(card);
});

// ---------- site config ----------
app.get('/api/config', (req, res) => res.json(booking.publicConfig()));

// ---------- credits ----------
app.get('/api/credits', (req, res) => {
  const { category, q, sort, limit, offset } = req.query;
  res.json(catalog.query({ category, q, sort, limit, offset }));
});
app.get('/api/credits/highlights', (req, res) => res.json({ credits: catalog.highlights(Number(req.query.limit) || 16) }));
app.get('/api/credits/stats', (req, res) => res.json(catalog.stats()));
app.get('/api/credits/status', (req, res) => res.json(catalog.status()));
app.post('/api/credits/sync', requireAdmin, async (req, res) => {
  const result = await catalog.syncMuso({ profileId: PROFILE_ID, force: true });
  catalog.startEnrichment();
  res.status(result.ok ? 200 : 502).json({ ...result, status: catalog.status() });
});

// Same origin audio previews so the Web Audio meters can read the signal.
const { freshPreview } = require('./lib/deezer');
const ALLOWED_PREVIEW_HOSTS = /(^|\.)(itunes\.apple\.com|mzstatic\.com|scdn\.co|dzcdn\.net)$/i;
app.get('/api/preview/:id', async (req, res) => {
  const id = String(req.params.id).replace(/[^a-z0-9-]/gi, '');
  const src = catalog.findPreview(id);
  if (!src) return res.status(404).json({ error: 'No preview for this credit' });
  const cached = req.query.refresh ? null : ['m4a', 'mp3'].map(ext => path.join(PREVIEW_DIR, `${id}.${ext}`)).find(f => fs.existsSync(f));
  try {
    let file = cached;
    if (!file) {
      // Deezer preview links are signed and expire, so look up a fresh one.
      const href = src.startsWith('deezer:') ? await freshPreview(src.slice(7)) : src;
      if (!href) return res.status(404).json({ error: 'Preview no longer available' });
      const url = new URL(href);
      if (url.protocol !== 'https:' || !ALLOWED_PREVIEW_HOSTS.test(url.hostname)) return res.status(400).json({ error: 'Preview host not allowed' });
      const upstream = await fetch(url);
      if (!upstream.ok) return res.status(502).json({ error: `Preview source returned ${upstream.status}` });
      const isMp3 = /mpeg|mp3/.test(upstream.headers.get('content-type') || '') || /\.mp3(\?|$)/.test(url.pathname);
      fs.mkdirSync(PREVIEW_DIR, { recursive: true });
      file = path.join(PREVIEW_DIR, `${id}.${isMp3 ? 'mp3' : 'm4a'}`);
      fs.writeFileSync(file, Buffer.from(await upstream.arrayBuffer()));
    }
    res.set('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.basename(file), { root: PREVIEW_DIR, headers: { 'Content-Type': file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4' } }, err => {
      // A cached file that can't be read is fetched again once.
      if (err && !res.headersSent && cached && !req.query.refresh) return res.redirect(307, `/api/preview/${id}?refresh=1`);
      if (err && !res.headersSent) res.status(502).json({ error: 'Preview unavailable' });
    });
  } catch (err) {
    res.status(502).json({ error: 'Preview unavailable', detail: err.message });
  }
});

// Covers are downloaded once and served from this server, so pages never depend on
// a third party image host being reachable when someone visits.
const COVER_DIR = path.join(__dirname, 'data', 'cover-cache');
const ALLOWED_COVER_HOSTS = /(^|\.)(scdn\.co|mzstatic\.com|dzcdn\.net|tidal\.com)$/i;
async function cacheCover(id, src) {
  const file = path.join(COVER_DIR, `${id}.img`);
  if (fs.existsSync(file)) return file;
  const url = new URL(src);
  if (url.protocol !== 'https:' || !ALLOWED_COVER_HOSTS.test(url.hostname)) throw new Error('Cover host not allowed');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Cover source returned ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 500) throw new Error('Cover too small');
  fs.mkdirSync(COVER_DIR, { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}
app.get('/api/cover/:id', async (req, res) => {
  const id = String(req.params.id).replace(/[^a-z0-9-]/gi, '');
  const src = catalog.findCover(id);
  if (!src) return res.status(404).end();
  if (src.startsWith('/')) return res.redirect(302, src); // a file you placed in public/covers
  try {
    const file = await cacheCover(id, src);
    res.set('Cache-Control', 'public, max-age=2592000');
    res.type(fs.readFileSync(file).subarray(0, 4).toString('hex').startsWith('89504e47') ? 'png' : 'jpg');
    res.sendFile(path.basename(file), { root: COVER_DIR });
  } catch {
    res.redirect(302, src); // fall back to the original host
  }
});
// Download every cover in the background after start, gently.
async function warmCovers() {
  for (const c of catalog.getCatalog().credits) {
    const src = catalog.findCover(c.id);
    if (!src || src.startsWith('/') || fs.existsSync(path.join(COVER_DIR, `${c.id}.img`))) continue;
    try { await cacheCover(c.id, src); } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
}

// ---------- booking ----------
app.post('/api/booking/quote', (req, res) => {
  // Quotes never reveal loyalty status. Eligibility is applied privately at checkout.
  const q = booking.buildQuote(req.body);
  res.json(q);
});
app.post('/api/booking/checkout', async (req, res) => {
  try {
    const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const result = await booking.createCheckout(req.body, origin);
    res.status(result.status).json(result);
  } catch (err) {
    console.error('[checkout]', err.message);
    res.status(502).json({ error: 'Checkout could not be started. Please try again or book through SoundBetter.' });
  }
});
app.post('/api/booking/:id/balance', async (req, res) => {
  try {
    const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const result = await booking.createBalanceCheckout(req.params.id, origin);
    res.status(result.status).json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- twitch ----------
app.get('/api/twitch/status', async (req, res) => {
  const cfg = booking.publicConfig();
  const s = await twitch.status(cfg.twitchChannel);
  res.json({ ...s, canSimulate: !isProd || Boolean(process.env.ALLOW_STREAM_SIMULATION) });
});
app.post('/api/twitch/simulate', (req, res, next) => (isProd && !process.env.ALLOW_STREAM_SIMULATION ? requireAdmin(req, res, next) : next()), async (req, res) => {
  twitch.simulate(req.body || {});
  res.json(await twitch.status(booking.publicConfig().twitchChannel));
});

// ---------- pages ----------
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: isProd ? '1h' : 0 }));
app.get('/credits', (req, res) => res.sendFile('credits.html', { root: PUBLIC }));
app.get('/terms', (req, res) => res.sendFile('terms.html', { root: PUBLIC }));
app.get('/admin', (req, res) => res.set('X-Robots-Tag', 'noindex').sendFile('admin.html', { root: PUBLIC }));
app.get('/project/:token', (req, res) => res.set('X-Robots-Tag', 'noindex').set('Referrer-Policy', 'no-referrer').sendFile('project.html', { root: PUBLIC }));
app.get('/card/:token', (req, res) => res.set('X-Robots-Tag', 'noindex').sendFile('card.html', { root: PUBLIC }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.status(404).sendFile('index.html', { root: PUBLIC }));

app.listen(PORT, () => {
  console.log(`Iain Findlay site running on http://localhost:${PORT}`);
  catalog.syncMuso({ profileId: PROFILE_ID }).finally(() => catalog.startEnrichment());
  const streams = require('./lib/streams');
  const checkStreams = () => streams.refresh({ credits: catalog.getCatalog().credits }).catch(err => console.warn('[streams]', err.message));
  setTimeout(checkStreams, 5000);
  setTimeout(() => warmCovers().catch(() => {}), 3000);
  setInterval(checkStreams, 6 * 60 * 60 * 1000).unref();
  setInterval(() => catalog.syncMuso({ profileId: PROFILE_ID }), 6 * 60 * 60 * 1000).unref();
});
