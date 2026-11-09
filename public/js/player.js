// Persistent transport deck: one <audio>, Web Audio stereo metering at display rate,
// transform-only animation (scaleX / translateX) so nothing triggers layout.
import { $, el, icons, artwork, toast } from './lib.js';

const listeners = new Set();
const state = { credit: null, playing: false, ctx: null, analysers: null, connected: false, raf: 0, levels: [0, 0], peaks: [0, 0], peakHold: [0, 0], dragging: false };

const audio = new Audio();
audio.preload = 'none';
audio.crossOrigin = 'anonymous'; // previews are served same origin by /api/preview

let deck, refs;

function build() {
  deck = el('div', { class: 'deck', role: 'region', 'aria-label': 'Audio preview player' });
  deck.innerHTML = `
    <div class="wrap deck-inner">
      <div class="deck-track"><div class="art-slot"></div><div style="min-width:0"><div class="t"></div><div class="a"></div></div></div>
      <button class="deck-play" type="button" aria-label="Play">${icons.play}</button>
      <div class="scrub">
        <span class="cur">0:00</span>
        <div class="scrub-bar" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="30" aria-valuenow="0" tabindex="0">
          <div class="rail"><div class="fill"></div></div><div class="head"></div>
        </div>
        <span class="dur">0:30</span>
      </div>
      <div class="vu" aria-hidden="true">
        <div class="vu-ch"><span>L</span><div class="vu-meter"><div class="vu-level"></div><div class="vu-peak"></div></div></div>
        <div class="vu-ch"><span>R</span><div class="vu-meter"><div class="vu-level"></div><div class="vu-peak"></div></div></div>
      </div>
      <div class="deck-actions">
        <a class="deck-icon open-link" target="_blank" rel="noopener" aria-label="Open this record">${icons.out}</a>
        <button class="deck-icon close" type="button" aria-label="Close player">${icons.close}</button>
      </div>
    </div>`;
  document.body.append(deck);
  refs = {
    art: $('.art-slot', deck), t: $('.t', deck), a: $('.a', deck), play: $('.deck-play', deck),
    cur: $('.cur', deck), dur: $('.dur', deck), bar: $('.scrub-bar', deck), fill: $('.fill', deck), head: $('.head', deck),
    levels: [...deck.querySelectorAll('.vu-level')], peaks: [...deck.querySelectorAll('.vu-peak')], meters: [...deck.querySelectorAll('.vu-meter')],
    link: $('.open-link', deck), close: $('.close', deck)
  };
  refs.play.addEventListener('click', () => toggle());
  refs.close.addEventListener('click', close);
  bindScrub();
}

