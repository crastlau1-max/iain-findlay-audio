'use strict';
// Single owner admin login: ADMIN_PASSWORD from .env, signed httpOnly session cookie.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const COOKIE = 'if_admin';
const TTL = 12 * 60 * 60 * 1000;
const attempts = new Map();

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(__dirname, '..', 'data', '.session-secret');
  try { return fs.readFileSync(file, 'utf8'); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const sign = v => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
const hash = v => crypto.createHash('sha256').update(String(v)).digest();

function readCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}

function isAdmin(req) {
  const v = readCookie(req);
  if (!v) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

function setCookie(res, value, maxAgeMs) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}

function login(req, res) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(503).json({ error: 'Set ADMIN_PASSWORD in your .env file, then restart the server.' });
  const ip = req.ip || 'local';
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const ok = crypto.timingSafeEqual(hash(req.body?.password || ''), hash(pw));
  if (!ok) {
    a.n += 1;
    if (a.n >= 8) { a.until = Date.now() + 15 * 60 * 1000; a.n = 0; }
    attempts.set(ip, a);
    return res.status(401).json({ error: 'Wrong password' });
  }
  attempts.delete(ip);
  const exp = String(Date.now() + TTL);
  setCookie(res, `${exp}.${sign(exp)}`, TTL);
  res.json({ ok: true });
}

function logout(req, res) {
  setCookie(res, '', 0);
  res.json({ ok: true });
}

// Accepts the admin session cookie, or the x-admin-token header for scripts.
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  const token = process.env.ADMIN_TOKEN;
  if (token && req.get('x-admin-token') === token) return next();
  res.status(401).json({ error: 'Sign in required' });
}

module.exports = { login, logout, isAdmin, requireAdmin };
