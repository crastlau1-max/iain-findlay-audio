'use strict';
// Credit catalog pipeline:
//   Muso.ai (official API when MUSO_API_KEY is set, otherwise the verified snapshot)
//   -> overrides (spelling fixes, hard exclusions)
//   -> verified certifications
//   -> cover art + previews: manual overrides, then Deezer, then Apple (strict matching, cached)
//   -> tracks on the same release share a cover when only one of them matched
const path = require('path');
const { readJson, writeJson } = require('./store');
const { searchApple, coreAlbum } = require('./apple');
const { searchDeezer } = require('./deezer');

const ROOT = path.join(__dirname, '..');
const FILES = {
  snapshot: path.join(ROOT, 'data', 'muso-snapshot.json'),
  musoCache: path.join(ROOT, 'data', 'muso-cache.json'),
  certs: path.join(ROOT, 'data', 'certifications.json'),
  overrides: path.join(ROOT, 'data', 'credit-overrides.json'),
  apple: path.join(ROOT, 'data', 'apple-cache.json'), // legacy, still read
  covers: path.join(ROOT, 'data', 'covers-cache.json'),
  artOverrides: path.join(ROOT, 'data', 'artwork-overrides.json')
};

const MUSO_API = 'https://api.platform.muso.ai/v1';
const DAY = 24 * 60 * 60 * 1000;

const state = {
  catalog: null,
  musoSyncing: false,
  lastMusoError: null,
  enrich: { running: false, queued: 0, done: 0, lastError: null }
};

// ---------- role classification ----------
function roleCategories(roles) {
  const cats = new Set();
  for (const r of roles) {
    const s = r.toLowerCase();
    if (/master/.test(s)) cats.add('mastering');
    else if (/mix/.test(s)) cats.add('mixing');
    else if (/produc|programm|arrang/.test(s)) cats.add('production');
    else if (/compos|lyric|songwrit|writer/.test(s)) cats.add('writing');
    else if (/engineer|record|vocal|track|edit|assistant/.test(s)) cats.add('recording');
  }
  if (!cats.size) cats.add('recording');
  return [...cats];
}

function displayRoles(roles) {
  const uniq = [...new Set(roles.map(r => r.replace(/\s+/g, ' ').trim()))];
  // "Assistant Engineer" + "Engineer" reads better as just the two in a fixed order.
  const order = ['Mixing Engineer', 'Mastering Engineer', 'Engineer', 'Assistant Engineer', 'Producer', 'Co-Producer', 'Programmer', 'Composer', 'Lyricist'];
  const rank = r => (order.indexOf(r) + 1) || 99;
  return uniq.sort((a, b) => rank(a) - rank(b)).join(', ');
}

// ---------- Muso ----------
async function fetchMusoCatalog(apiKey, profileId) {
  const items = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const url = `${MUSO_API}/profile/${profileId}/credits?limit=50&offset=${offset}`;
    const res = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Muso API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const data = json.data || {};
    total = Number(data.totalCount ?? 0);
    const page = data.items || [];
    if (!page.length) break;
    page.forEach((it, i) => {
      const roles = (it.credits || []).map(c => c.child || c.parent).filter(Boolean);
      items.push({
        rank: offset + i + 1,
        musoTrackId: it.track?.id,
        title: it.track?.title,
        artists: (it.artists || []).map(a => a.name),
        album: it.album?.title || null,
        albumArt: it.album?.albumArt || null,
        year: it.releaseDate ? Number(String(it.releaseDate).slice(0, 4)) : null,
        releaseDate: it.releaseDate || null,
        isrcs: it.track?.isrcs || [],
        popularity: typeof it.track?.popularity === 'number' ? it.track.popularity : null,
        spotifyPreviewUrl: it.track?.spotifyPreviewUrl || null,
        roles: roles.length ? roles : ['Engineer']
      });
    });
    offset += page.length;
  }
  return { totalCount: total === Infinity ? items.length : total, items };
}

