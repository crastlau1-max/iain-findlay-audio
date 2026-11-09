'use strict';
// Live status for twitch.tv/alrightiain. Uses the Helix API when credentials exist,
// otherwise a simulated state that can be toggled for demos.
const state = {
  simulated: { live: false, viewers: 0, title: 'Live mixing session', startedAt: null },
  token: null,
  tokenExpires: 0,
  cache: null,
  cacheAt: 0
};

const hasCreds = () => Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);

async function appToken() {
  if (state.token && Date.now() < state.tokenExpires - 60000) return state.token;
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, client_secret: process.env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' })
  });
  if (!res.ok) throw new Error(`Twitch auth ${res.status}`);
  const json = await res.json();
  state.token = json.access_token;
  state.tokenExpires = Date.now() + json.expires_in * 1000;
  return state.token;
}

async function status(channel) {
  if (!hasCreds() || state.simulated.forced) {
    const s = state.simulated;
    return { channel, source: 'simulated', live: s.live, viewers: s.live ? s.viewers : 0, title: s.title, startedAt: s.startedAt, canSimulate: true };
  }
  if (state.cache && Date.now() - state.cacheAt < 60000) return state.cache;
  try {
    const token = await appToken();
    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`, {
      headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Twitch streams ${res.status}`);
    const json = await res.json();
    const s = json.data && json.data[0];
    state.cache = { channel, source: 'twitch', live: Boolean(s), viewers: s ? s.viewer_count : 0, title: s ? s.title : null, startedAt: s ? s.started_at : null, canSimulate: true };
  } catch (err) {
    state.cache = { channel, source: 'error', live: false, viewers: 0, error: err.message, canSimulate: true };
  }
  state.cacheAt = Date.now();
  return state.cache;
}

function simulate({ live, viewers }) {
  const s = state.simulated;
  s.live = Boolean(live);
  s.forced = s.live; // a simulated live state overrides the real API until switched off
  s.viewers = Number.isFinite(Number(viewers)) ? Math.max(0, Math.round(Number(viewers))) : 1 + Math.floor(Math.random() * 400);
  s.startedAt = s.live ? new Date().toISOString() : null;
  state.cache = null;
}

module.exports = { status, simulate };
