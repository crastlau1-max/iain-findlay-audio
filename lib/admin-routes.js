'use strict';
// Seller side API. Everything here requires the admin session.
const express = require('express');
const path = require('path');
const { readJson, writeJson } = require('./store');
const auth = require('./auth');
const clients = require('./clients');
const booking = require('./booking');
const projects = require('./projects');
const mail = require('./mail');

const CONFIG = path.join(__dirname, '..', 'config', 'studio.json');
const router = express.Router();

const wrap = fn => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message || 'Something went wrong' }); }
};
const cents = v => (v === '' || v == null ? null : Math.round(Number(v) * 100));
const intOr = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

router.post('/login', auth.login);
router.post('/logout', auth.logout);
router.get('/me', (req, res) => res.json({ admin: auth.isAdmin(req), passwordSet: Boolean(process.env.ADMIN_PASSWORD) }));

router.use(auth.requireAdmin);

// ---------- overview ----------
router.get('/summary', wrap(() => {
  const all = booking.listBookings();
  const month = new Date().toISOString().slice(0, 7);
  return {
    ...clients.stats(),
    projects: projects.stats(),
    awaitingBalance: all.filter(b => b.status === 'deposit_paid').length,
    pending: all.filter(b => b.status === 'pending').length,
    paidThisMonthCents: all.filter(b => b.status === 'paid' && String(b.updatedAt || b.createdAt).startsWith(month)).reduce((s, b) => s + (b.totalCents || 0), 0),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY)
  };
}));

// ---------- clients ----------
router.get('/clients', wrap(req => ({ clients: clients.list(req.query.q) })));
router.post('/clients', wrap(req => clients.createClient(req.body)));
router.get('/clients/:email', wrap(req => {
  const c = clients.get(req.params.email);
  if (!c) { const e = new Error('Client not found'); e.status = 404; throw e; }
  c.bookings = booking.listBookings().filter(b => b.email === c.email);
  return c;
}));
router.patch('/clients/:email', wrap(req => clients.updateClient(req.params.email, req.body)));
router.delete('/clients/:email', wrap(req => clients.deleteClient(req.params.email)));
router.post('/clients/:email/card', wrap(req => clients.regenerateCard(req.params.email)));

router.post('/clients/:email/sessions', wrap(req => clients.addSession(req.params.email, { ...req.body, amountCents: cents(req.body.amount) })));
router.patch('/clients/:email/sessions/:id', wrap(req => {
  const patch = { ...req.body };
  if ('amount' in patch) patch.amountCents = cents(patch.amount);
  return clients.updateSession(req.params.email, req.params.id, patch);
}));
router.delete('/clients/:email/sessions/:id', wrap(req => clients.removeSession(req.params.email, req.params.id)));

router.post('/clients/:email/locks', wrap(req => clients.grantLock(req.params.email, req.body)));
router.patch('/clients/:email/locks/:id', wrap(req => clients.updateLock(req.params.email, req.params.id, req.body)));

// ---------- projects (requests, threads, proposals) ----------
const origin = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const clientLink = (req, pr) => `${origin(req)}/project/${pr.token}`;
const notifyClient = (req, pr, subject, title, html, label = 'Open your project') =>
  mail.send({ to: pr.client.email, subject, title, html, cta: { label, url: clientLink(req, pr) } });

