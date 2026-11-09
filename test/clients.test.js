'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FILE = path.join(require('os').tmpdir(), `clients-a-${process.pid}.json`);
process.env.CLIENTS_FILE = FILE;

test('client ledger: direct, SoundBetter and manual sessions, milestones, locks, card link', () => {
  const backup = fs.existsSync(FILE) ? fs.readFileSync(FILE) : null;
  try {
    fs.writeFileSync(FILE, JSON.stringify({ clients: {} }));
    const c = require('../lib/clients');
    const email = 'Artist@Example.com';
    c.createClient({ email, name: 'Test Artist' });
    for (let i = 0; i < 5; i++) c.addSession(email, { source: 'soundbetter', title: `SB ${i}`, date: '2026-10-01' });
    c.addSession(email, { source: 'manual', title: 'Not counted', counts: false });
    for (let i = 0; i < 4; i++) c.recordDirectBooking({ id: `bk${i}`, email, project: `Song ${i}`, totalCents: 60000 });
    c.recordDirectBooking({ id: 'bk0', email, totalCents: 60000 }); // duplicate webhook ignored
    let s = c.get(email);
    assert.equal(s.countedSessions, 9);
    assert.equal(s.totalSessions, 10);
    assert.equal(s.activeLock, null);
    const r = c.addSession(email, { source: 'soundbetter', title: 'Tenth' });
    assert.ok(r.activeLock, 'tenth counted session opens a window');
    assert.equal(r.activeLock.remaining, 3);
    assert.equal(r.punches, 0);
    // a discounted booking uses one slot
    const lock = c.activeRateLock(email);
    c.recordDirectBooking({ id: 'bk9', email, totalCents: 45000, loyaltyLockId: lock.id });
    assert.equal(c.get(email).activeLock.remaining, 2);
    // admin edits: revoke, then grant by hand
    c.updateLock(email, lock.id, { revoke: true });
    assert.equal(c.activeRateLock(email), null);
    c.grantLock(email, { days: 10, total: 1, discountPercent: 15 });
    assert.equal(c.activeRateLock(email).discountPercent, 15);
    // remove a session, toggle counting
    const sid = c.get(email).sessions.find(x => x.title === 'Not counted').id;
    c.updateSession(email, sid, { counts: true });
    assert.equal(c.get(email).countedSessions, 12);
    c.removeSession(email, sid);
    assert.equal(c.get(email).countedSessions, 11);
    // private card link
    const card = c.byCardToken(c.get(email).cardToken);
    assert.equal(card.punches, 1);
    assert.equal(card.name, 'Test Artist');
    assert.equal(c.byCardToken('nope'), null);
    const old = c.get(email).cardToken;
    c.regenerateCard(email);
    assert.equal(c.byCardToken(old), null);
    // email change keeps history
    c.updateClient(email, { email: 'new@example.com' });
    assert.equal(c.get('new@example.com').countedSessions, 11);
  } finally {
    fs.writeFileSync(FILE, backup || JSON.stringify({ clients: {} }, null, 2));
  }
});