async function syncMuso({ profileId, force = false } = {}) {
  const apiKey = process.env.MUSO_API_KEY;
  if (!apiKey) {
    state.lastMusoError = null;
    return { ok: true, mode: 'snapshot', message: 'MUSO_API_KEY is not set. Serving the verified Muso snapshot.' };
  }
  const cache = readJson(FILES.musoCache, null);
  if (!force && cache && Date.now() - Date.parse(cache.syncedAt) < DAY) {
    return { ok: true, mode: 'api', message: 'Muso cache is fresh.', syncedAt: cache.syncedAt };
  }
  if (state.musoSyncing) return { ok: true, mode: 'api', message: 'Sync already running.' };
  state.musoSyncing = true;
  try {
    const { totalCount, items } = await fetchMusoCatalog(apiKey, profileId);
    if (!items.length) throw new Error('Muso returned no credits; keeping the previous catalog.');
    const syncedAt = new Date().toISOString();
    writeJson(FILES.musoCache, { source: 'muso-api', syncedAt, totalCount, items });
    state.catalog = null;
    state.lastMusoError = null;
    console.log(`[muso] synced ${items.length} of ${totalCount} credits`);
    return { ok: true, mode: 'api', syncedAt, count: items.length, totalCount };
  } catch (err) {
    state.lastMusoError = err.message;
    console.error('[muso] sync failed:', err.message);
    return { ok: false, mode: 'api', error: err.message };
  } finally {
    state.musoSyncing = false;
  }
}

function sourceData() {
  const cache = readJson(FILES.musoCache, null);
  if (cache && Array.isArray(cache.items) && cache.items.length) {
    return { mode: 'api', syncedAt: cache.syncedAt, totalCount: cache.totalCount, items: cache.items };
  }
  const snap = readJson(FILES.snapshot, { items: [] });
  return { mode: 'snapshot', syncedAt: snap.capturedAt, totalCount: snap.totalCount, items: snap.items };
}

// ---------- build ----------
function certWeight(c) {
  let w = 0;
  const riaa = c.certifications.riaa || '';
  if (/diamond/i.test(riaa)) w = 100;
  else if (/(\d+)×\s*platinum/i.test(riaa)) w = 20 + Number(riaa.match(/(\d+)×/)[1]);
  else if (/platinum/i.test(riaa)) w = 20;
  else if (/gold/i.test(riaa)) w = 10;
  if (c.certifications.grammy?.status === 'Grammy Winner') w += 6;
  else if (c.certifications.grammy) w += 2;
  return w;
}

function buildCatalog() {
  const src = sourceData();
  const overrides = readJson(FILES.overrides, {});
  const certs = readJson(FILES.certs, { byTrack: {} }).byTrack || {};
  const apple = readJson(FILES.apple, {});
  const covers = readJson(FILES.covers, {});
  const artOverrides = readJson(FILES.artOverrides, {}).byTrack || {};
  const aliases = overrides.artistAliases || {};
  const drop = new Set(overrides.dropArtists || []);
  const excludeIds = new Set(overrides.excludeTrackIds || []);
  const excludeRx = (overrides.excludeTitlePatterns || []).map(p => new RegExp(p, 'i'));
  const fixes = overrides.trackFixes || {};

  const credits = [];
  const seen = new Set();
  for (const raw of src.items) {
    if (!raw.musoTrackId || !raw.title) continue;
    if (excludeIds.has(raw.musoTrackId)) continue;
    const item = { ...raw, ...(fixes[raw.musoTrackId] || {}) };
    if (excludeRx.some(rx => rx.test(item.title) || rx.test(item.album || ''))) continue;
    const dupeKey = `${String(item.title).toLowerCase()}|${aliases[(item.artists || [])[0]] || (item.artists || [])[0]}|${item.year}`;
    if (seen.has(item.musoTrackId) || seen.has(dupeKey)) continue;
    seen.add(item.musoTrackId); seen.add(dupeKey);

    const artists = [...new Set((item.artists || []).map(a => aliases[a] || a).filter(a => !drop.has(a)))];
    const squash = s => String(s).toLowerCase().replace(/[^a-z0-9$]+/g, '');
    const titleFold = squash(item.title);
    const shown = artists.filter((a, i) => i === 0 || !titleFold.includes(squash(a)));
    const match = covers[item.musoTrackId]?.match || apple[item.musoTrackId]?.match || null;
    const manualArt = artOverrides[item.musoTrackId] || null;
    const c = {
      id: item.musoTrackId,
      title: item.title,
      artist: shown.join(', '),
      primaryArtist: artists[0] || '',
      album: item.album || match?.matchedAlbum || match?.appleCollection || '',
      year: item.year || null,
      roles: item.roles,
      role: displayRoles(item.roles),
      categories: roleCategories(item.roles),
      certifications: certs[item.musoTrackId] ? { riaa: certs[item.musoTrackId].riaa || null, grammy: certs[item.musoTrackId].grammy || null } : {},
      // Muso's own cover is the exact release linked to the credit, so it wins over search matches.
      artworkUrl: manualArt || item.albumArt || match?.artworkUrl || null,
      artSource: manualArt ? 'manual' : item.albumArt ? 'muso' : match?.artworkUrl ? (match.source || 'apple') : null,
      hasPreview: Boolean(match?.previewUrl || item.spotifyPreviewUrl),
      previewSource: match?.previewUrl || item.spotifyPreviewUrl || null,
      appleUrl: match?.appleUrl || null,
      listenUrl: match?.appleUrl || match?.deezerUrl || null,
      musoUrl: `https://muso.ai/track/${item.musoTrackId}`,
      // Internal ordering only. Never sent to the browser.
      _popularity: typeof item.popularity === 'number' ? item.popularity : 1000 - (item.rank || 999),
      _rank: item.rank || 999
    };
    c._coverSource = c.artworkUrl;
    if (c.artworkUrl && !c.artworkUrl.startsWith('/')) c.artworkUrl = `/api/cover/${c.id}`;
    c._certWeight = certWeight(c);
    credits.push(c);
  }
  // Tracks from the same release share a cover when only some of them matched.
  const albumArt = new Map();
  for (const c of credits) if (c._coverSource && c.album) albumArt.set(`${c.primaryArtist}|${coreAlbum(c.album)}`, c._coverSource);
  for (const c of credits) {
    if (c.artworkUrl || !c.album) continue;
    const shared = albumArt.get(`${c.primaryArtist}|${coreAlbum(c.album)}`);
    if (shared) { c._coverSource = shared; c.artworkUrl = shared.startsWith('/') ? shared : `/api/cover/${c.id}`; c.artSource = 'release'; }
  }
  credits.sort((x, y) => y._popularity - x._popularity || x._rank - y._rank);

  const years = credits.map(c => c.year).filter(Boolean);
  state.catalog = {
    mode: src.mode,
    syncedAt: src.syncedAt,
    totalCount: Math.max(src.totalCount || 0, credits.length),
    loadedCount: credits.length,
    firstYear: years.length ? Math.min(...years) : null,
    credits
  };
  return state.catalog;
}

