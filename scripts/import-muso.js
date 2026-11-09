'use strict';
// Converts data/muso-export.txt (read from the public Muso.ai profile) into data/muso-snapshot.json.
// Run: npm run import:muso
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'muso-export.txt');
const OUT = path.join(ROOT, 'data', 'muso-snapshot.json');

// Release names confirmed on each track's Muso page, keyed by the release's cover id.
const RELEASES = {
  '4d3fa5ce7ba599f4fd7803ef': 'Funk Wav Bounces Vol.1',
  '0a1d20ec09cab4bb17a36aab': 'F.A.M.E. (Expanded Edition)',
  '781583ade2f00c2966a35965': 'Fortune (Expanded Edition)',
  'bbf99eb282ff165289120b1e': 'INSANO',
  'eedc04a9294e9fedb40432ec': 'HAVE U BN 2 HEAVEN @ NITE?',
  'b9ab5cc935d2327a7d2bc629': 'Indicud',
  'c3af0c2355c24ed7023cd394': 'Sweetener',
  'ef3b5a279ee075749b67e0a7': 'The Boy Who Flew To The Moon (Vol. 1)',
  '2cc72b6f465812679b803638': 'I Still Am',
  'cce6bab1f59b165133175d88': 'Witness (Deluxe)',
  'bf5af474b6ed745faf53f508': 'Ugly is Beautiful',
  'ccb8c3d258935e9447b9aca4': 'Rake It Up (Diplo & Party Favor Remix)',
  '54af704660da237389843021': "'97",
  'af0aff7f601df9ed6d2d531d': 'Under The Mistletoe (Deluxe Edition)',
  '6ff25c2481eeaf6e7284d461': 'Man On The Moon III: The Chosen'
};

const DATE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}$/;

function normRoles(tokens) {
  const set = new Set(tokens);
  const out = [];
  for (const t of tokens) {
    if (t === 'Mixing') out.push('Mixing Engineer');
    else if (t === 'Mastering') out.push('Mastering Engineer');
    else if (t === 'Engineer' && (set.has('Mixing') || set.has('Mastering'))) continue;
    else out.push(t);
  }
  return [...new Set(out)];
}

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
const items = [];
lines.forEach((line, i) => {
  const parts = line.split('|');
  const id = parts[0].trim();
  const img = parts[parts.length - 1].replace(/^IMG:/, '').trim();
  const body = parts.slice(1, -1);
  const di = body.findIndex(p => DATE.test(p.trim()));
  if (di < 2) throw new Error(`Line ${i + 1}: could not find the release date`);
  const title = body[0].trim();
  const artists = body.slice(1, di).map(a => a.replace(/,\s*$/, '').trim()).filter(Boolean);
  const date = new Date(`${body[di].trim()} 12:00 UTC`);
  const roles = normRoles(body.slice(di + 1).map(r => r.trim()).filter(Boolean));
  const hash = /^https?:/.test(img) ? null : img;
  items.push({
    rank: i + 1,
    musoTrackId: id,
    title,
    artists,
    album: (hash && RELEASES[hash]) || '',
    albumArt: hash ? `https://i.scdn.co/image/ab67616d0000b273${hash}` : (img || null),
    releaseDate: date.toISOString().slice(0, 10),
    year: date.getUTCFullYear(),
    roles
  });
});

const snapshot = {
  source: 'https://muso.ai/profile/fb595b26-5c7a-422a-8e1a-fac8ca9971e2/credits?sort=popularity&direction=DESC',
  capturedAt: new Date().toISOString(),
  note: 'Every credit on the public Muso.ai profile, in Muso popularity order. Covers are the release artwork Muso links to each credit. Regenerate with npm run import:muso.',
  totalCount: items.length,
  items
};
fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Imported ${items.length} credits into data/muso-snapshot.json`);
