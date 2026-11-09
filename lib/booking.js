'use strict';
// Direct booking: quotes, private loyalty matching, Stripe Checkout, webhook bookkeeping.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./store');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'config', 'studio.json');
const BOOKINGS = path.join(ROOT, 'data', 'bookings.json');
const DAY = 24 * 60 * 60 * 1000;

const config = () => readJson(CONFIG, {});
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// ---------- loyalty (server side only, never exposed as a lookup) ----------
const clients = require('./clients');
const { activeRateLock } = clients;

// ---------- quotes ----------
function buildQuote(body = {}, { email } = {}) {
  const cfg = config();
  const serviceIds = Array.isArray(body.services) ? body.services : [];
  const services = (cfg.services || []).filter(s => serviceIds.includes(s.id));
  const songs = clampInt(body.songs, 1, 50, 1);
  const addOnReq = body.addOns || {};
  const addOns = (cfg.addOns || [])
    .filter(a => addOnReq[a.id])
    .map(a => ({ ...a, qty: clampInt(addOnReq[a.id], 1, 20, 1) }));
  const plan = body.payment === 'full' ? 'full' : 'deposit';

  const lines = [
    ...services.map(s => ({ id: s.id, name: s.name, qty: songs, unit: s.unit, rateLabel: s.rateLabel, unitCents: s.rateCents })),
    ...addOns.map(a => ({ id: a.id, name: a.name, qty: a.qty, unit: a.unit, rateLabel: a.rateLabel, unitCents: a.rateCents }))
  ].map(l => ({ ...l, totalCents: Number.isInteger(l.unitCents) ? l.unitCents * l.qty : null }));

  const priced = lines.length > 0 && lines.every(l => Number.isInteger(l.totalCents));
  let subtotal = priced ? lines.reduce((s, l) => s + l.totalCents, 0) : null;

  // The rate lock applies to the base services only and never stacks with anything else.
  let loyalty = null;
  if (email) {
    const lock = activeRateLock(email);
    if (lock && services.length) loyalty = { lockId: lock.id, percent: lock.discountPercent || 25, expiresAt: lock.expiresAt, remaining: lock.remaining };
  }
  let discountCents = 0;
  if (priced && loyalty) {
    const base = lines.filter(l => services.some(s => s.id === l.id)).reduce((s, l) => s + l.totalCents, 0);
    discountCents = Math.round(base * loyalty.percent / 100);
  }
  const totalCents = priced ? subtotal - discountCents : null;
  const depositPercent = cfg.payment?.depositPercent || 50;
  const dueNowCents = priced ? (plan === 'full' ? totalCents : Math.round(totalCents * depositPercent / 100)) : null;

  return {
    services: services.map(s => s.id),
    songs,
    lines,
    plan,
    depositPercent,
    priced,
    subtotalCents: subtotal,
    discountCents,
    loyaltyApplied: Boolean(loyalty && priced),
    loyaltyLockId: loyalty && priced ? loyalty.lockId : null,
    totalCents,
    dueNowCents,
    balanceCents: priced ? totalCents - dueNowCents : null,
    included: cfg.includedDeliverables || []
  };
}

// ---------- Stripe (REST, no SDK needed) ----------
function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

async function stripeRequest(pathname, params) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode(params)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Stripe error ${res.status}`);
  return json;
}

function saveBooking(b) {
  const db = readJson(BOOKINGS, { bookings: {} });
  db.bookings[b.id] = b;
  writeJson(BOOKINGS, db);
}
function getBooking(id) {
  return readJson(BOOKINGS, { bookings: {} }).bookings[id] || null;
}

async function createCheckout(body, origin) {
  const email = normEmail(body.email);
  if (!validEmail(email)) return { status: 400, error: 'Enter a valid billing email.' };
  if (!body.acceptTerms) return { status: 400, error: 'Please accept the booking terms to continue.' };
  const quote = buildQuote(body, { email });
  if (!quote.services.length) return { status: 400, error: 'Choose at least one service.' };

  const booking = {
    id: `bk_${crypto.randomBytes(9).toString('base64url')}`,
    createdAt: new Date().toISOString(),
    email,
    name: String(body.name || '').slice(0, 120),
    project: String(body.project || '').slice(0, 160),
    artist: String(body.artist || '').slice(0, 120),
    notes: String(body.notes || '').slice(0, 2000),
    services: quote.services,
    songs: quote.songs,
    lines: quote.lines,
    plan: quote.plan,
    totalCents: quote.totalCents,
    paidCents: 0,
    loyaltyApplied: quote.loyaltyApplied,
    loyaltyLockId: quote.loyaltyLockId,
    status: 'pending'
  };

  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY) && quote.priced;
  if (!stripeReady) {
    booking.status = 'demo';
    saveBooking(booking);
    const reason = !quote.priced ? 'Rates are still placeholders in config/studio.json.' : 'STRIPE_SECRET_KEY is not set.';
    return { status: 200, mode: 'demo', bookingId: booking.id, reason, quote: { ...quote, loyaltyApplied: undefined, loyaltyLockId: undefined } };
  }

  const kind = quote.plan === 'full' ? 'full' : 'deposit';
  const description = `${quote.services.map(s => s[0].toUpperCase() + s.slice(1)).join(' + ')} for ${quote.songs} song${quote.songs > 1 ? 's' : ''}${booking.project ? `: ${booking.project}` : ''}`;
  const session = await stripeRequest('/checkout/sessions', {
    mode: 'payment',
    customer_email: email,
    client_reference_id: booking.id,
    success_url: `${origin}/?booking=success&ref=${booking.id}#book`,
    cancel_url: `${origin}/?booking=cancelled#book`,
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: config().currency || 'usd',
          unit_amount: quote.dueNowCents,
          product_data: { name: kind === 'full' ? 'Iain Findlay booking, paid in full' : `Iain Findlay booking, ${quote.depositPercent}% deposit`, description }
        }
      }
    },
    metadata: { bookingId: booking.id, kind },
    payment_intent_data: { metadata: { bookingId: booking.id, kind }, description }
  });
  booking.stripeSessionId = session.id;
  saveBooking(booking);
  return { status: 200, mode: 'stripe', url: session.url, bookingId: booking.id };
}

