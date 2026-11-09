// Discography console: role tabs, live search, sort, click to audition.
import { $, $$, el, api, icons, artwork, badges, formatDate } from './lib.js';
import * as player from './player.js';

const TABS = [
  ['all', 'All'],
  ['mixing', 'Mixing'],
  ['recording', 'Recording'],
  ['mastering', 'Mastering'],
  ['production', 'Production'],
  ['writing', 'Songwriting']
];

export function mountConsole(root, { bounded = true, pageSize = null } = {}) {
  const state = { category: 'all', q: '', sort: 'popularity', data: null, req: 0 };
  root.classList.add('console');
  if (!bounded) root.classList.add('unbounded');
  root.innerHTML = `
    <div class="console-head">
    <div class="console-bar">
      <div class="tabs" role="tablist" aria-label="Filter by role"></div>
      <div class="console-tools">
        <label class="field-search"><span class="sr-only">Search credits</span>${icons.search}<input class="input" type="search" placeholder="Search artist, song or album" autocomplete="off"></label>
        <label><span class="sr-only">Sort</span>
          <select class="select">
            <option value="popularity">Sort: Muso.ai popularity</option>
            <option value="certified">Sort: Certifications</option>
            <option value="recent">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
            <option value="artist">Sort: Artist A to Z</option>
            <option value="title">Sort: Title A to Z</option>
          </select>
        </label>
      </div>
    </div>
    <div class="col-head" aria-hidden="true"><span>#</span><span></span><span>Title</span><span class="c-al">Release</span><span>Role</span><span>Year</span><span></span></div>
    </div>
    <div class="console-scroll" tabindex="-1"><ul class="rows" aria-live="polite"></ul></div>`;

  const tabs = $('.tabs', root);
  TABS.forEach(([id, label]) => {
    tabs.append(el('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(id === 'all'), dataset: { cat: id }, onclick: () => { state.category = id; $$('.tab', tabs).forEach(t => t.setAttribute('aria-selected', String(t.dataset.cat === id))); load(); } },
      label, el('span', { class: 'n' }, '')));
  });
  let debounce;
  $('input', root).addEventListener('input', e => { clearTimeout(debounce); debounce = setTimeout(() => { state.q = e.target.value; load(); }, 140); });
  $('select', root).addEventListener('change', e => { state.sort = e.target.value; load(); });

  const list = $('.rows', root);
  const scroller = $('.console-scroll', root);

  function render() {
    const { credits, counts, matched, loadedCount, totalCount, mode } = state.data;
    $$('.tab', tabs).forEach(t => { t.querySelector('.n').textContent = counts[t.dataset.cat] ?? 0; });
    list.replaceChildren();
    if (!credits.length) {
      const msg = state.q ? `Nothing matches “${state.q}”.` : 'No credits in this category in the current sync yet.';
      list.append(el('li', { class: 'rows-empty' }, msg));
      return;
    }
    const nowId = player.current().id;
    const nowPlaying = player.current().playing;
    credits.forEach((c, i) => {
      const playing = c.id === nowId && nowPlaying;
      const row = el('li', { class: `row${playing ? ' is-playing' : ''}${c.hasPreview ? '' : ' no-preview'}`, dataset: { id: c.id }, tabindex: '0', 'aria-label': `${c.title} by ${c.artist}` },
        el('span', { class: 'idx' }, String(i + 1)),
        artwork(c.artworkUrl, ''),
        el('div', { style: 'min-width:0' }, c.certifications?.riaa || c.certifications?.grammy ? badges(c) : '', el('div', { class: 't', title: c.title }, c.title), el('div', { class: 'a' }, c.artist)),
        el('div', { class: 'al', title: c.album }, c.album),
        el('div', { class: 'ro', title: c.role }, c.role),
        el('div', { class: 'yr' }, c.year || ''),
        el('button', { class: 'play-btn', type: 'button', 'aria-label': `${playing ? 'Pause' : 'Play'} preview of ${c.title}`, html: playing ? icons.pause : icons.play })
      );
      row._credit = c;
      list.append(row);
    });
    if (false) {
      list.append(el('li', { class: 'rows-foot', html: `Showing Muso.ai's top ${loadedCount} of ${totalCount} credits. <a href="${window.__musoUrl || '#'}" target="_blank" rel="noopener">See every credit on Muso.ai</a>` }));
    }
  }

  list.addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (row && row._credit) player.play(row._credit);
  });
  list.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) { e.preventDefault(); player.play(e.target._credit); }
  });
  player.onChange(({ id, playing }) => {
    $$('.row', list).forEach(r => {
      const on = r.dataset.id === id && playing;
      r.classList.toggle('is-playing', on);
      const b = r.querySelector('.play-btn');
      if (b) b.innerHTML = on ? icons.pause : icons.play;
    });
  });

  async function load() {
    const req = ++state.req;
    const params = new URLSearchParams({ category: state.category, q: state.q, sort: state.sort });
    if (pageSize) params.set('limit', pageSize);
    try {
      const data = await api(`/api/credits?${params}`);
      if (req !== state.req) return;
      state.data = data;
      render();
      if (bounded) scroller.scrollTop = 0;
      root.dispatchEvent(new CustomEvent('catalog', { detail: data }));
    } catch {
      list.replaceChildren(el('li', { class: 'rows-empty' }, 'The catalog could not be loaded. Refresh to try again.'));
    }
  }
  load();
  return { reload: load };
}

export function syncLine(data, musoUrl) {
  const source = data.mode === 'api' ? 'Synced from Muso.ai' : 'Verified from Muso.ai';
  return `${source} on ${formatDate(data.syncedAt)}. <a href="${musoUrl}" target="_blank" rel="noopener">View profile</a>`;
}
