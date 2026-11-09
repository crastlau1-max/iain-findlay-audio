'use strict';
// Client ledger and loyalty engine.
// Every client is keyed by billing email. A client has sessions (direct bookings recorded
// automatically, plus SoundBetter or manual sessions you add) and rate locks.
// Every N counted sessions unlocks a rate lock window; locks can also be granted by hand.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./store');

const ROOT = path.join(__dirname, '..');
const FILE = process.env.CLIENTS_FILE || path.join(ROOT, 'data', 'clients.json');
const CONFIG = path.join(ROOT, 'config', 'studio.json');
const DAY = 24 * 60 * 60 * 1000;
const SOURCES = ['direct', 'soundbetter', 'manual'];

const norm = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const id = p => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const loyaltyCfg = () => ({ bookingsRequired: 10, windowDays: 30, projectLimit: 3, discountPercent: 25, ...(readJson(CONFIG, {}).loyalty || {}) });

function load() {
  const db = readJson(FILE, { clients: {} });
  if (!db.clients) db.clients = {};
  // Upgrade records from the first version of the site.
  for (const [key, c] of Object.entries(db.clients)) {
    if (!c.sessions) {
      db.clients[key] = {
        email: key, name: c.name || '', notes: '', createdAt: new Date().toISOString(),
        cardToken: crypto.randomBytes(18).toString('base64url'),
        sessions: (c.history || []).map(h => ({ id: id('ses'), date: (h.completedAt || '').slice(0, 10), title: h.trackTitle || 'Direct booking', source: 'direct', amountCents: h.totalCents || null, counts: true, bookingId: h.bookingId || null })),
        rateLocks: c.rateLock ? [{ id: id('lock'), milestone: 1, unlockedAt: c.rateLock.unlockedAt, expiresAt: c.rateLock.expiresAt, total: c.rateLock.remaining, used: 0, discountPercent: c.rateLock.discountPercent || 25, manual: false }] : []
      };
    }
  }
  return db;
}
const save = db => writeJson(FILE, db);

function blank(email, name = '') {
  return { email, name, notes: '', createdAt: new Date().toISOString(), cardToken: crypto.randomBytes(18).toString('base64url'), sessions: [], rateLocks: [] };
}

function lockState(l, now = Date.now()) {
  if (l.revokedAt) return 'revoked';
  if (now >= Date.parse(l.expiresAt)) return 'expired';
  if (l.used >= l.total) return 'used';
  return 'active';
}

// Derived view used by admin, the client card and checkout.
function summarize(c, now = Date.now()) {
  const cfg = loyaltyCfg();
  const counted = c.sessions.filter(s => s.counts).length;
  const active = c.rateLocks.find(l => lockState(l, now) === 'active') || null;
  const sorted = [...c.sessions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    email: c.email,
    name: c.name,
    notes: c.notes,
    createdAt: c.createdAt,
    cardToken: c.cardToken,
    totalSessions: c.sessions.length,
    countedSessions: counted,
    punches: counted % cfg.bookingsRequired,
    bookingsRequired: cfg.bookingsRequired,
    windowsEarned: Math.floor(counted / cfg.bookingsRequired),
    totalSpentCents: c.sessions.reduce((s, x) => s + (Number.isInteger(x.amountCents) ? x.amountCents : 0), 0),
    lastSession: sorted[0]?.date || null,
    activeLock: active ? { ...active, remaining: active.total - active.used } : null,
    sessions: sorted,
    rateLocks: c.rateLocks.map(l => ({ ...l, state: lockState(l, now) }))
  };
}

// When counted sessions reach a new multiple of the requirement, open a new window.
function applyMilestones(c, now = Date.now()) {
  const cfg = loyaltyCfg();
  const counted = c.sessions.filter(s => s.counts).length;
  const earned = Math.floor(counted / cfg.bookingsRequired);
  const reached = new Set(c.rateLocks.filter(l => !l.manual).map(l => l.milestone));
  for (let m = 1; m <= earned; m++) {
    if (reached.has(m)) continue;
    // Only the newest milestone opens a live window; older ones (from back-filled history) are marked used.
    const isNewest = m === earned;
    c.rateLocks.push({
      id: id('lock'), milestone: m, manual: false,
      unlockedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + cfg.windowDays * DAY).toISOString(),
      total: cfg.projectLimit, used: isNewest ? 0 : cfg.projectLimit,
      discountPercent: cfg.discountPercent,
      note: isNewest ? '' : 'Earned on back filled history, closed automatically'
    });
  }
}