async function createBalanceCheckout(bookingId, origin) {
  const b = getBooking(bookingId);
  if (!b || b.status !== 'deposit_paid') return { status: 404, error: 'No outstanding balance for that booking.' };
  if (!process.env.STRIPE_SECRET_KEY) return { status: 503, error: 'Stripe is not configured.' };
  const due = b.totalCents - b.paidCents;
  const session = await stripeRequest('/checkout/sessions', {
    mode: 'payment',
    customer_email: b.email,
    client_reference_id: b.id,
    success_url: `${origin}/?booking=balance-paid&ref=${b.id}#book`,
    cancel_url: `${origin}/#book`,
    line_items: { 0: { quantity: 1, price_data: { currency: config().currency || 'usd', unit_amount: due, product_data: { name: 'Iain Findlay booking, final balance' } } } },
    metadata: { bookingId: b.id, kind: 'balance' },
    payment_intent_data: { metadata: { bookingId: b.id, kind: 'balance' } }
  });
  return { status: 200, url: session.url };
}

function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const given = parts.v1 || '';
  if (given.length !== expected.length) return false;
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  return fresh && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function handleStripeEvent(event) {
  if (event.type !== 'checkout.session.completed') return { ignored: true };
  const s = event.data.object;
  if (s.metadata?.projectId) {
    const projects = require('./projects');
    projects.recordPayment(s.metadata.projectId, { amountCents: s.amount_total || 0, kind: s.metadata.kind, method: 'stripe', ref: s.id });
    return { ok: true, projectId: s.metadata.projectId };
  }
  const id = s.metadata?.bookingId || s.client_reference_id;
  const kind = s.metadata?.kind;
  const b = getBooking(id);
  if (!b) return { ignored: true };
  b.paidCents += s.amount_total || 0;
  if (kind === 'deposit') b.status = 'deposit_paid';
  if (kind === 'full' || kind === 'balance') b.status = 'paid';
  b.updatedAt = new Date().toISOString();
  saveBooking(b);
  if (b.status === 'paid') clients.recordDirectBooking(b);
  return { ok: true, bookingId: id, status: b.status };
}

function listBookings() {
  return Object.values(readJson(BOOKINGS, { bookings: {} }).bookings).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// Admin: mark a booking paid outside Stripe (cash, Zelle) or cancel it.
function setBookingStatus(id, status) {
  const b = getBooking(id);
  if (!b) { const e = new Error('Booking not found'); e.status = 404; throw e; }
  if (!['deposit_paid', 'paid', 'cancelled', 'pending'].includes(status)) { const e = new Error('Unknown status'); e.status = 400; throw e; }
  b.status = status;
  if (status === 'paid' && Number.isInteger(b.totalCents)) b.paidCents = b.totalCents;
  b.updatedAt = new Date().toISOString();
  saveBooking(b);
  if (status === 'paid') clients.recordDirectBooking(b);
  return b;
}

function publicConfig() {
  const cfg = config();
  return {
    services: cfg.services,
    addOns: cfg.addOns,
    includedDeliverables: cfg.includedDeliverables,
    payment: cfg.payment,
    intake: cfg.intake,
    loyalty: cfg.loyalty,
    soundbetterUrl: cfg.soundbetterUrl,
    musoProfileUrl: cfg.musoProfileUrl,
    twitchChannel: cfg.twitchChannel,
    heroImage: cfg.heroImage,
    featuredArtists: cfg.featuredArtists || [],
    stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY)
  };
}

module.exports = { stripeRequest, buildQuote, createCheckout, createBalanceCheckout, verifyStripeSignature, handleStripeEvent, activeRateLock, publicConfig, listBookings, getBooking, setBookingStatus };
