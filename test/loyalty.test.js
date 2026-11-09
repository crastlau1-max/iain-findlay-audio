'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLIENTS = path.join(require('os').tmpdir(), `clients-b-${process.pid}.json`);
process.env.CLIENTS_FILE = CLIENTS;
const CONFIG = path.join(__dirname, '..', 'config', 'studio.json');

test('ten paid bookings unlock a 30 day, 3 project, 25% rate lock', () => {
  const backup = fs.existsSync(CLIENTS) ? fs.readFileSync(CLIENTS) : null;
  const cfgBackup = fs.readFileSync(CONFIG);
  try {
    const cfg = JSON.parse(cfgBackup); cfg.services[0].rateCents = 60000; fs.writeFileSync(CONFIG, JSON.stringify(cfg));
    fs.writeFileSync(CLIENTS, JSON.stringify({ clients: {} }));
    const b = require('../lib/booking');
    const c = require('../lib/clients');
    const email = 'Artist@Example.com';
    for (let i = 1; i <= 9; i++) c.recordDirectBooking({ email, id: `bk${i}`, totalCents: 60000 });
    assert.equal(b.activeRateLock(email), null);
    assert.equal(b.buildQuote({ services: ['mixing'] }, { email }).discountCents, 0);
    c.recordDirectBooking({ email, id: 'bk10', totalCents: 60000 });
    c.recordDirectBooking({ email, id: 'bk10', totalCents: 60000 }); // webhook retry is ignored
    const lock = b.activeRateLock('artist@example.com');
    assert.ok(lock);
    assert.equal(lock.remaining, 3);
    assert.ok(Math.abs((Date.parse(lock.expiresAt) - Date.now()) / 864e5 - 30) < 0.01);
    const q = b.buildQuote({ services: ['mixing'], songs: 2 }, { email });
    assert.equal(q.discountCents, 30000);
    assert.equal(q.totalCents, 90000);
    assert.equal(q.dueNowCents, 45000);
    for (let i = 11; i <= 13; i++) c.recordDirectBooking({ email, id: `bk${i}`, totalCents: 45000, loyaltyLockId: lock.id });
    assert.equal(b.activeRateLock(email), null, 'lock is used up after 3 projects');
    assert.equal(b.activeRateLock(email, Date.now() + 31 * 864e5), null);
  } finally {
    fs.writeFileSync(CONFIG, cfgBackup);
    fs.writeFileSync(CLIENTS, backup || JSON.stringify({ clients: {} }, null, 2));
  }
});

test('stripe webhook signature check', () => {
  const { verifyStripeSignature } = require('../lib/booking');
  const body = '{"type":"checkout.session.completed"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex');
  assert.ok(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test'));
  assert.ok(!verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_other'));
  assert.ok(!verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, 'whsec_test'));
});