function get(email) {
  const c = load().clients[norm(email)];
  return c ? summarize(c) : null;
}

function list(q = '') {
  const needle = norm(q);
  return Object.values(load().clients)
    .filter(c => !needle || c.email.includes(needle) || (c.name || '').toLowerCase().includes(needle))
    .map(c => { const s = summarize(c); delete s.sessions; return s; })
    .sort((a, b) => String(b.lastSession || b.createdAt).localeCompare(String(a.lastSession || a.createdAt)));
}

function mutate(email, fn, { create = false, name = '' } = {}) {
  const db = load();
  const key = norm(email);
  if (!db.clients[key]) {
    if (!create) { const e = new Error('Client not found'); e.status = 404; throw e; }
    if (!validEmail(key)) { const e = new Error('Enter a valid email'); e.status = 400; throw e; }
    db.clients[key] = blank(key, name);
  }
  const c = db.clients[key];
  const result = fn(c);
  save(db);
  return result === undefined ? summarize(c) : result;
}

function createClient({ email, name }) {
  const key = norm(email);
  if (load().clients[key]) { const e = new Error('A client with that email already exists'); e.status = 409; throw e; }
  return mutate(key, () => {}, { create: true, name: String(name || '').slice(0, 120) });
}

function updateClient(email, patch) {
  const newEmail = patch.email != null ? norm(patch.email) : null;
  const db = load();
  const key = norm(email);
  const c = db.clients[key];
  if (!c) { const e = new Error('Client not found'); e.status = 404; throw e; }
  if (patch.name != null) c.name = String(patch.name).slice(0, 120);
  if (patch.notes != null) c.notes = String(patch.notes).slice(0, 4000);
  if (newEmail && newEmail !== key) {
    if (!validEmail(newEmail)) { const e = new Error('Enter a valid email'); e.status = 400; throw e; }
    if (db.clients[newEmail]) { const e = new Error('Another client already uses that email'); e.status = 409; throw e; }
    c.email = newEmail;
    db.clients[newEmail] = c;
    delete db.clients[key];
  }
  save(db);
  return summarize(c);
}

function addSession(email, input, opts = {}) {
  const source = SOURCES.includes(input.source) ? input.source : 'manual';
  const session = {
    id: id('ses'),
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : new Date().toISOString().slice(0, 10),
    title: String(input.title || (source === 'soundbetter' ? 'SoundBetter session' : 'Session')).slice(0, 160),
    source,
    amountCents: Number.isInteger(input.amountCents) && input.amountCents >= 0 ? input.amountCents : null,
    counts: input.counts !== false,
    bookingId: input.bookingId || null,
    usedLockId: input.usedLockId || null,
    addedAt: new Date().toISOString()
  };
  return mutate(email, c => {
    if (session.bookingId && c.sessions.some(s => s.bookingId === session.bookingId)) return; // webhook retries
    c.sessions.push(session);
    if (session.usedLockId) {
      const lock = c.rateLocks.find(l => l.id === session.usedLockId);
      if (lock) lock.used = Math.min(lock.total, lock.used + 1);
    }
    applyMilestones(c);
  }, { create: true, name: opts.name || '' });
}

function updateSession(email, sid, patch) {
  return mutate(email, c => {
    const s = c.sessions.find(x => x.id === sid);
    if (!s) { const e = new Error('Session not found'); e.status = 404; throw e; }
    if (patch.title != null) s.title = String(patch.title).slice(0, 160);
    if (patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) s.date = patch.date;
    if (patch.source && SOURCES.includes(patch.source)) s.source = patch.source;
    if (patch.amountCents === null || (Number.isInteger(patch.amountCents) && patch.amountCents >= 0)) s.amountCents = patch.amountCents;
    if (typeof patch.counts === 'boolean') s.counts = patch.counts;
    applyMilestones(c);
  });
}

function removeSession(email, sid) {
  return mutate(email, c => {
    const i = c.sessions.findIndex(x => x.id === sid);
    if (i < 0) { const e = new Error('Session not found'); e.status = 404; throw e; }
    const [s] = c.sessions.splice(i, 1);
    if (s.usedLockId) {
      const lock = c.rateLocks.find(l => l.id === s.usedLockId);
      if (lock) lock.used = Math.max(0, lock.used - 1);
    }
    // Existing windows stay as they are; revoke one by hand if it should no longer apply.
  });
}

