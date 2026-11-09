// Homepage project request form (step one of the SoundBetter style flow).
import { $, $$, el, api, icons, money } from './lib.js';

export function mountRequest(cfg) {
  const form = $('#request-form');
  if (!form) return;
  cfg.services.forEach((s, i) => {
    $('#svc-grid').append(el('label', { class: 'choice' },
      el('input', { type: 'checkbox', name: 'services', value: s.id, checked: i === 0 }),
      el('span', { class: 'box', html: icons.check }),
      el('div', { class: 'name' }, s.name),
      el('div', { class: 'desc' }, s.summary)));
  });
  const drums = cfg.addOns.find(a => a.id === 'live_drums');
  if (drums) $('#addon-wrap').append(el('label', { class: 'choice' },
    el('input', { type: 'checkbox', name: 'liveDrums' }), el('span', { class: 'box', html: icons.check }),
    el('div', { class: 'name' }, `Add ${drums.name.toLowerCase()}`), el('div', { class: 'desc' }, drums.summary)));

  const songs = el('input', { type: 'number', name: 'songs', value: 1, min: 1, max: 50, inputmode: 'numeric', 'aria-label': 'Number of songs' });
  const set = v => { songs.value = Math.min(50, Math.max(1, parseInt(v, 10) || 1)); };
  $('#songs-slot').append(el('div', { class: 'stepper' },
    el('button', { type: 'button', 'aria-label': 'Fewer songs', onclick: () => set(+songs.value - 1) }, '−'), songs,
    el('button', { type: 'button', 'aria-label': 'More songs', onclick: () => set(+songs.value + 1) }, '+')));

  // Starting rates, only when set in admin.
  const priced = [...cfg.services, ...cfg.addOns].filter(x => Number.isInteger(x.rateCents));
  if (priced.length) $('#rates-box').append(el('div', { class: 'rates' }, el('div', { class: 'h3', style: 'font-size:14px' }, 'Starting rates'),
    el('ul', {}, priced.map(x => el('li', {}, el('span', {}, x.name), el('span', {}, `from ${money(x.rateCents)} / ${x.unit}`))))));
  cfg.includedDeliverables.forEach(d => $('#included-list').append(el('li', { html: icons.check }, d)));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#form-error'); err.textContent = '';
    const fd = new FormData(form);
    const body = Object.fromEntries(fd);
    body.services = fd.getAll('services');
    body.liveDrums = fd.get('liveDrums') === 'on';
    if (!body.services.length) { err.textContent = 'Choose at least one service.'; return; }
    if (!body.description || body.description.trim().length < 10) { err.textContent = 'Tell me a little about the project.'; $('#r-desc').focus(); return; }
    if (!$('#r-email').checkValidity() || !body.email) { err.textContent = 'Add your email so I can reply.'; $('#r-email').focus(); return; }
    const btn = $('#request-btn'); btn.disabled = true; btn.textContent = 'Sending';
    try {
      const r = await api('/api/projects', { method: 'POST', body });
      if (r.token) location.href = `/project/${r.token}?new=1`;
      else { btn.textContent = 'Sent'; }
    } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Send request'; }
  });
}