function getCatalog() {
  return state.catalog || buildCatalog();
}

function publicCredit(c) {
  const { _popularity, _rank, _certWeight, _coverSource, previewSource, roles, primaryArtist, isrcs, ...rest } = c;
  return rest;
}

function query({ category = 'all', q = '', sort = 'popularity', limit, offset = 0 } = {}) {
  const cat = getCatalog();
  let list = cat.credits;
  if (category && category !== 'all') list = list.filter(c => c.categories.includes(category));
  const needle = String(q || '').trim().toLowerCase();
  if (needle) {
    list = list.filter(c => [c.title, c.artist, c.album, c.role, c.certifications.riaa, c.certifications.grammy?.status, c.year]
      .filter(Boolean).join(' ').toLowerCase().includes(needle));
  }
  const sorted = [...list];
  if (sort === 'recent') sorted.sort((a, b) => (b.year || 0) - (a.year || 0) || b._popularity - a._popularity);
  else if (sort === 'oldest') sorted.sort((a, b) => (a.year || 9999) - (b.year || 9999) || b._popularity - a._popularity);
  else if (sort === 'artist') sorted.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  else if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'certified') sorted.sort((a, b) => b._certWeight - a._certWeight || b._popularity - a._popularity);
  const counts = { all: cat.credits.length, mixing: 0, recording: 0, mastering: 0, production: 0, writing: 0 };
  cat.credits.forEach(c => c.categories.forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
  const start = Math.max(0, Number(offset) || 0);
  const page = limit ? sorted.slice(start, start + Number(limit)) : sorted.slice(start);
  return {
    mode: cat.mode,
    syncedAt: cat.syncedAt,
    totalCount: cat.totalCount,
    loadedCount: cat.loadedCount,
    matched: sorted.length,
    counts,
    credits: page.map(publicCredit)
  };
}

function highlights(limit = 16) {
  const cat = getCatalog();
  return cat.credits
    .filter(c => c._certWeight > 0)
    .sort((a, b) => b._certWeight - a._certWeight || b._popularity - a._popularity)
    .slice(0, limit)
    .map(publicCredit);
}

function findCover(id) {
  const c = getCatalog().credits.find(x => x.id === id);
  return c ? c._coverSource : null;
}

function findPreview(id) {
  const c = getCatalog().credits.find(x => x.id === id);
  return c ? c.previewSource : null;
}

