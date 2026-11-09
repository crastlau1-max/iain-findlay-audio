'use strict';
// Deezer catalog: free, no key, 1000px covers (served here at 800x800) and 30 second previews.
// Uses the same strict matching rules as the Apple adapter.
const { pickBest, coreTitle, artistMatches } = require('./apple');

const API = 'https://api.deezer.com';

function toCandidate(t) {
  return {
    trackId: t.id,
    artistName: t.artist?.name,
    trackName: t.title,
    collectionName: t.album?.title,
    artworkUrl100: t.album?.cover_xl || t.album?.cover_big,
    previewUrl: t.preview || null,
    trackViewUrl: t.link,
    trackExplicitness: t.explicit_lyrics ? 'explicit' : 'clean'
  };
}

function size800(url) {
  return url ? url.replace(/\/\d+x\d+-(\d+-\d+-\d+-\d+\.jpg)$/, '/800x800-$1') : null;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'IainFindlayCatalog/2.1' } });
  if (res.status === 429) { const e = new Error('Deezer rate limited'); e.throttled = true; throw e; }
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const json = await res.json();
  if (json.error) {
    if (json.error.code === 4) { const e = new Error('Deezer quota exceeded'); e.throttled = true; throw e; }
    if (json.error.code === 800) return null; // no data
    throw new Error(`Deezer: ${json.error.message}`);
  }
  return json;
}

function shape(best) {
  if (!best) return null;
  return {
    source: 'deezer',
    deezerTrackId: best.appleTrackId,
    artworkUrl: size800(best.artworkUrl),
    previewUrl: best.previewUrl ? `deezer:${best.appleTrackId}` : null, // Deezer preview links expire, resolved fresh at play time
    appleUrl: null,
    deezerUrl: best.appleUrl,
    matchedAlbum: best.appleCollection
  };
}

async function searchDeezer(credit, { fetchImpl = fetch } = {}) {
  // 1. Exact ISRC lookup when Muso gave us one.
  for (const isrc of credit.isrcs || []) {
    const t = await getJson(`${API}/track/isrc:${encodeURIComponent(isrc)}`, fetchImpl);
    if (t && t.id && artistMatches(credit.primaryArtist, t.artist?.name)) {
      const c = toCandidate(t);
      return shape({ appleTrackId: c.trackId, artworkUrl: c.artworkUrl100, previewUrl: c.previewUrl, appleUrl: c.trackViewUrl, appleCollection: c.collectionName });
    }
  }
  // 2. Search, then strict artist, title and album matching.
  const q = `${credit.primaryArtist} ${coreTitle(credit.title)}`;
  const json = await getJson(`${API}/search?q=${encodeURIComponent(q)}&limit=25`, fetchImpl);
  const candidates = (json?.data || []).map(toCandidate);
  // Deezer search results carry no release date, so the year check is skipped.
  return shape(pickBest({ ...credit, year: null }, candidates));
}

async function freshPreview(deezerTrackId, { fetchImpl = fetch } = {}) {
  const t = await getJson(`${API}/track/${encodeURIComponent(deezerTrackId)}`, fetchImpl);
  return t?.preview || null;
}

module.exports = { searchDeezer, freshPreview, size800 };
