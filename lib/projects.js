'use strict';
// Projects work like SoundBetter: a client sends a request, you talk in a thread,
// you send a custom proposal (your price, discounts, terms), the client accepts and pays.
//
// Status: request -> proposal -> awaiting_payment -> in_progress -> delivered -> completed
//         (or cancelled at any point)
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./store');
const clients = require('./clients');

const FILE = process.env.PROJECTS_FILE || path.join(__dirname, '..', 'data', 'projects.json');
const CONFIG = path.join(__dirname, '..', 'config', 'studio.json');
const STATUSES = ['request', 'proposal', 'awaiting_payment', 'in_progress', 'delivered', 'completed', 'cancelled'];
const STATUS_LABEL = { request: 'New request', proposal: 'Proposal sent', awaiting_payment: 'Awaiting payment', in_progress: 'In progress', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled' };

const now = () => new Date().toISOString();
const rid = p => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const load = () => { const d = readJson(FILE, { projects: {} }); if (!d.projects) d.projects = {}; return d; };
const save = d => writeJson(FILE, d);
const cfg = () => readJson(CONFIG, {});
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------- money ----------
function priceProposal(p) {
  const lines = (p.lines || []).map(l => ({ label: clean(l.label, 120), qty: Math.max(1, Math.min(99, parseInt(l.qty, 10) || 1)), unitCents: Math.max(0, Math.round(Number(l.unitCents) || 0)) }))
    .filter(l => l.label);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitCents, 0);
  const d = p.discount || { source: 'none' };
  let discountCents = 0;
  if (d.source === 'custom' || d.source === 'loyalty') {
    const v = Math.max(0, Number(d.value) || 0);
    discountCents = d.type === 'amount' ? Math.round(v) : Math.round(subtotal * Math.min(100, v) / 100);
  }
  discountCents = Math.min(subtotal, discountCents);
  const total = subtotal - discountCents;
  const depositPercent = Math.max(0, Math.min(100, parseInt(p.depositPercent, 10) || 0));
  return { lines, subtotalCents: subtotal, discountCents, totalCents: total, depositPercent, depositCents: Math.round(total * depositPercent / 100) };
}

function balanceCents(pr) {
  const acc = pr.proposals.find(x => x.id === pr.acceptedProposalId);
  return acc ? Math.max(0, acc.totalCents - pr.paidCents) : 0;
}

// What each side may see. The client view never includes your private notes.
function view(pr, who) {
  const acc = pr.proposals.find(x => x.id === pr.acceptedProposalId) || null;
  const open = [...pr.proposals].reverse().find(x => x.status === 'open') || null;
  const base = {
    id: pr.id, status: pr.status, statusLabel: STATUS_LABEL[pr.status], createdAt: pr.createdAt, updatedAt: pr.updatedAt,
    client: pr.client, request: pr.request, messages: pr.messages,
    proposals: pr.proposals.filter(x => who === 'admin' || x.status !== 'draft'),
    openProposal: open, acceptedProposal: acc,
    paidCents: pr.paidCents, balanceCents: balanceCents(pr), payments: pr.payments,
    intake: ['in_progress', 'delivered', 'completed'].includes(pr.status) || pr.paidCents > 0 ? { dropboxUrl: cfg().intake?.dropboxUrl, guidelines: cfg().intake?.guidelines } : null
  };
  if (who === 'admin') return { ...base, token: pr.token, notes: pr.notes, unreadByAdmin: pr.unreadByAdmin, loyalty: clients.get(pr.client.email) };
  return { ...base, unread: pr.unreadByClient };
}

function summary(pr) {
  const last = pr.messages[pr.messages.length - 1];
  const acc = pr.proposals.find(x => x.id === pr.acceptedProposalId);
  const open = [...pr.proposals].reverse().find(x => x.status === 'open');
  return {
    id: pr.id, status: pr.status, statusLabel: STATUS_LABEL[pr.status], createdAt: pr.createdAt, updatedAt: pr.updatedAt,
    client: pr.client, title: pr.request.title, services: pr.request.services, songs: pr.request.songs,
    unread: pr.unreadByAdmin, lastMessage: last ? { from: last.from, body: last.body.slice(0, 140), at: last.at } : null,
    totalCents: (acc || open)?.totalCents ?? null, paidCents: pr.paidCents, balanceCents: balanceCents(pr)
  };
}

function get(id) { return load().projects[id] || null; }
function byToken(token) {
  if (!token || String(token).length < 20) return null;
  return Object.values(load().projects).find(p => p.token === token) || null;
}
function list({ status, q } = {}) {
  const n = String(q || '').toLowerCase();
  return Object.values(load().projects)
    .filter(p => !status || status === 'all' || (status === 'open' ? !['completed', 'cancelled'].includes(p.status) : p.status === status))
    .filter(p => !n || [p.client.email, p.client.name, p.client.artist, p.request.title].join(' ').toLowerCase().includes(n))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summary);
}

