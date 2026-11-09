'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseKworb, sumCredits } = require('../lib/streams');

const html = `<table><tr><th>Song Title</th><th>Streams</th><th>Daily</th></tr>
<tr><td class="text"><div><a href="https://open.spotify.com/track/4kn" target="_blank">Rake It Up (feat. Nicki Minaj)</a></div></td><td>404,685,849</td><td>40,712</td></tr>
<tr><td class="text"><div>* <a href="https://open.spotify.com/track/2nB" target="_blank">Champions</a></div></td><td>325,634,834</td><td>36,573</td></tr>
<tr><td class="text"><div><a href="x">Rake It Up - Diplo &amp; Party Favor Remix</a></div></td><td>54,467,048</td><td>4,464</td></tr></table>`;

test('parses kworb rows and sums only credited tracks', () => {
  const rows = parseKworb(html);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].title, 'Champions');
  const s = sumCredits(rows, [{ title: 'Rake It Up (feat. Nicki Minaj)' }, { title: 'Rake It Up - Diplo & Party Favor Remix' }, { title: 'Not On Page' }]);
  assert.equal(s.streams, 404685849 + 54467048);
  assert.equal(s.matched, 2);
});
