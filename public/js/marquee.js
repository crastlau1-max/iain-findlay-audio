// Continuous highlights marquee. JS driven so it can pause on hover and resume without a jump.
import { el, artwork, badges, icons } from './lib.js';
import * as player from './player.js';

export function mountMarquee(root, credits) {
  if (!credits.length) { root.closest('.marquee-band')?.remove(); return; }
  const track = el('div', { class: 'marquee-track' });
  const make = c => {
    const item = el('button', { class: 'mq-item', type: 'button', dataset: { id: c.id }, 'aria-label': `Play ${c.title} by ${c.artist}` },
      artwork(c.artworkUrl, ''),
      el('div', { class: 'txt' }, el('div', { class: 't' }, c.title), el('div', { class: 'a' }, c.artist), badges(c, { max: 1 }))
    );
    item.addEventListener('click', () => player.play(c));
    return item;
  };
  // Two copies make the loop seamless; the second copy is hidden from assistive tech.
  const a = el('div', { style: 'display:flex;gap:14px' }, credits.map(make));
  const b = el('div', { style: 'display:flex;gap:14px', 'aria-hidden': 'true' }, credits.map(make));
  b.querySelectorAll('button').forEach(x => x.tabIndex = -1);
  track.append(a, b);
  root.replaceChildren(track);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let x = 0, last = performance.now(), paused = false, speed = 34; // px per second
  root.addEventListener('mouseenter', () => paused = true);
  root.addEventListener('mouseleave', () => paused = false);
  root.addEventListener('focusin', () => paused = true);
  root.addEventListener('focusout', () => paused = false);
  if (reduce) root.style.overflowX = 'auto';
  const tick = now => {
    const dt = Math.min(64, now - last); last = now;
    if (!paused && !reduce) {
      const w = a.getBoundingClientRect().width + 14;
      x -= speed * dt / 1000;
      if (-x >= w) x += w;
      track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  player.onChange(({ id, playing }) => {
    root.querySelectorAll('.mq-item').forEach(n => n.classList.toggle('is-playing', playing && n.dataset.id === id));
  });
}
