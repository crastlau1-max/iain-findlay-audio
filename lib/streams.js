'use strict';
// Verified stream total. Once a day the server re-reads the public Spotify play counts
// on kworb.net for each main artist page and sums the tracks on the Muso credit list.
// No estimates: the site shows the last verified sum.
const path = require('path');
const { readJson, writeJson } = require('./store');
const { coreTitle } = require('./apple');

const FILE = path.join(__dirname, '..', 'data', 'streams.json');
const DAY = 24 * 60 * 60 * 1000;
let running = false;

const num = s => Number(String(s).replace(/[^0-9]/g, '')) || 0;
const strip = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();

// Rows of the "Song Title / Streams / Daily" table.
function parseKworb(html) {
  const start = html.indexOf('Song Title');
  const body = start >= 0 ? html.slice(start) : html;
  const rows = [];
  for (const m of body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]);
    if (cells.length < 2 || !/<a /.test(cells[0])) continue;
    const title = strip(cells[0]).replace(/^\*\s*/, '');
    rows.push({ title, streams: num(cells[1]), daily: cells[2] ? num(cells[2]) : 0 });
  }
  return rows;
}

// Sum the credited tracks for one artist page. Strict title match, each credit counted once.
function sumCredits(rows, credits) {
  const byTitle = new Map();
  for (const r of rows) { const k = coreTitle(r.title); if (!byTitle.has(k) || byTitle.get(k).streams < r.streams) byTitle.set(k, r); }
  let streams = 0, daily = 0, matched = 0;
  const seen = new Set();
  for (const c of credits) {
    const k = coreTitle(c.title);
    if (seen.has(k)) continue;
    const r = byTitle.get(k);
    if (!r) continue;
    seen.add(k); streams += r.streams; daily += r.daily; matched++;
  }
  return { streams, daily, matched };
}

async function refresh({ credits, force = false, fetchImpl = fetch } = {}) {
  const data = readJson(FILE, {});
  if (running || !Array.isArray(data.pages) || !credits?.length) return data;
  if (!force && data.checkedAt && Date.now() - Date.parse(data.checkedAt) < DAY) return data;
  running = true;
  try {
    const perArtist = { ...(data.perArtist || {}) };
    for (const page of data.pages) {
      try {
        const res = await fetchImpl(page.url, { headers: { 'User-Agent': 'IainFindlaySite/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = parseKworb(await res.text());
        const mine = credits.filter(c => c.primaryArtist === page.artist);
        const sum = sumCredits(rows, mine);
        const prev = perArtist[page.artist];
        // Stream counts only grow. A big drop means the page changed shape, so keep the last good value.
        if (sum.matched && (!prev || sum.streams >= prev.streams * 0.95)) perArtist[page.artist] = { ...sum, at: new Date().toISOString() };
      } catch (err) {
        console.warn(`[streams] ${page.artist}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    const vals = Object.values(perArtist);
    if (vals.length) {
      data.perArtist = perArtist;
      data.spotifyTotal = vals.reduce((s, v) => s + v.streams, 0);
      data.tracksCounted = vals.reduce((s, v) => s + v.matched, 0);
      data.asOf = new Date().toISOString().slice(0, 10);
    }
    data.checkedAt = new Date().toISOString();
    writeJson(FILE, data);
    console.log(`[streams] verified ${data.spotifyTotal?.toLocaleString('en-US')} streams across ${data.tracksCounted} tracks`);
    return data;
  } finally { running = false; }
}

module.exports = { refresh, parseKworb, sumCredits };