function mutate(id, fn) {
  const d = load();
  const pr = d.projects[id];
  if (!pr) throw err('Project not found', 404);
  const out = fn(pr);
  pr.updatedAt = now();
  save(d);
  return out === undefined ? pr : out;
}

function sysMsg(pr, body) { pr.messages.push({ id: rid('msg'), from: 'system', body, at: now() }); }

// ---------- client actions ----------
function createRequest(b) {
  const email = clean(b.email, 160).toLowerCase();
  if (!validEmail(email)) throw err('Enter a valid email so I can reply.');
  const services = (Array.isArray(b.services) ? b.services : []).filter(s => ['mixing', 'mastering', 'production'].includes(s));
  if (!services.length) throw err('Choose at least one service.');
  const description = clean(b.description, 4000);
  if (description.length < 10) throw err('Tell me a little about the project.');
  const id = `pj_${crypto.randomBytes(6).toString('hex')}`;
  const pr = {
    id, token: crypto.randomBytes(18).toString('base64url'), createdAt: now(), updatedAt: now(), status: 'request',
    client: { email, name: clean(b.name, 120), artist: clean(b.artist, 120) },
    request: {
      title: clean(b.title, 160) || 'Untitled project', services, songs: Math.max(1, Math.min(50, parseInt(b.songs, 10) || 1)),
      liveDrums: Boolean(b.liveDrums), deadline: /^\d{4}-\d{2}-\d{2}$/.test(b.deadline || '') ? b.deadline : null,
      budget: clean(b.budget, 60), references: clean(b.references, 1000), description
    },
    messages: [{ id: rid('msg'), from: 'client', body: description, at: now() }],
    proposals: [], acceptedProposalId: null, paidCents: 0, payments: [], notes: '',
    unreadByAdmin: 1, unreadByClient: 0
  };
  const d = load(); d.projects[id] = pr; save(d);
  return pr;
}

function addMessage(id, from, body) {
  const text = clean(body, 4000);
  if (!text) throw err('Write a message first.');
  return mutate(id, pr => {
    if (pr.status === 'cancelled' && from === 'client') throw err('This project was closed. Start a new request any time.');
    pr.messages.push({ id: rid('msg'), from, body: text, at: now() });
    if (from === 'client') pr.unreadByAdmin += 1; else pr.unreadByClient += 1;
  });
}

function markRead(id, who) {
  return mutate(id, pr => { if (who === 'admin') pr.unreadByAdmin = 0; else pr.unreadByClient = 0; });
}

function acceptProposal(id, proposalId) {
  return mutate(id, pr => {
    const p = pr.proposals.find(x => x.id === proposalId);
    if (!p || p.status !== 'open') throw err('That proposal is no longer open. Refresh to see the latest.');
    p.status = 'accepted'; p.acceptedAt = now();
    pr.acceptedProposalId = p.id;
    pr.status = 'awaiting_payment';
    sysMsg(pr, `Proposal accepted: ${fmt(p.totalCents)}.`);
    pr.unreadByAdmin += 1;
    return p;
  });
}

// ---------- admin actions ----------
function sendProposal(id, input) {
  const priced = priceProposal(input);
  if (!priced.lines.length) throw err('Add at least one line to the proposal.');
  const d = input.discount || {};
  let discount = { source: 'none' };
  if (d.source === 'custom') discount = { source: 'custom', type: d.type === 'amount' ? 'amount' : 'percent', value: Number(d.value) || 0, note: clean(d.note, 120) };
  if (d.source === 'loyalty') {
    return mutate(id, pr => {
      const lock = clients.activeRateLock(pr.client.email);
      if (!lock) throw err('This client has no open rate lock.');
      return createProposal(pr, { ...input, discount: { source: 'loyalty', type: 'percent', value: lock.discountPercent, note: `Rate lock, ${lock.discountPercent}% off`, lockId: lock.id } });
    });
  }
  return mutate(id, pr => createProposal(pr, { ...input, discount }));
}

