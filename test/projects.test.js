'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
process.env.PROJECTS_FILE = path.join(os.tmpdir(), `projects-${process.pid}.json`);
process.env.CLIENTS_FILE = path.join(os.tmpdir(), `clients-p-${process.pid}.json`);
const fs = require('fs');
fs.writeFileSync(process.env.PROJECTS_FILE, '{"projects":{}}');
fs.writeFileSync(process.env.CLIENTS_FILE, '{"clients":{}}');
const P = require('../lib/projects');
const C = require('../lib/clients');

test('request -> proposal with custom price and discount -> accept -> deposit -> deliver -> balance', () => {
  const pr = P.createRequest({ email: 'Jay@Example.com', name: 'Jay', services: ['mixing', 'mastering'], songs: 2, title: 'Night Drive', description: 'Two songs, dark R&B, references attached' });
  assert.equal(pr.status, 'request');
  assert.equal(P.byToken(pr.token).id, pr.id);
  P.addMessage(pr.id, 'iain', 'Can you send stems?');
  assert.throws(() => P.sendProposal(pr.id, { lines: [] }), /at least one line/);
  const p = P.sendProposal(pr.id, { lines: [{ label: 'Mix', qty: 2, unitCents: 50000 }, { label: 'Master', qty: 2, unitCents: 10000 }], discount: { source: 'custom', type: 'percent', value: 10, note: 'Returning' }, depositPercent: 50, deliveryDays: 7, revisions: 2 });
  assert.equal(p.subtotalCents, 120000);
  assert.equal(p.discountCents, 12000);
  assert.equal(p.totalCents, 108000);
  assert.equal(p.depositCents, 54000);
  // a second proposal replaces the first
  const p2 = P.sendProposal(pr.id, { lines: [{ label: 'Mix and master', qty: 2, unitCents: 55000 }], discount: { source: 'custom', type: 'amount', value: 10000 }, depositPercent: 50 });
  assert.equal(P.get(pr.id).proposals[0].status, 'replaced');
  assert.throws(() => P.acceptProposal(pr.id, p.id), /no longer open/);
  P.acceptProposal(pr.id, p2.id);
  assert.equal(P.get(pr.id).status, 'awaiting_payment');
  P.recordPayment(pr.id, { amountCents: 50000, kind: 'deposit', ref: 'cs_1' });
  P.recordPayment(pr.id, { amountCents: 50000, kind: 'deposit', ref: 'cs_1' }); // retry ignored
  assert.equal(P.get(pr.id).status, 'in_progress');
  assert.equal(P.balanceCents(P.get(pr.id)), 50000);
  assert.equal(C.get('jay@example.com'), null, 'no punch until paid in full');
  P.setStatus(pr.id, 'delivered');
  assert.equal(P.get(pr.id).status, 'delivered');
  P.recordPayment(pr.id, { amountCents: 50000, kind: 'balance', ref: 'cs_2' });
  assert.equal(P.get(pr.id).status, 'completed');
  assert.equal(C.get('jay@example.com').countedSessions, 1, 'paid in full adds a punch');
  const v = P.view(P.get(pr.id), 'client');
  assert.equal(v.token, undefined, 'client view hides admin fields');
  assert.ok(v.intake);
});

test('rate lock proposal uses the lock and a slot', () => {
  const email = 'lock@example.com';
  for (let i = 0; i < 10; i++) C.addSession(email, { source: 'soundbetter' });
  const pr = P.createRequest({ email, services: ['mixing'], description: 'One more single please' });
  const p = P.sendProposal(pr.id, { lines: [{ label: 'Mix', qty: 1, unitCents: 60000 }], discount: { source: 'loyalty' }, depositPercent: 0 });
  assert.equal(p.discountCents, 15000);
  P.acceptProposal(pr.id, p.id);
  P.recordPayment(pr.id, { amountCents: 45000, kind: 'full', ref: 'cs_3' });
  assert.equal(C.get(email).activeLock.remaining, 2);
});