function grantLock(email, input = {}) {
  const cfg = loyaltyCfg();
  return mutate(email, c => {
    const now = Date.now();
    c.rateLocks.push({
      id: id('lock'), milestone: null, manual: true,
      unlockedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (Number(input.days) || cfg.windowDays) * DAY).toISOString(),
      total: Math.max(1, Math.min(20, Number(input.total) || cfg.projectLimit)), used: 0,
      discountPercent: Math.max(1, Math.min(100, Number(input.discountPercent) || cfg.discountPercent)),
      note: String(input.note || 'Granted by hand').slice(0, 200)
    });
  });
}

function updateLock(email, lid, patch) {
  return mutate(email, c => {
    const l = c.rateLocks.find(x => x.id === lid);
    if (!l) { const e = new Error('Rate lock not found'); e.status = 404; throw e; }
    if (patch.expiresAt && !Number.isNaN(Date.parse(patch.expiresAt))) l.expiresAt = new Date(patch.expiresAt).toISOString();
    if (Number.isInteger(patch.total)) l.total = Math.max(0, Math.min(20, patch.total));
    if (Number.isInteger(patch.used)) l.used = Math.max(0, Math.min(l.total, patch.used));
    if (Number.isInteger(patch.discountPercent)) l.discountPercent = Math.max(1, Math.min(100, patch.discountPercent));
    if (patch.revoke === true) l.revokedAt = new Date().toISOString();
    if (patch.revoke === false) delete l.revokedAt;
  });
}

function regenerateCard(email) {
  return mutate(email, c => { c.cardToken = crypto.randomBytes(18).toString('base64url'); });
}

function deleteClient(email) {
  const db = load();
  const key = norm(email);
  if (!db.clients[key]) { const e = new Error('Client not found'); e.status = 404; throw e; }
  delete db.clients[key];
  save(db);
  return { ok: true };
}

// Private client view by card token. Shows progress only, never other clients.
function byCardToken(token) {
  if (!token || token.length < 20) return null;
  const c = Object.values(load().clients).find(x => x.cardToken === token);
  if (!c) return null;
  const s = summarize(c);
  return {
    name: s.name,
    punches: s.punches,
    bookingsRequired: s.bookingsRequired,
    countedSessions: s.countedSessions,
    activeLock: s.activeLock ? { expiresAt: s.activeLock.expiresAt, remaining: s.activeLock.remaining, discountPercent: s.activeLock.discountPercent } : null,
    recent: s.sessions.filter(x => x.counts).slice(0, 12).map(x => ({ date: x.date, title: x.title }))
  };
}

// Used at checkout: active lock for an email, or null.
function activeRateLock(email, now = Date.now()) {
  const c = load().clients[norm(email)];
  if (!c) return null;
  const l = c.rateLocks.find(x => lockState(x, now) === 'active');
  return l ? { id: l.id, expiresAt: l.expiresAt, remaining: l.total - l.used, discountPercent: l.discountPercent } : null;
}

// Called when a direct booking is paid in full.
function recordDirectBooking(b) {
  return addSession(b.email, {
    date: new Date().toISOString().slice(0, 10),
    title: b.project || `${(b.services || []).map(s => s[0].toUpperCase() + s.slice(1)).join(' + ')}${b.songs ? `, ${b.songs} song${b.songs > 1 ? 's' : ''}` : ''}`,
    source: 'direct',
    amountCents: b.totalCents,
    counts: true,
    bookingId: b.id,
    usedLockId: b.loyaltyLockId || null
  }, { name: b.name });
}

function stats() {
  const all = Object.values(load().clients).map(c => summarize(c));
  return {
    clients: all.length,
    activeLocks: all.filter(c => c.activeLock).length,
    closeToReward: all.filter(c => c.punches >= c.bookingsRequired - 2).length,
    sessions: all.reduce((s, c) => s + c.totalSessions, 0)
  };
}

module.exports = { list, get, createClient, updateClient, deleteClient, addSession, updateSession, removeSession, grantLock, updateLock, regenerateCard, byCardToken, activeRateLock, recordDirectBooking, stats, SOURCES };
