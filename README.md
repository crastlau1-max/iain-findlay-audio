# Iain Findlay

Portfolio, direct booking and live hub. Express on Node 18+, plain HTML/CSS/ES modules, no build step.

```
npm install
cp .env.example .env     # optional, the site runs in preview mode without keys
npm start                # http://localhost:3000
npm test
```

## Pages
- `/` hero with certified records, highlights marquee, discography console, booking, punch card, Studio Live
- `/credits` full catalog
- `/terms` booking, deposit, stem delivery and loyalty terms

## Credits pipeline (`lib/catalog.js`)
1. **Muso.ai, no API needed.** `data/muso-export.txt` holds every credit on the public Muso profile (257), read page by page from muso.ai: track id, title, artists, release date, roles and the release cover. `npm run import:muso` turns it into `data/muso-snapshot.json`, which the site serves. To refresh later, re-export the pages into that file and run the import again. If you ever add `MUSO_API_KEY`, the server syncs from the official API instead.
2. **Overrides.** `data/credit-overrides.json` fixes spelling (Muso lists many Kid Cudi tracks as "Kid Kudi"), merges legal names (Onika Maraj, Tauheed Epps), and excludes five "Release the Hounds" entries by other artists that Muso matched by title.
3. **Certifications.** `data/certifications.json` holds RIAA and Grammy recognition, each with a source link. Nothing is badged without an entry.
4. **Covers.** In order: a cover you set in `data/artwork-overrides.json` (URL or a file in `public/covers/`), then the release cover Muso links to the credit (640px from Spotify's image CDN), then Deezer, then Apple. Tracks from the same release share a cover.
5. **Previews.** Deezer first (free, no key), Apple as fallback, cached in `data/covers-cache.json`. Deezer preview links expire, so `/api/preview/:id` fetches a fresh one and caches the audio in `data/previews/`. Previews are served same origin so the deck's VU meters can read the signal.

`GET /api/credits/status` shows sync and matching progress.

## Booking
Rates live in `config/studio.json` as `rateCents` (e.g. `60000` for $600). While they are `null`, labels show `[$RATE]` and checkout runs in preview mode. Set `STRIPE_SECRET_KEY` and the rates to take real payments, and add the webhook in Stripe:

- Endpoint: `https://YOUR-DOMAIN/api/stripe/webhook`
- Event: `checkout.session.completed`
- Secret: `STRIPE_WEBHOOK_SECRET`

Deposits mark a booking `deposit_paid` in `data/bookings.json`. Create the balance payment link with `POST /api/booking/{bookingId}/balance` once the client approves the final mix. A booking counts toward loyalty when it is paid in full.

Also set `intake.dropboxUrl` in `config/studio.json` to your Dropbox file request link.

## Loyalty
Ten bookings paid in full open a 30 day window with 3 projects at 25% off service rates (`config/studio.json → loyalty`). Progress is stored in `data/clients.json`, keyed by billing email, and applied privately at checkout. There is no public lookup.

## Twitch
With `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`, live status and viewer count come from the Helix API. Without them, use the "Preview live state" switch in the Studio Live section to test the on air layout (hidden in production unless `ALLOW_STREAM_SIMULATION=1`).

## Hero image
`config/studio.json → heroImage`. Currently the studio room photo; drop a portrait into `public/assets/` and point this at it.
