'use strict';
// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { pickBest, coreTitle, albumRelation } = require('../lib/apple');

const base = { wrapperType: 'track', kind: 'song', previewUrl: 'https://audio-ssl.itunes.apple.com/x.m4a', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg' };

test('strips featured credits but keeps remix descriptors', () => {
  assert.equal(coreTitle('Look At Me Now (feat. Lil\' Wayne & Busta Rhymes)'), 'look at me now');
  assert.equal(coreTitle('GET OFF ME (with Travis Scott)'), 'get off me');
  assert.equal(coreTitle('Rake It Up - Diplo & Party Favor Remix'), 'rake it up diplo and party favor remix');
});

test('rejects bootleg sequel albums', () => {
  assert.equal(albumRelation("Speedin' Bullet 2 Heaven", "Speedin' Bullet 2 Heaven 2"), 'different');
  assert.equal(albumRelation('F.A.M.E. (Expanded Edition)', 'F.A.M.E. (Deluxe Version)'), 'exact');
  assert.equal(albumRelation('Witness (Deluxe)', 'Witness: The Tour Edition'), 'different');
});

test('picks the real Kid Cudi release over a bootleg', () => {
  const credit = { title: "Speedin' Bullet 2 Heaven", primaryArtist: 'Kid Cudi', album: "Speedin' Bullet 2 Heaven", year: 2015 };
  const results = [
    { ...base, trackId: 1, artistName: 'Kid Cudi', trackName: "Speedin' Bullet 2 Heaven", collectionName: "Speedin' Bullet 2 Heaven 2", releaseDate: '2021-01-01T00:00:00Z' },
    { ...base, trackId: 2, artistName: 'Kid Cudi', trackName: "Speedin' Bullet 2 Heaven", collectionName: "Speedin' Bullet 2 Heaven", releaseDate: '2015-12-04T00:00:00Z' }
  ];
  assert.equal(pickBest(credit, results).appleTrackId, 2);
});

test('rejects karaoke and wrong artists, upsizes artwork to 800', () => {
  const credit = { title: 'Swish Swish', primaryArtist: 'Katy Perry', album: 'Witness (Deluxe)', year: 2017 };
  const results = [
    { ...base, trackId: 1, artistName: 'Karaoke Stars', trackName: 'Swish Swish', collectionName: 'Karaoke Hits 2017' },
    { ...base, trackId: 2, artistName: 'Katy Perry', trackName: 'Swish Swish (Karaoke Version)', collectionName: 'Swish Swish (In the Style of Katy Perry)' },
    { ...base, trackId: 3, artistName: 'Katy Perry & Nicki Minaj', trackName: 'Swish Swish (feat. Nicki Minaj)', collectionName: 'Witness (Deluxe)', releaseDate: '2017-06-09T00:00:00Z' }
  ];
  const m = pickBest(credit, results);
  assert.equal(m.appleTrackId, 3);
  assert.match(m.artworkUrl, /800x800bb\.jpg$/);
});

test('returns null when nothing is a confident match', () => {
  const credit = { title: 'Immortal', primaryArtist: 'Kid Cudi', album: 'Indicud', year: 2013 };
  const results = [{ ...base, trackId: 9, artistName: 'Kid Cudi', trackName: 'Immortal', collectionName: 'Some Compilation', releaseDate: '2019-01-01T00:00:00Z' }];
  assert.equal(pickBest(credit, results), null);
});
