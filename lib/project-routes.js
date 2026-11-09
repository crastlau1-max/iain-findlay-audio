'use strict';
// Client side project API. A client reaches their project only through its private token link.
const express = require('express');
const projects = require('./projects');
const mail = require('./mail');

const router = express.Router();
const origin = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const link = (req, pr) => `${origin(req)}/project/${pr.token}`;
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
  const pr = projects.byToken(String(req.params.token));
  if (!pr) throw Object.assign(new Error('Project not found'), { status: 404 });
  return pr;
}

router.post('/', limit(4), wrap(async req => {
  if (req.body.website) return { ok: true }; // honeypot for bots
  const pr = projects.createRequest(req.body);
  mail.send({
    to: process.env.ADMIN_EMAIL, subject: `New project request: ${pr.request.title}`, title: 'New project request',
    html: `<p><strong>${mail.esc(pr.client.name || pr.client.email)}</strong>${pr.client.artist ? ` (${mail.esc(pr.client.artist)})` : ''} wants ${pr.request.services.join(' + ')} for ${pr.request.songs} song${pr.request.songs > 1 ? 's' : ''}.</p><p>${mail.esc(pr.request.description).replace(/\n/g, '<br>')}</p>${pr.request.budget ? `<p>Budget: ${mail.esc(pr.request.budget)}</p>` : ''}${pr.request.deadline ? `<p>Deadline: ${pr.request.deadline}</p>` : ''}`,
    cta: { label: 'Open in admin', url: adminLink(req, pr) }, replyTo: pr.client.email
  });
  mail.send({
    to: pr.client.email, subject: 'Got your project request', title: 'Thanks, I got your request',
    html: `<p>I'll read through it and reply with any questions or a proposal, usually within a day. Everything for this project lives on your private page, including messages, the proposal and payment.</p><p>Keep this email; the link is private to you.</p>`,
    cta: { label: 'Open your project', url: link(req, pr) }
  });
  return { token: pr.token };
}));

router.get('/:token', wrap(req => {
  const pr = find(req);
  if (pr.unreadByClient) projects.markRead(pr.id, 'client');
  return projects.view(projects.get(pr.id), 'client');
}));

router.post('/:token/messages', limit(10), wrap(req => {
  const pr = find(req);
  const out = projects.addMessage(pr.id, 'client', req.body.body);
  mail.send({
    to: process.env.ADMIN_EMAIL, subject: `New message: ${pr.request.title}`, title: `${mail.esc(pr.client.name || pr.client.email)} wrote`,
    html: `<p>${mail.esc(req.body.body).replace(/\n/g, '<br>')}</p>`, cta: { label: 'Reply in admin', url: adminLink(req, pr) }, replyTo: pr.client.email
  });
  return projects.view(out, 'client');
}));

router.post('/:token/accept', limit(6), wrap(req => {
  const pr = find(req);
  if (!req.body.acceptTerms) throw Object.assign(new Error('Please accept the booking terms to continue.'), { status: 400 });
  const p = projects.acceptProposal(pr.id, req.body.proposalId);
  mail.send({ to: process.env.ADMIN_EMAIL, subject: `Proposal accepted: ${pr.request.title}`, title: 'Proposal accepted', html: `<p>${mail.esc(pr.client.name || pr.client.email)} accepted ${projects.fmt(p.totalCents)}. Payment is next.</p>`, cta: { label: 'Open in admin', url: adminLink(req, pr) } });
  return projects.view(projects.get(pr.id), 'client');
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
