'use strict';
// Client side project API. A client reaches a project through their account
// (by project id), or through the private token link from older emails.
const express = require('express');
const projects = require('./projects');
const accounts = require('./accounts');
const reviews = require('./reviews');
const mail = require('./mail');

const router = express.Router();
const origin = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const link = (req, pr) => `${origin(req)}/project/${pr.userId ? pr.id : pr.token}`;
const adminLink = (req, pr) => `${origin(req)}/admin#project=${pr.id}`;

// Light abuse protection: a few requests and messages per minute per visitor.
const hits = new Map();
function limit(max) {
  return (req, res, next) => {
    const key = `${req.ip}|${req.route.path}`;
    const t = Date.now();
    const arr = (hits.get(key) || []).filter(x => t - x < 60000);
    if (arr.length >= max) return res.status(429).json({ error: 'Slow down a little and try again in a minute.' });
    arr.push(t); hits.set(key, arr); next();
  };
}
const wrap = fn => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' }); if (!e.status) console.error(e); }
};
function find(req) {
  const key = String(req.params.token);
  let pr = projects.byToken(key);
  if (!pr && /^pj_[0-9a-f]{12}$/.test(key)) {
    const cand = projects.get(key);
    if (projects.owns(accounts.currentUser(req), cand)) pr = cand;
  }
  if (!pr) throw Object.assign(new Error('Project not found'), { status: 404 });
  return pr;
}
const clientView = pr => ({ ...projects.view(projects.get(pr.id), 'client'), review: reviews.forProject(pr.id) });
const notifyAdmin = (req, pr, subject, html) => mail.send({ to: process.env.ADMIN_EMAIL, subject: `${subject}: ${pr.request.title}`, title: subject, html, cta: { label: 'Open in admin', url: adminLink(req, pr) }, replyTo: pr.client.email });

router.post('/', limit(4), wrap(async req => {
  if (req.body.website) return { ok: true }; // honeypot for bots
  const user = accounts.currentUser(req);
  if (!user) throw Object.assign(new Error('Sign in or create an account to send a request.'), { status: 401 });
  const pr = projects.createRequest(req.body, user);
  mail.send({
    to: process.env.ADMIN_EMAIL, subject: `New project request: ${pr.request.title}`, title: 'New project request',
    html: `<p><strong>${mail.esc(pr.client.name || pr.client.email)}</strong>${pr.client.artist ? ` (${mail.esc(pr.client.artist)})` : ''} wants ${pr.request.services.join(' + ')} for ${pr.request.songs} song${pr.request.songs > 1 ? 's' : ''}.</p><p>${mail.esc(pr.request.description).replace(/\n/g, '<br>')}</p>${pr.request.budget ? `<p>Budget: ${mail.esc(pr.request.budget)}</p>` : ''}${pr.request.deadline ? `<p>Deadline: ${pr.request.deadline}</p>` : ''}`,
    cta: { label: 'Open in admin', url: adminLink(req, pr) }, replyTo: pr.client.email
  });
  mail.send({
    to: pr.client.email, subject: 'Request received', title: 'Request received',
    html: `<p>${mail.esc(pr.request.title)}. Replies, quotes and payments are on the project page in your account.</p>`,
    cta: { label: 'Open your project', url: link(req, pr) }
  });
  return { id: pr.id };
}));

router.get('/:token', wrap(req => {
  const pr = find(req);
  if (pr.unreadByClient) projects.markRead(pr.id, 'client');
  return clientView(pr);
}));

router.post('/:token/messages', limit(10), wrap(req => {
  const pr = find(req);
  const out = projects.addMessage(pr.id, 'client', req.body.body);
  mail.send({
    to: process.env.ADMIN_EMAIL, subject: `New message: ${pr.request.title}`, title: `${mail.esc(pr.client.name || pr.client.email)} wrote`,
    html: `<p>${mail.esc(req.body.body).replace(/\n/g, '<br>')}</p>`, cta: { label: 'Reply in admin', url: adminLink(req, pr) }, replyTo: pr.client.email
  });
  return clientView(out);
}));

