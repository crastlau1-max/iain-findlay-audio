'use strict';
// Client reviews. Written by clients after a completed project, or added by Iain
// from another platform (marked with that source). Hidden reviews never reach the public API.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./store');

const FILE = process.env.REVIEWS_FILE || path.join(__dirname, '..', 'data', 'reviews.json');
const load = () => { const d = readJson(FILE, { reviews: [] }); d.reviews ||= []; return d; };
const save = d => writeJson(FILE, d);
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const clean = (s, n) => String(s ?? '').trim().slice(0, n);

// "Jordan Lee" -> "Jordan L."
function displayName(name, artist) {
  const n = clean(name, 120);
  if (n) { const [first, ...rest] = n.split(/\s+/); return rest.length ? `${first} ${rest[rest.length - 1][0].toUpperCase()}.` : first; }
  return clean(artist, 120) || 'Client';
}

function rating(v) {
  const r = parseInt(v, 10);
  if (!(r >= 1 && r <= 5)) throw err('Choose a rating from 1 to 5 stars.');
  return r;
}

function add({ projectId = null, userId = null, name, artist, stars, text, services = [], source = 'site', date = null }) {
  const body = clean(text, 2000);
  if (body.length < 10) throw err('Write a sentence or two about how the project went.');
  const d = load();
  if (projectId && d.reviews.some(r => r.projectId === projectId)) throw err('You already reviewed this project.', 409);
  const r = {
    id: `rev_${crypto.randomBytes(6).toString('hex')}`, projectId, userId, source: source === 'site' ? 'site' : clean(source, 40) || 'other',
    name: displayName(name, artist), artist: clean(artist, 120), stars: rating(stars), text: body,
    services: (Array.isArray(services) ? services : []).map(s => clean(s, 40)).filter(Boolean).slice(0, 4),
    createdAt: /^\d{4}-\d{2}-\d{2}/.test(date || '') ? new Date(date).toISOString() : new Date().toISOString(),
    hidden: false, reply: ''
  };
  d.reviews.push(r); save(d);
  return r;
}

function forProject(projectId) { return load().reviews.find(r => r.projectId === projectId) || null; }

function update(id, { hidden, reply }) {
  const d = load();
  const r = d.reviews.find(x => x.id === id);
  if (!r) throw err('Review not found', 404);
  if (hidden !== undefined) r.hidden = Boolean(hidden);
  if (reply !== undefined) r.reply = clean(reply, 1000);
  save(d); return r;
}

function remove(id) {
  const d = load();
  const n = d.reviews.length;
  d.reviews = d.reviews.filter(r => r.id !== id);
  if (d.reviews.length === n) throw err('Review not found', 404);
  save(d); return { ok: true };
}

function listAll() { return [...load().reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

function publicList() {
  const shown = listAll().filter(r => !r.hidden);
  const average = shown.length ? Math.round(shown.reduce((s, r) => s + r.stars, 0) / shown.length * 10) / 10 : null;
  return {
    count: shown.length, average,
    reviews: shown.map(({ id, name, artist, stars, text, services, createdAt, source, reply }) => ({ id, name, artist, stars, text, services, createdAt, source, reply }))
  };
}

module.exports = { add, forProject, update, remove, listAll, publicList, displayName };