router.get('/projects', wrap(req => ({ projects: projects.list(req.query) })));
router.get('/projects/:id', wrap(req => {
  const pr = projects.get(req.params.id);
  if (!pr) { const e = new Error('Project not found'); e.status = 404; throw e; }
  if (pr.unreadByAdmin) projects.markRead(pr.id, 'admin');
  const v = projects.view(projects.get(pr.id), 'admin');
  v.clientLink = clientLink(req, pr);
  v.rates = readJson(CONFIG, {});
  return v;
}));
router.post('/projects/:id/messages', wrap(req => {
  const pr = projects.addMessage(req.params.id, 'iain', req.body.body);
  notifyClient(req, pr, `New message about ${pr.request.title}`, 'Iain sent you a message', `<p>${mail.esc(req.body.body).replace(/\n/g, '<br>')}</p>`, 'Reply');
  return { ok: true };
}));
router.post('/projects/:id/proposals', wrap(req => {
  const b = req.body || {};
  const input = {
    lines: (b.lines || []).map(l => ({ label: l.label, qty: l.qty, unitCents: cents(l.price) })),
    discount: b.discount?.source === 'custom' ? { ...b.discount, value: b.discount.type === 'amount' ? cents(b.discount.value) : Number(b.discount.value) } : b.discount,
    depositPercent: b.depositPercent, deliveryDays: b.deliveryDays, revisions: b.revisions, deliverables: b.deliverables, note: b.note
  };
  const p = projects.sendProposal(req.params.id, input);
  const pr = projects.get(req.params.id);
  notifyClient(req, pr, `Your proposal for ${pr.request.title}`, `Proposal: ${projects.fmt(p.totalCents)}`,
    `<p>${p.lines.map(l => `${mail.esc(l.label)}${l.qty > 1 ? ` × ${l.qty}` : ''}: ${projects.fmt(l.unitCents * l.qty)}`).join('<br>')}</p>${p.discountCents ? `<p>Discount: −${projects.fmt(p.discountCents)}</p>` : ''}<p><strong>Total ${projects.fmt(p.totalCents)}</strong>, delivery in ${p.deliveryDays} days.</p>${p.note ? `<p>${mail.esc(p.note).replace(/\n/g, '<br>')}</p>` : ''}`, 'Review and accept');
  return p;
}));
router.post('/projects/:id/proposals/:pid/withdraw', wrap(req => projects.withdrawProposal(req.params.id, req.params.pid)));
router.post('/projects/:id/payments', wrap(req => projects.recordPayment(req.params.id, { amountCents: cents(req.body.amount), kind: req.body.kind || 'manual', method: req.body.method || 'manual' })));
router.post('/projects/:id/status', wrap(req => {
  const pr = projects.setStatus(req.params.id, req.body.status);
  if (pr.status === 'delivered') notifyClient(req, pr, `Your final mix is ready: ${pr.request.title}`, 'Your final mix is ready', `<p>Have a listen and let me know if it's approved. The remaining balance of ${projects.fmt(projects.balanceCents(pr))} releases the uncompressed masters and stems.</p>`, 'Approve and pay balance');
  return projects.view(pr, 'admin');
}));
router.post('/projects/:id/notes', wrap(req => projects.setNotes(req.params.id, req.body.notes)));

// ---------- bookings (legacy instant checkout) ----------
router.get('/bookings', wrap(() => ({ bookings: booking.listBookings() })));
router.post('/bookings/:id/status', wrap(req => booking.setBookingStatus(req.params.id, req.body.status)));
router.post('/bookings/:id/balance-link', wrap(async req => {
  const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const r = await booking.createBalanceCheckout(req.params.id, origin);
  if (r.error) { const e = new Error(r.error); e.status = r.status; throw e; }
  return r;
}));

// ---------- settings (rates, deposit, loyalty, intake) ----------
router.get('/settings', wrap(() => {
  const c = readJson(CONFIG, {});
  return { services: c.services, addOns: c.addOns, depositPercent: c.payment?.depositPercent ?? 50, loyalty: c.loyalty, dropboxUrl: c.intake?.dropboxUrl || '', soundbetterUrl: c.soundbetterUrl };
}));
router.put('/settings', wrap(req => {
  const c = readJson(CONFIG, {});
  const b = req.body || {};
  const rate = (item, v) => {
    if (!v) return;
    if ('rate' in v) {
      item.rateCents = cents(v.rate);
      if (item.rateCents != null && (!Number.isInteger(item.rateCents) || item.rateCents < 0)) { const e = new Error(`Invalid rate for ${item.name}`); e.status = 400; throw e; }
      item.rateLabel = item.rateCents == null ? `[$RATE / ${item.unit}]` : `$${(item.rateCents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} / ${item.unit}`;
    }
    if (typeof v.summary === 'string' && v.summary.trim()) item.summary = v.summary.trim().slice(0, 240);
  };
  (c.services || []).forEach(s => rate(s, b.services?.[s.id]));
  (c.addOns || []).forEach(a => rate(a, b.addOns?.[a.id]));
  if (b.depositPercent != null) {
    const d = intOr(b.depositPercent, 50);
    if (d < 10 || d > 100) { const e = new Error('Deposit must be between 10% and 100%'); e.status = 400; throw e; }
    c.payment.depositPercent = d;
    c.payment.options[0].label = `${d}% deposit`;
  }
  if (b.loyalty) {
    c.loyalty = {
      bookingsRequired: Math.max(1, intOr(b.loyalty.bookingsRequired, c.loyalty.bookingsRequired)),
      windowDays: Math.max(1, intOr(b.loyalty.windowDays, c.loyalty.windowDays)),
      projectLimit: Math.max(1, intOr(b.loyalty.projectLimit, c.loyalty.projectLimit)),
      discountPercent: Math.min(100, Math.max(1, intOr(b.loyalty.discountPercent, c.loyalty.discountPercent)))
    };
  }
  if (typeof b.dropboxUrl === 'string') c.intake.dropboxUrl = b.dropboxUrl.trim() || '[DROPBOX_FILE_REQUEST_URL]';
  writeJson(CONFIG, c);
  return { ok: true };
}));

module.exports = router;
