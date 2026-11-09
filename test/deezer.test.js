'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { searchDeezer } = require('../lib/deezer');

const resp = body => async () => ({ ok: true, status: 200, json: async () => body });
const track = (id, artist, title, album) => ({ id, title, link: `https://www.deezer.com/track/${id}`, explicit_lyrics: true, preview: 'https://cdnt-preview.dzcdn.net/x.mp3', artist: { name: artist }, album: { title: album, cover_xl: `https://cdn-images.dzcdn.net/images/cover/${id}/1000x1000-000000-80-0-0.jpg` } });

test('matches the album version, sizes cover to 800 and defers the preview', async () => {
  const fetchImpl = resp({ data: [
    track(1, 'Chris Brown', 'Beautiful People (feat. Benny Benassi) (Radio Edit)', 'Electroman'),
    track(2, 'Chris Brown', "Look At Me Now (feat. Lil' Wayne & Busta Rhymes)", 'F.A.M.E. (Expanded Edition)')
  ] });
  const m = await searchDeezer({ title: "Look At Me Now (feat. Lil' Wayne & Busta Rhymes)", primaryArtist: 'Chris Brown', album: 'F.A.M.E. (Expanded Edition)' }, { fetchImpl });
  assert.equal(m.deezerTrackId, 2);
  assert.match(m.artworkUrl, /\/800x800-000000-80-0-0\.jpg$/);
  assert.equal(m.previewUrl, 'deezer:2');
});

test('ignores explicit version labels and rejects radio edits on other releases', async () => {
  const fetchImpl = resp({ data: [track(3, 'Kid Cudi', 'Just What I Am (Explicit Version)', 'Indicud')] });
  const m = await searchDeezer({ title: 'Just What I Am', primaryArtist: 'Kid Cudi', album: 'Indicud' }, { fetchImpl });
  assert.equal(m.deezerTrackId, 3);
  const none = await searchDeezer({ title: 'Beautiful People', primaryArtist: 'Chris Brown', album: 'F.A.M.E. (Expanded Edition)' }, { fetchImpl: resp({ data: [track(1, 'Chris Brown', 'Beautiful People (feat. Benny Benassi) (Radio Edit)', 'Electroman')] }) });
  assert.equal(none, null);
});
