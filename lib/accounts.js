'use strict';
// Client accounts: email and password (scrypt), a signed session cookie,
// and one-time links for email verification and password reset.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./store');
const { sign } = require('./auth');

const FILE = process.env.ACCOUNTS_FILE || path.join(__dirname, '..', 'data', 'accounts.json');
const COOKIE = 'if_user';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const TOKEN_TTL = { verify: 7 * 24 * 60 * 60 * 1000, reset: 60 * 60 * 1000 };

const now = () => new Date().toISOString();
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const normEmail = e => clean(e, 160).toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const load = () => { const d = readJson(FILE, { users: {}, tokens: {} }); d.users ||= {}; d.tokens ||= {}; return d; };
const save = d => writeJson(FILE, d);

// ---------- passwords ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [, salt, key] = String(stored || '').split('$');
  if (!salt || !key) { crypto.scryptSync(pw, 'dummy-salt', 64); return false; }
  const want = Buffer.from(key, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(got, want);
}
function validPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw err('Use at least 8 characters for your password.');
  if (pw.length > 200) throw err('That password is too long.');
}

// ---------- users ----------
const publicUser = u => u && { id: u.id, email: u.email, name: u.name, artist: u.artist, verified: Boolean(u.verifiedAt), createdAt: u.createdAt };
const findByEmail = (d, email) => Object.values(d.users).find(u => u.email === email) || null;

function getUser(id) { return load().users[id] || null; }

function createUser({ email, password, name, artist }) {
  email = normEmail(email);
  if (!validEmail(email)) throw err('Enter a valid email address.');
  validPassword(password);
  const d = load();
  if (findByEmail(d, email)) throw err('An account with this email already exists. Sign in instead.', 409);
  const u = {
    id: `usr_${crypto.randomBytes(8).toString('hex')}`, email, name: clean(name, 120), artist: clean(artist, 120),
    passwordHash: hashPassword(password), createdAt: now(), verifiedAt: null, sessionVersion: 1
  };
  d.users[u.id] = u; save(d);
  return u;
}

function authenticate(email, password) {
  const u = findByEmail(load(), normEmail(email));
  const ok = checkPassword(String(password || ''), u?.passwordHash);
  return ok ? u : null;
}

function updateProfile(id, { name, artist }) {
  const d = load(); const u = d.users[id];
  if (!u) throw err('Account not found', 404);
  if (name !== undefined) u.name = clean(name, 120);
  if (artist !== undefined) u.artist = clean(artist, 120);
  save(d); return u;
}

function changePassword(id, current, next) {
  const d = load(); const u = d.users[id];
  if (!u) throw err('Account not found', 404);
  if (!checkPassword(String(current || ''), u.passwordHash)) throw err('Your current password is wrong.');
  validPassword(next);
  u.passwordHash = hashPassword(next); u.sessionVersion += 1;
  save(d); return u;
}

// ---------- one-time links ----------
function issueToken(userId, kind) {
  const d = load();
  for (const [k, t] of Object.entries(d.tokens)) if (t.exp < Date.now() || (t.userId === userId && t.kind === kind)) delete d.tokens[k];
  const raw = crypto.randomBytes(24).toString('base64url');
  d.tokens[sha(raw)] = { userId, kind, exp: Date.now() + TOKEN_TTL[kind] };
  save(d); return raw;
}
function takeToken(d, raw, kind) {
  const key = sha(raw || '');
  const t = d.tokens[key];
  if (!t || t.kind !== kind || t.exp < Date.now() || !d.users[t.userId]) return null;
  delete d.tokens[key];
  return d.users[t.userId];
}
function verifyEmail(raw) {
  const d = load();
  const u = takeToken(d, raw, 'verify');
  if (!u) throw err('This link has expired or was already used.');
  u.verifiedAt ||= now(); save(d); return u;
}
function resetPassword(raw, next) {
  validPassword(next);
  const d = load();
  const u = takeToken(d, raw, 'reset');
  if (!u) throw err('This reset link has expired or was already used. Ask for a new one.');
  u.passwordHash = hashPassword(next); u.sessionVersion += 1;
  u.verifiedAt ||= now(); // they proved they own the inbox
  save(d); return u;
}
function userForReset(email) { return findByEmail(load(), normEmail(email)); }

// ---------- sessions ----------
function readCookie(req) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}
function startSession(res, u) {
  const exp = Date.now() + SESSION_TTL;
  const body = `${u.id}.${u.sessionVersion}.${exp}`;
  setCookie(res, `${body}.${sign(`user:${body}`)}`, SESSION_TTL);
}
function endSession(res) { setCookie(res, '', 0); }
function setCookie(res, value, maxAgeMs) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}
function currentUser(req) {
  const v = readCookie(req);
  if (!v) return null;
  const parts = v.split('.');
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  const want = sign(`user:${id}.${ver}.${exp}`);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const u = getUser(id);
  return u && String(u.sessionVersion) === ver ? u : null;
}

module.exports = {
  createUser, authenticate, getUser, updateProfile, changePassword, publicUser,
  issueToken, verifyEmail, resetPassword, userForReset,
  startSession, endSession, currentUser, validEmail
};
