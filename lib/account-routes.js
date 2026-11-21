'use strict';
// Client account API: sign up, sign in, profile, password, verification and reset links.
const express = require('express');
const accounts = require('./accounts');
const projects = require('./projects');
const mail = require('./mail');

const router = express.Router();
const origin = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const wrap = fn => async (req, res) => {
  try { res.set('Cache-Control', 'no-store').json(await fn(req, res)); }
  catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' }); if (!e.status) console.error(e); }
};
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };

// Per IP and per email limits so passwords can't be guessed quickly.
const hits = new Map();
function limited(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
  if (arr.length >= max) return true;
  arr.push(t); hits.set(key, arr); return false;
}

function requireUser(req) {
  const u = accounts.currentUser(req);
  if (!u) fail('Sign in to continue.', 401);
  return u;
}

function sendVerification(req, u) {
  const token = accounts.issueToken(u.id, 'verify');
  return mail.send({
    to: u.email, subject: 'Confirm your email', title: 'Confirm your email',
    html: '<p>Confirm this address to finish setting up your account.</p>',
    cta: { label: 'Confirm email', url: `${origin(req)}/account?verify=${token}` }
  });
}

router.get('/me', wrap(req => ({ user: accounts.publicUser(accounts.currentUser(req)) })));

router.post('/signup', wrap((req, res) => {
  if (limited(`signup|${req.ip}`, 5, 60 * 60 * 1000)) fail('Too many new accounts from this connection. Try again later.', 429);
  if (req.body.website) return { ok: true }; // honeypot
  const u = accounts.createUser(req.body);
  accounts.startSession(res, u);
  sendVerification(req, u);
  return { user: accounts.publicUser(u) };
}));

router.post('/login', wrap((req, res) => {
  const email = String(req.body.email || '').toLowerCase();
  if (limited(`login|${req.ip}`, 20, 15 * 60 * 1000) || limited(`login|${email}`, 8, 15 * 60 * 1000)) fail('Too many attempts. Try again in 15 minutes.', 429);
  const u = accounts.authenticate(email, req.body.password);
  if (!u) fail('Wrong email or password.', 401);
  accounts.startSession(res, u);
  return { user: accounts.publicUser(u) };
}));

router.post('/logout', wrap((req, res) => { accounts.endSession(res); return { ok: true }; }));

router.patch('/profile', wrap(req => accounts.publicUser(accounts.updateProfile(requireUser(req).id, req.body))));

router.post('/password', wrap((req, res) => {
  const u = accounts.changePassword(requireUser(req).id, req.body.current, req.body.next);
  accounts.startSession(res, u); // other devices are signed out
  return { ok: true };
}));

router.post('/verify', wrap(req => ({ user: accounts.publicUser(accounts.verifyEmail(req.body.token)) })));

router.post('/verify/resend', wrap(async req => {
  const u = requireUser(req);
  if (u.verifiedAt) return { ok: true };
  if (limited(`verify|${u.id}`, 3, 60 * 60 * 1000)) fail('A link was sent recently. Check your inbox and spam folder.', 429);
  await sendVerification(req, u);
  return { ok: true };
}));

// Always answers the same way, so it can't be used to find out who has an account.
router.post('/forgot', wrap(async req => {
  const email = String(req.body.email || '').toLowerCase();
  if (!accounts.validEmail(email)) fail('Enter a valid email address.');
  if (limited(`forgot|${req.ip}`, 6, 60 * 60 * 1000)) fail('Too many requests. Try again later.', 429);
  const u = accounts.userForReset(email);
  if (u) {
    const token = accounts.issueToken(u.id, 'reset');
    await mail.send({
      to: u.email, subject: 'Reset your password', title: 'Reset your password',
      html: '<p>This link works for one hour. If you didn\'t ask for it, ignore this email.</p>',
      cta: { label: 'Choose a new password', url: `${origin(req)}/signin?mode=reset&token=${token}` }
    });
  }
  return { ok: true };
}));

router.post('/reset', wrap((req, res) => {
  const u = accounts.resetPassword(req.body.token, req.body.password);
  accounts.startSession(res, u);
  return { user: accounts.publicUser(u) };
}));

router.get('/projects', wrap(req => ({ projects: projects.forUser(requireUser(req)) })));

module.exports = router;
