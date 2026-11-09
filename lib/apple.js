'use strict';
// Apple Music catalog matching for artwork (800x800) and 30 second previews.
// Matching is deliberately strict: a wrong cover or a bootleg is worse than the vinyl fallback.

const EDITION_WORDS = /\b(deluxe|expanded|edition|version|remaster(ed)?|anniversary|bonus|tracks?|explicit|clean|complete|special|extended|vol|volume|\d{4})\b/g;
const JUNK_COLLECTIONS = /karaoke|tribute|originally performed|in the style of|made famous|cover version|lullaby|8.?bit|piano (version|tribute)|string quartet|workout|instrumental version|backing track/i;

function fold(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/&/g, ' and ');
}

// Strip featured artist credits and punctuation, keep remix and version descriptors.
function coreTitle(title) {
  return fold(title)
    .replace(/\s*[([](feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+(feat\.?|ft\.?|featuring|with)\s.*$/g, '')
    .replace(/\s*[([](explicit|clean|album)( version)?[)\]]/g, '')
    .replace(/\s+-\s+(explicit|clean)( version)?$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function coreAlbum(album) {
  return fold(album)
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\s+-\s+(single|ep)$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function albumRelation(musoAlbum, appleCollection) {
  const a = coreAlbum(musoAlbum);
  const b = coreAlbum(appleCollection);
  if (!a || !b) return 'unknown';
  if (a === b) return 'exact';
  const strip = s => s.replace(EDITION_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (strip(a) === strip(b)) return 'edition';
  // Anything else, including "Speedin' Bullet 2 Heaven 2" vs "Speedin' Bullet 2 Heaven", is a different release.
  return 'different';
}

function artistMatches(primaryArtist, appleArtist) {
  const p = fold(primaryArtist).replace(/[^a-z0-9]+/g, ' ').trim();
  const a = fold(appleArtist).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!p || !a) return false;
  return a === p || a.startsWith(p + ' ') || a.includes(' ' + p + ' ') || a.endsWith(' ' + p) || a.split(/ and | x /).map(s => s.trim()).includes(p);
}

function upscaleArtwork(url) {
  if (!url) return null;
  return url.replace(/\/[0-9]+x[0-9]+(bb|cc|-\d+)?\.(jpg|jpeg|png|webp)$/i, '/800x800bb.jpg');
}

/**
 * Score Apple search results against one credit. Returns the best candidate or null.
 * credit: { title, primaryArtist, album, year }
 */
function pickBest(credit, results) {
  const wantTitle = coreTitle(credit.title);
  let best = null;
  for (const r of results || []) {
    if (r.wrapperType && r.wrapperType !== 'track') continue;
    if (r.kind && r.kind !== 'song') continue;
    if (!artistMatches(credit.primaryArtist, r.artistName)) continue;
    if (coreTitle(r.trackName) !== wantTitle) continue;
    if (JUNK_COLLECTIONS.test(r.collectionName || '') && !JUNK_COLLECTIONS.test(credit.album || '')) continue;

    const rel = albumRelation(credit.album, r.collectionName);
    const year = r.releaseDate ? new Date(r.releaseDate).getUTCFullYear() : null;
    const yearGap = credit.year && year ? Math.abs(credit.year - year) : 0;

    let score = 10;
    if (rel === 'exact') score += 6;
    else if (rel === 'edition') score += 4;
    else if (rel === 'different') {
      // Same song released as a single is fine, a different album is not.
      const isSingle = coreAlbum(r.collectionName) === wantTitle;
      if (!isSingle) continue;
      score += 1;
    }
    if (yearGap > 2) continue;
    score -= yearGap;
    if (r.trackExplicitness === 'explicit') score += 0.5;
    if (r.previewUrl) score += 0.5;

    if (!best || score > best.score) best = { score, r };
  }
  if (!best) return null;
  const r = best.r;
  return {
    appleTrackId: r.trackId,
    artworkUrl: upscaleArtwork(r.artworkUrl100 || r.artworkUrl60),
    previewUrl: r.previewUrl || null,
    appleUrl: r.trackViewUrl || null,
    appleCollection: r.collectionName,
    durationMs: r.trackTimeMillis || null
  };
}

async function searchApple(credit, { fetchImpl = fetch, country = 'us' } = {}) {
  const term = `${credit.primaryArtist} ${coreTitle(credit.title)}`;
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', limit: '25', country })}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'IainFindlayCatalog/2.0' } });
  if (res.status === 403 || res.status === 429) {
    const err = new Error(`Apple search throttled (${res.status})`);
    err.throttled = true;
    throw err;
  }
  if (!res.ok) throw new Error(`Apple search failed (${res.status})`);
  const json = await res.json();
  return pickBest(credit, json.results);
}

module.exports = { searchApple, pickBest, coreTitle, coreAlbum, albumRelation, artistMatches, upscaleArtwork };
