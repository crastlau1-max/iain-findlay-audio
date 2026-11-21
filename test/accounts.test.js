'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.ACCOUNTS_FILE = path.join(os.tmpdir(), `accounts-${process.pid}.json`);
process.env.PROJECTS_FILE = path.join(os.tmpdir(), `projects-a-${process.pid}.json`);
process.env.CLIENTS_FILE = path.join(os.tmpdir(), `clients-a-${process.pid}.json`);
process.env.REVIEWS_FILE = path.join(os.tmpdir(), `reviews-${process.pid}.json`);
process.env.SESSION_SECRET = 'test-secret';
for (const f of [process.env.ACCOUNTS_FILE, process.env.REVIEWS_FILE]) fs.rmSync(f, { force: true });
fs.writeFileSync(process.env.PROJECTS_FILE, '{"projects":{}}');
fs.writeFileSync(process.env.CLIENTS_FILE, '{"clients":{}}');
const A = require('../lib/accounts');
const P = require('../lib/projects');
const R = require('../lib/reviews');

// Tiny fake req/res for the cookie helpers.
const fakeRes = () => { const h = []; return { h, append: (k, v) => h.push(v) }; };
const reqWith = res => ({ headers: { cookie: res.h.map(c => c.split(';')[0]).join('; ') } });

test('sign up, sign in, sessions and password change', () => {
  assert.throws(() => A.createUser({ email: 'bad', password: 'longenough' }), /valid email/);
  assert.throws(() => A.createUser({ email: 'a@b.co', password: 'short' }), /8 characters/);
  const u = A.createUser({ email: 'Kay@Example.com', password: 'correct horse', name: 'Kay Lee' });
  assert.equal(u.email, 'kay@example.com');
  assert.throws(() => A.createUser({ email: 'kay@example.com', password: 'another one' }), /already exists/);
  assert.equal(A.authenticate('kay@example.com', 'wrong pass'), null);
  assert.equal(A.authenticate('KAY@example.com', 'correct horse').id, u.id);
  assert.equal(A.authenticate('nobody@example.com', 'whatever'), null);

  const res = fakeRes(); A.startSession(res, u);
  assert.equal(A.currentUser(reqWith(res)).id, u.id);
  assert.equal(A.currentUser({ headers: { cookie: res.h[0].split(';')[0].replace(/.$/, 'x') } }), null, 'tampered cookie rejected');

  A.changePassword(u.id, 'correct horse', 'battery staple');
  assert.equal(A.currentUser(reqWith(res)), null, 'old sessions end after a password change');
  assert.ok(A.authenticate('kay@example.com', 'battery staple'));
});

test('verification and reset links are single use', () => {
  const u = A.createUser({ email: 'v@example.com', password: 'password1' });
  const t = A.issueToken(u.id, 'verify');
  assert.ok(A.verifyEmail(t).verifiedAt);
  assert.throws(() => A.verifyEmail(t), /expired or was already used/);
  const r = A.issueToken(u.id, 'reset');
  A.resetPassword(r, 'new password 2');
  assert.throws(() => A.resetPassword(r, 'again again'), /expired or was already used/);
  assert.ok(A.authenticate('v@example.com', 'new password 2'));
});

test('projects belong to accounts; older email projects need a verified email', () => {
  const old = P.createRequest({ email: 'own@example.com', services: ['mixing'], description: 'Sent before signing up' });
  const u = A.createUser({ email: 'own@example.com', password: 'password1', name: 'Own Er' });
  const mine = P.createRequest({ services: ['mastering'], description: 'Sent while signed in', email: 'ignored@example.com' }, u);
  assert.equal(mine.client.email, 'own@example.com');
  assert.deepEqual(P.forUser(u).map(p => p.id), [mine.id]);
  assert.equal(P.owns(u, P.get(old.id)), false);
  const verified = A.verifyEmail(A.issueToken(u.id, 'verify'));
  assert.equal(P.forUser(verified).length, 2);
  const stranger = A.createUser({ email: 'x@example.com', password: 'password1' });
  assert.equal(P.owns(stranger, P.get(mine.id)), false);
});

test('delivery approval, revisions, cancel and reviews', () => {
  const u = A.createUser({ email: 'flow@example.com', password: 'password1', name: 'Flo Rida Smith' });
  const pr = P.createRequest({ services: ['mixing'], description: 'One song please, thanks' }, u);
  const p = P.sendProposal(pr.id, { lines: [{ label: 'Mix', qty: 1, unitCents: 40000 }], depositPercent: 50, revisions: 1 });
  P.acceptProposal(pr.id, p.id);
  P.recordPayment(pr.id, { amountCents: 20000, kind: 'deposit', ref: 'x1' });
  assert.throws(() => P.approveDelivery(pr.id), /no delivery/);
  P.setStatus(pr.id, 'delivered');
  P.requestRevision(pr.id, 'Vocals up a touch');
  assert.equal(P.get(pr.id).status, 'in_progress');
  P.setStatus(pr.id, 'delivered');
  assert.throws(() => P.requestRevision(pr.id, 'More changes'), /revision round is used/);
  P.approveDelivery(pr.id);
  assert.equal(P.get(pr.id).status, 'delivered', 'balance still due');
  P.recordPayment(pr.id, { amountCents: 20000, kind: 'balance', ref: 'x2' });
  assert.equal(P.get(pr.id).status, 'completed');

  const r = R.add({ projectId: pr.id, name: 'Flo Rida Smith', stars: 5, text: 'Great mix, fast turnaround.' });
  assert.equal(r.name, 'Flo S.');
  assert.throws(() => R.add({ projectId: pr.id, stars: 4, text: 'Second review here' }), /already reviewed/);
  assert.throws(() => R.add({ stars: 9, text: 'Out of range rating' }), /1 to 5/);
  R.update(r.id, { hidden: true });
  assert.equal(R.publicList().count, 0);

  const c = P.createRequest({ services: ['mixing'], description: 'Changed my mind later' }, u);
  P.cancelByClient(c.id);
  assert.equal(P.get(c.id).status, 'cancelled');
});

test('file uploads: stored, recorded on the project, bad types refused', async () => {
  process.env.UPLOAD_DIR = path.join(os.tmpdir(), `uploads-${process.pid}`);
  delete require.cache[require.resolve('../lib/files')];
  const F = require('../lib/files');
  const { Readable } = require('stream');
  const fakeReq = (buf) => Object.assign(Readable.from([buf]), { get: () => String(buf.length) });
  const u = A.createUser({ email: 'files@example.com', password: 'password1' });
  const pr = P.createRequest({ services: ['mixing'], description: 'Has reference tracks' }, u);
  const rec = await F.receive(fakeReq(Buffer.from('RIFF....WAVE')), pr.id, '../Ref Track.wav', 0);
  assert.equal(rec.name, 'Ref Track.wav', 'path parts stripped');
  P.addFile(pr.id, rec, 'client');
  assert.equal(P.get(pr.id).files.length, 1);
  assert.ok(F.filePath(pr.id, rec.id));
  assert.equal(F.filePath(pr.id, '../../etc'), null);
  await assert.rejects(F.receive(fakeReq(Buffer.from('x')), pr.id, 'run.exe', 1), /isn't accepted/);
});