function createProposal(pr, input) {
  if (['completed', 'cancelled'].includes(pr.status)) throw err('This project is closed.');
  if (pr.paidCents > 0) throw err('This project already has a payment. Use a new project for extra work.');
  const priced = priceProposal(input);
  pr.proposals.forEach(x => { if (x.status === 'open') x.status = 'replaced'; });
  const p = {
    id: rid('prop'), createdAt: now(), status: 'open', ...priced, discount: input.discount,
    deliveryDays: Math.max(1, Math.min(120, parseInt(input.deliveryDays, 10) || 7)),
    revisions: Math.max(0, Math.min(10, parseInt(input.revisions, 10) || 0)),
    deliverables: (Array.isArray(input.deliverables) ? input.deliverables : []).map(x => clean(x, 80)).filter(Boolean).slice(0, 12),
    note: clean(input.note, 2000)
  };
  pr.proposals.push(p);
  pr.acceptedProposalId = null;
  pr.status = 'proposal';
  sysMsg(pr, `New proposal: ${fmt(p.totalCents)}${p.discountCents ? ` (includes ${fmt(p.discountCents)} off)` : ''}.`);
  pr.unreadByClient += 1;
  return p;
}

function withdrawProposal(id, proposalId) {
  return mutate(id, pr => {
    const p = pr.proposals.find(x => x.id === proposalId);
    if (!p || !['open', 'accepted'].includes(p.status) || pr.paidCents > 0) throw err('That proposal can\'t be withdrawn.');
    p.status = 'withdrawn';
    if (pr.acceptedProposalId === p.id) pr.acceptedProposalId = null;
    pr.status = 'request';
    sysMsg(pr, 'Proposal withdrawn.');
  });
}

// Payments come from the Stripe webhook, or from you marking cash, Zelle and so on.
function recordPayment(id, { amountCents, kind, method = 'stripe', ref = null }) {
  return mutate(id, pr => {
    if (ref && pr.payments.some(x => x.ref === ref)) return; // webhook retry
    const acc = pr.proposals.find(x => x.id === pr.acceptedProposalId);
    if (!acc) throw err('Accept a proposal before recording a payment.');
    const amt = Math.max(0, Math.round(amountCents));
    if (!amt) throw err('Enter an amount.');
    if (amt > balanceCents(pr)) throw err(`That's more than the ${fmt(balanceCents(pr))} still due.`);
    pr.payments.push({ id: rid('pay'), kind, method, amountCents: amt, ref, at: now() });
    pr.paidCents += amt;
    if (pr.status === 'awaiting_payment') pr.status = 'in_progress';
    sysMsg(pr, `Payment received: ${fmt(amt)}${balanceCents(pr) ? `. Balance remaining ${fmt(balanceCents(pr))}` : '. Paid in full'}.`);
    if (pr.status === 'delivered' && balanceCents(pr) === 0) pr.status = 'completed';
    if (balanceCents(pr) === 0 && !pr.loyaltyRecorded) {
      pr.loyaltyRecorded = true;
      clients.recordDirectBooking({ id: pr.id, email: pr.client.email, name: pr.client.name, project: pr.request.title, totalCents: acc.totalCents, loyaltyLockId: acc.discount?.source === 'loyalty' ? acc.discount.lockId : null });
    }
  });
}

function setStatus(id, status) {
  if (!['in_progress', 'delivered', 'completed', 'cancelled'].includes(status)) throw err('Unknown status');
  return mutate(id, pr => {
    if (status === 'delivered') {
      if (!pr.acceptedProposalId) throw err('No accepted proposal yet.');
      pr.status = balanceCents(pr) ? 'delivered' : 'completed';
      sysMsg(pr, balanceCents(pr) ? `Final mix delivered for approval. Balance due: ${fmt(balanceCents(pr))}.` : 'Final files delivered.');
    } else {
      pr.status = status;
      sysMsg(pr, { in_progress: 'Work started.', completed: 'Project completed.', cancelled: 'Project closed.' }[status]);
    }
    pr.unreadByClient += 1;
  });
}

function setNotes(id, notes) { return mutate(id, pr => { pr.notes = clean(notes, 4000); }); }

function fmt(c) { return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; }

function stats() {
  const all = Object.values(load().projects);
  return {
    newRequests: all.filter(p => p.status === 'request').length,
    unread: all.reduce((s, p) => s + (p.unreadByAdmin || 0), 0),
    active: all.filter(p => ['proposal', 'awaiting_payment', 'in_progress', 'delivered'].includes(p.status)).length,
    balanceDue: all.filter(p => p.status === 'delivered').length,
    paidThisMonthCents: all.flatMap(p => p.payments).filter(x => x.at.startsWith(now().slice(0, 7))).reduce((s, x) => s + x.amountCents, 0)
  };
}

module.exports = { createRequest, addMessage, markRead, acceptProposal, sendProposal, withdrawProposal, recordPayment, setStatus, setNotes, get, byToken, list, view, summary, stats, balanceCents, priceProposal, fmt, STATUS_LABEL };