function stats() {
  const cat = getCatalog();
  const certified = cat.credits.filter(c => c.certifications.riaa);
  const grammyAlbums = new Set(cat.credits.filter(c => c.certifications.grammy?.status === 'Grammy Winner').map(c => c.album.replace(/\s*\(.*\)$/, '')));
  const artists = new Set(cat.credits.map(c => c.primaryArtist));
  const streams = readJson(path.join(ROOT, 'data', 'streams.json'), {});
  return {
    spotifyStreams: streams.spotifyTotal || null,
    streamsAsOf: streams.asOf || null,
    certifiedUnits: certified.reduce((sum, c) => {
      const r = c.certifications.riaa;
      if (/diamond/i.test(r)) return sum + 10e6;
      const m = r.match(/(\d+)×\s*platinum/i);
      if (m) return sum + Number(m[1]) * 1e6;
      if (/platinum/i.test(r)) return sum + 1e6;
      if (/gold/i.test(r)) return sum + 5e5;
      return sum;
    }, 0),
    totalCount: cat.totalCount,
    firstYear: cat.firstYear,
    certifiedCount: certified.length,
    hasDiamond: certified.some(c => /diamond/i.test(c.certifications.riaa)),
    grammyWinningAlbums: grammyAlbums.size,
    artistCount: artists.size,
    mode: cat.mode,
    syncedAt: cat.syncedAt
  };
}

// ---------- cover art + preview enrichment (background, rate limited) ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function resolveCover(c, flags) {
  const credit = { title: c.title, primaryArtist: c.primaryArtist, album: c.album, year: c.year, isrcs: c.isrcs };
  if (!flags.deezerDown) {
    try {
      const m = await searchDeezer(credit);
      if (m) return m;
    } catch (err) {
      if (err.throttled) { await sleep(6000); return resolveCover(c, flags); }
      flags.deezerDown = true;
      state.enrich.lastError = err.message;
    }
  }
  if (!flags.appleDown) {
    try {
      await sleep(3200); // Apple allows roughly 20 searches a minute
      const m = await searchApple(credit);
      if (m) return { ...m, source: 'apple' };
    } catch (err) {
      flags.appleDown = true;
      state.enrich.lastError = err.message;
    }
  }
  if (flags.deezerDown && flags.appleDown) throw new Error('No cover source reachable');
  return null;
}

async function startEnrichment() {
  if (state.enrich.running || process.env.COVER_ENRICH === 'off' || process.env.APPLE_ENRICH === 'off') return;
  state.enrich.running = true;
  try {
    const cat = getCatalog();
    const cache = readJson(FILES.covers, {});
    const legacy = readJson(FILES.apple, {});
    const raw = new Map(sourceData().items.map(i => [i.musoTrackId, i]));
    const retryAfter = 7 * DAY;
    const todo = cat.credits.filter(c => {
      // Apple previews are AAC, which some browsers can't play, so try Deezer's MP3 for those too.
      const e = cache[c.id];
      if (!e) return true;
      if (e.match) return false;
      return Date.now() - Date.parse(e.checkedAt) > retryAfter;
    });
    state.enrich.queued = todo.length;
    state.enrich.done = 0;
    if (!todo.length) return;
    console.log(`[covers] matching artwork and previews for ${todo.length} credits`);
    const flags = {};
    for (const c of todo) {
      let match;
      try {
        match = await resolveCover({ ...c, isrcs: raw.get(c.id)?.isrcs || [] }, flags);
      } catch (err) {
        console.warn(`[covers] paused: ${err.message}`);
        break;
      }
      cache[c.id] = { checkedAt: new Date().toISOString(), match };
      state.enrich.done++;
      writeJson(FILES.covers, cache);
      state.catalog = null; // rebuild lazily with the new artwork
      await sleep(250); // Deezer allows 50 requests every 5 seconds
    }
    console.log(`[covers] done: ${state.enrich.done} of ${todo.length} checked`);
  } finally {
    state.enrich.running = false;
  }
}

function status() {
  const cat = getCatalog();
  return {
    mode: cat.mode,
    syncedAt: cat.syncedAt,
    totalCount: cat.totalCount,
    loadedCount: cat.loadedCount,
    musoApiConfigured: Boolean(process.env.MUSO_API_KEY),
    musoSyncing: state.musoSyncing,
    lastMusoError: state.lastMusoError,
    artwork: { ...state.enrich, matched: cat.credits.filter(c => c.artworkUrl).length, withPreview: cat.credits.filter(c => c.hasPreview).length }
  };
}

module.exports = { findCover, syncMuso, startEnrichment, getCatalog, query, highlights, findPreview, stats, status, buildCatalog, roleCategories };