router.post('/:token/accept', limit(6), wrap(req => {
  const pr = find(req);
  if (!req.body.acceptTerms) throw Object.assign(new Error('Please accept the booking terms to continue.'), { status: 400 });
  const p = projects.acceptProposal(pr.id, req.body.proposalId);
  mail.send({ to: process.env.ADMIN_EMAIL, subject: `Proposal accepted: ${pr.request.title}`, title: 'Proposal accepted', html: `<p>${mail.esc(pr.client.name || pr.client.email)} accepted ${projects.fmt(p.totalCents)}. Payment is next.</p>`, cta: { label: 'Open in admin', url: adminLink(req, pr) } });
  return clientView(pr);
}));

router.post('/:token/approve', limit(6), wrap(req => {
  const pr = find(req);
  projects.approveDelivery(pr.id);
  notifyAdmin(req, pr, 'Mix approved', `<p>${mail.esc(pr.client.name || pr.client.email)} approved the delivery.</p>`);
  return clientView(pr);
}));

router.post('/:token/revision', limit(6), wrap(req => {
  const pr = find(req);
  projects.requestRevision(pr.id, req.body.notes);
  notifyAdmin(req, pr, 'Revision requested', `<p>${mail.esc(req.body.notes).replace(/\n/g, '<br>')}</p>`);
  return clientView(pr);
}));

router.post('/:token/cancel', limit(4), wrap(req => {
  const pr = find(req);
  projects.cancelByClient(pr.id);
  notifyAdmin(req, pr, 'Request cancelled', `<p>${mail.esc(pr.client.name || pr.client.email)} cancelled the request.</p>`);
  return clientView(pr);
}));

router.post('/:token/review', limit(4), wrap(req => {
  const pr = find(req);
  if (pr.status !== 'completed') throw Object.assign(new Error('Reviews open once the project is completed.'), { status: 400 });
  reviews.add({ projectId: pr.id, userId: pr.userId, name: pr.client.name, artist: pr.client.artist, stars: req.body.stars, text: req.body.text, services: pr.request.services });
  notifyAdmin(req, pr, 'New review', `<p>${'★'.repeat(Number(req.body.stars) || 0)}</p><p>${mail.esc(req.body.text)}</p>`);
  return clientView(pr);
}));

// Start a Stripe Checkout for the deposit, the full amount, or the remaining balance.
router.post('/:token/pay', limit(6), wrap(async req => {
  const pr = find(req);
  const acc = pr.proposals.find(x => x.id === pr.acceptedProposalId);
  if (!acc) throw Object.assign(new Error('Accept the proposal first.'), { status: 400 });
  const balance = projects.balanceCents(pr);
  if (!balance) throw Object.assign(new Error('Nothing is due right now.'), { status: 400 });
  let kind = req.body.kind;
  let amount;
  if (pr.paidCents === 0 && kind === 'deposit' && acc.depositPercent > 0 && acc.depositPercent < 100) amount = acc.depositCents;
  else { kind = pr.paidCents === 0 ? 'full' : 'balance'; amount = balance; }
  if (!process.env.STRIPE_SECRET_KEY) {
    return { mode: 'preview', message: 'Online payment isn\'t switched on yet. Iain will confirm how to pay.' };
  }
  const { stripeRequest } = require('./booking');
  const session = await stripeRequest('/checkout/sessions', {
    mode: 'payment',
    customer_email: pr.client.email,
    client_reference_id: pr.id,
    success_url: `${link(req, pr)}?paid=1`,
    cancel_url: link(req, pr),
    line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: `Iain Findlay: ${pr.request.title} (${{ deposit: `${acc.depositPercent}% deposit`, full: 'paid in full', balance: 'final balance' }[kind]})` } } } },
    metadata: { projectId: pr.id, kind },
    payment_intent_data: { metadata: { projectId: pr.id, kind } }
  });
  return { mode: 'stripe', url: session.url };
}));

module.exports = router;