function fmt(s) {
  if (!Number.isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ensureAudioGraph() {
  if (state.connected) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    state.ctx = new Ctx();
    const src = state.ctx.createMediaElementSource(audio);
    const split = state.ctx.createChannelSplitter(2);
    const mk = () => { const a = state.ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0; return a; };
    state.analysers = [mk(), mk()];
    src.connect(state.ctx.destination);
    src.connect(split);
    state.mono = state.ctx.createAnalyser(); state.mono.fftSize = 2048; state.mono.smoothingTimeConstant = 0.6;
    src.connect(state.mono);
    split.connect(state.analysers[0], 0);
    split.connect(state.analysers[1], 1);
    state.buf = new Float32Array(1024);
    state.connected = true;
  } catch (err) {
    console.warn('Metering unavailable:', err);
  }
}

// Peak program style ballistics: quick rise, slow fall, peak hold.
function frame(now) {
  state.raf = requestAnimationFrame(frame);
  const dur = audio.duration || 30;
  if (!state.dragging) {
    const p = Math.min(1, (audio.currentTime || 0) / dur);
    refs.fill.style.transform = `scaleX(${p})`;
    refs.head.style.transform = `translateX(${p * refs.bar.clientWidth}px)`;
    refs.cur.textContent = fmt(audio.currentTime);
  }
  for (let ch = 0; ch < 2; ch++) {
    let target = 0;
    if (state.analysers && state.playing) {
      state.analysers[ch].getFloatTimeDomainData(state.buf);
      let sum = 0, peak = 0;
      for (let i = 0; i < state.buf.length; i++) { const v = state.buf[i]; sum += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
      const rms = Math.sqrt(sum / state.buf.length);
      const db = 20 * Math.log10(Math.max(rms * 0.6 + peak * 0.4, 1e-5));
      target = Math.min(1, Math.max(0, (db + 48) / 48)); // -48 dBFS to 0 dBFS
    }
    const cur = state.levels[ch];
    state.levels[ch] = target > cur ? cur + (target - cur) * 0.6 : cur + (target - cur) * 0.08;
    if (state.levels[ch] >= state.peaks[ch]) { state.peaks[ch] = state.levels[ch]; state.peakHold[ch] = now; }
    else if (now - state.peakHold[ch] > 900) state.peaks[ch] = Math.max(0, state.peaks[ch] - 0.012);
    refs.levels[ch].style.transform = `scaleX(${state.levels[ch].toFixed(4)})`;
    refs.peaks[ch].style.transform = `translateX(${(state.peaks[ch] * refs.meters[ch].clientWidth).toFixed(1)}px)`;
  }
  if (!state.playing && state.levels[0] < 0.002 && state.levels[1] < 0.002 && state.peaks[0] < 0.002 && state.peaks[1] < 0.002) {
    cancelAnimationFrame(state.raf); state.raf = 0;
  }
}
function loop() { if (!state.raf) state.raf = requestAnimationFrame(frame); }

function bindScrub() {
  const seekTo = clientX => {
    const r = refs.bar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    refs.fill.style.transform = `scaleX(${p})`;
    refs.head.style.transform = `translateX(${p * r.width}px)`;
    return p;
  };
  refs.bar.addEventListener('pointerdown', e => {
    if (!state.credit) return;
    state.dragging = true; refs.bar.classList.add('dragging'); refs.bar.setPointerCapture(e.pointerId); seekTo(e.clientX);
  });
  refs.bar.addEventListener('pointermove', e => { if (state.dragging) seekTo(e.clientX); });
  refs.bar.addEventListener('pointerup', e => {
    if (!state.dragging) return;
    const p = seekTo(e.clientX);
    state.dragging = false; refs.bar.classList.remove('dragging');
    if (Number.isFinite(audio.duration)) audio.currentTime = p * audio.duration;
    loop();
  });
  refs.bar.addEventListener('keydown', e => {
    if (!Number.isFinite(audio.duration)) return;
    if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
    loop();
  });
}

function setUI(credit) {
  refs.art.replaceChildren(artwork(credit.artworkUrl, ''));
  refs.t.textContent = credit.title;
  refs.a.textContent = credit.artist;
  refs.link.href = credit.listenUrl || credit.musoUrl;
  refs.link.setAttribute('aria-label', credit.listenUrl ? 'Listen to the full record' : 'Open on Muso.ai');
  refs.cur.textContent = '0:00';
  refs.dur.textContent = '0:30';
}

function emit() { listeners.forEach(fn => fn({ id: state.credit?.id || null, playing: state.playing })); }

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// Time domain samples for visuals. Returns false when nothing is playing.
export function waveform(buf) {
  if (!state.mono || !state.playing) return false;
  state.mono.getFloatTimeDomainData(buf);
  return true;
}

export const current = () => ({ id: state.credit?.id || null, playing: state.playing });

export async function play(credit) {
  if (!deck) build();
  if (state.credit && state.credit.id === credit.id) return toggle();
  state.credit = credit;
  setUI(credit);
  deck.classList.add('open');
  document.body.classList.add('deck-open');
  if (!credit.hasPreview) {
    audio.pause(); audio.removeAttribute('src'); state.playing = false;
    refs.play.disabled = true;
    toast('No preview for this record yet. Use the link in the player to hear it.');
    emit();
    return;
  }
  refs.play.disabled = false;
  ensureAudioGraph();
  if (state.ctx && state.ctx.state === 'suspended') state.ctx.resume();
  audio.src = `/api/preview/${encodeURIComponent(credit.id)}`;
  try {
    await audio.play();
  } catch (err) {
    if (err.name !== 'AbortError') fail();
  }
}

export function toggle() {
  if (!state.credit || !audio.src) return;
  if (audio.paused) { state.ctx?.resume(); audio.play().catch(() => fail()); }
  else audio.pause();
}

function fail() {
  state.playing = false;
  refs.play.disabled = true;
  refs.play.innerHTML = icons.play;
  toast('That preview could not be loaded. Use the link in the player to hear the record.');
  emit();
}

export function close() {
  audio.pause();
  deck.classList.remove('open');
  document.body.classList.remove('deck-open');
  state.credit = null; state.playing = false;
  emit();
}

audio.addEventListener('play', () => { state.playing = true; refs.play.innerHTML = icons.pause; refs.play.setAttribute('aria-label', 'Pause'); loop(); emit(); });
audio.addEventListener('pause', () => { state.playing = false; refs.play.innerHTML = icons.play; refs.play.setAttribute('aria-label', 'Play'); emit(); });
audio.addEventListener('ended', () => { state.playing = false; refs.play.innerHTML = icons.play; emit(); });
audio.addEventListener('loadedmetadata', () => { refs.dur.textContent = fmt(audio.duration); refs.bar.setAttribute('aria-valuemax', Math.round(audio.duration)); });
audio.addEventListener('timeupdate', () => refs.bar.setAttribute('aria-valuenow', Math.round(audio.currentTime)));
audio.addEventListener('error', () => { if (audio.getAttribute('src')) fail(); });

document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || !state.credit) return;
  if (e.target.closest('input, textarea, select, button, [role="slider"], dialog')) return;
  e.preventDefault(); toggle();
});
