'use strict';
// Manual sync: node scripts/sync-credits.js
// Pulls every credit from the Muso.ai API (needs MUSO_API_KEY in .env), then matches Apple artwork and previews.
const path = require('path');
require('../lib/store').loadEnv(path.join(__dirname, '..', '.env'));
const catalog = require('../lib/catalog');
const { musoProfileId } = require('../config/studio.json');

(async () => {
  const res = await catalog.syncMuso({ profileId: musoProfileId, force: true });
  console.log(res.message || res.error || `Synced ${res.count} of ${res.totalCount} credits.`);
  await catalog.startEnrichment();
  const s = catalog.status();
  console.log(`Catalog: ${s.loadedCount} credits loaded (${s.mode}). Artwork: ${s.artwork.matched}. Previews: ${s.artwork.withPreview}.`);
})();
