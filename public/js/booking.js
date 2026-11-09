// Direct booking engine.
import { $, $$, el, api, icons, money } from './lib.js';

export function mountBooking(cfg) {
  const form = $('#booking-form');
  if (!form) return;

  // services
  const svcGrid = $('#svc-grid');
  cfg.services.forEach((s, i) => {
    svcGrid.append(el('label', { class: 'choice' },
      el('input', { type: 'checkbox', name: 'services', value: s.id, checked: i === 0 }),
      el('span', { class: 'box', html: icons.check }),
      el('div', { class: 'name' }, s.name),
      el('div', { class: 'rate' }, s.rateLabel),
      el('div', { class: 'desc' }, s.summary)));
  });

  // included deliverables
  const inc = $('#included-list');
  cfg.includedDeliverables.forEach(d => inc.append(el('li', { html: `${icons.check}<span></span>` })));
  $$('#included-list li span').forEach((n, i) => n.textContent = cfg.includedDeliverables[i]);

  // add-ons
  const addWrap = $('#addon-wrap');
  cfg.addOns.forEach(a => {
    const qty = el('div', { class: 'addon-qty', hidden: true },
      el('span', {}, 'Sessions'),
      stepper(`addon-${a.id}`, 1, 1, 20));
    const cb = el('input', { type: 'checkbox', name: 'addon', value: a.id });
    cb.addEventListener('change', () => { qty.hidden = !cb.checked; update(); });
    addWrap.append(el('div', { class: 'addon' },
      el('label', { class: 'choice' }, cb, el('span', { class: 'box', html: icons.check }),
        el('div', { class: 'inline-row' }, el('div', { class: 'name' }, a.name), el('div', { class: 'rate' }, `Add on, ${a.rateLabel}`)),
        el('div', { class: 'desc' }, a.summary)),
      qty));
  });

  // payment plans
  const pay = $('#pay-grid');
  cfg.payment.options.forEach((o, i) => {
    pay.append(el('label', { class: 'choice radio' },
      el('input', { type: 'radio', name: 'payment', value: o.id, checked: i === 0 }),
      el('span', { class: 'box', html: icons.check }),
      el('div', { class: 'name' }, o.label),
      el('div', { class: 'desc' }, o.detail)));
  });

  $('#songs-slot').append(stepper('songs', 1, 1, 50));

  function stepper(name, value, min, max) {
    const input = el('input', { type: 'number', name, value, min, max, inputmode: 'numeric', 'aria-label': name === 'songs' ? 'Number of songs' : 'Number of sessions' });
    const clamp = v => Math.min(max, Math.max(min, parseInt(v, 10) || min));
    const set = v => { input.value = clamp(v); update(); };
    input.addEventListener('change', () => set(input.value));
    return el('div', { class: 'stepper' },
      el('button', { type: 'button', 'aria-label': 'Decrease', onclick: () => set(+input.value - 1) }, '−'),
      input,
      el('button', { type: 'button', 'aria-label': 'Increase', onclick: () => set(+input.value + 1) }, '+'));
  }

  function payload() {
    const fd = new FormData(form);
    const addOns = {};
    $$('input[name="addon"]:checked', form).forEach(cb => { addOns[cb.value] = +(form.querySelector(`[name="addon-${cb.value}"]`)?.value || 1); });
    return {
      services: fd.getAll('services'),
      songs: +fd.get('songs') || 1,
      addOns,
      payment: fd.get('payment'),
      name: fd.get('name'),
      email: fd.get('email'),
      artist: fd.get('artist'),
      project: fd.get('project'),
      notes: fd.get('notes')
    };
  }

  let quote = null, timer, seq = 0;
  async function update() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const q = await api('/api/booking/quote', { method: 'POST', body: payload() });
        if (mine === seq) { quote = q; renderSummary(q); }
      } catch { /* keep last summary */ }
    }, 80);
  }
  form.addEventListener('change', update);

  function renderSummary(q) {
    const ul = $('#sum-lines');
    ul.replaceChildren();
    if (!q.lines.length) ul.append(el('li', { class: 'empty' }, 'Choose at least one service.'));
    q.lines.forEach(l => ul.append(el('li', {}, el('span', {}, `${l.name} × ${l.qty} ${l.unit}${l.qty > 1 ? 's' : ''}`), el('span', {}, money(l.totalCents) || l.rateLabel))));
    ul.append(el('li', {}, el('span', { style: 'color:var(--muted)' }, 'Mix stems, instrumental, acapella and TV track'), el('span', {}, 'Included')));
    $('#sum-total').textContent = q.priced ? money(q.totalCents) : '[$TOTAL]';
    const depositLabel = q.plan === 'full' ? 'Due today, paid in full' : `Due today, ${q.depositPercent}% deposit`;
    $('#sum-due-label').textContent = depositLabel;
    $('#sum-due').textContent = q.priced ? money(q.dueNowCents) : '[$DUE]';
    $('#sum-balance-row').hidden = q.plan === 'full';
    $('#sum-balance').textContent = q.priced ? money(q.balanceCents) : '[$BALANCE]';
    $('#checkout-btn').disabled = !q.lines.length || !q.services.length;
  }

  // intake + checkout modal
  const dlg = $('#intake-modal');
  const guide = $('#spec-list');
  cfg.intake.guidelines.forEach(g => guide.append(el('li', {}, g)));
  const dropbox = cfg.intake.dropboxUrl;
  const isPlaceholder = !/^https?:\/\//.test(dropbox);
  const linkBox = $('#intake-link');
  linkBox.innerHTML = '';
  linkBox.append(
    el('div', { style: 'min-width:0' }, el('div', { class: 'k' }, 'Private upload folder'), el('div', { class: 'v' }, isPlaceholder ? dropbox : 'Iain Findlay intake on Dropbox')),
    isPlaceholder
      ? el('span', { class: 'label' }, 'Link sent with your confirmation')
      : el('a', { class: 'btn btn-sm', href: dropbox, target: '_blank', rel: 'noopener', html: `Open ${icons.out}` }));

  $('#checkout-btn').addEventListener('click', () => {
    const err = $('#form-error');
    err.textContent = '';
    const p = payload();
    if (!p.services.length) { err.textContent = 'Choose at least one service.'; return; }
    const email = form.querySelector('[name="email"]');
    if (!email.value || !email.checkValidity()) { err.textContent = 'Add your billing email so I can send the confirmation.'; email.focus(); return; }
    resetModal();
    dlg.showModal();
  });
  $$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  function resetModal() {
    $('#modal-steps').hidden = false;
    $('#modal-done').hidden = true;
    $('#modal-error').textContent = '';
    $('#accept-terms').checked = false;
    const due = quote && quote.priced ? money(quote.dueNowCents) : null;
    $('#pay-btn').textContent = cfg.stripeEnabled && due ? `Pay ${due} with Stripe` : 'Confirm booking';
  }

  $('#pay-btn').addEventListener('click', async () => {
    const errBox = $('#modal-error');
    if (!$('#accept-terms').checked) { errBox.textContent = 'Please accept the booking terms to continue.'; return; }
    const btn = $('#pay-btn');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Starting checkout';
    try {
      const res = await api('/api/booking/checkout', { method: 'POST', body: { ...payload(), acceptTerms: true } });
      if (res.mode === 'stripe' && res.url) { window.location.href = res.url; return; }
      $('#modal-steps').hidden = true;
      $('#modal-done').hidden = false;
      $('#done-ref').textContent = res.bookingId;
      $('#done-reason').textContent = res.reason || '';
    } catch (e) {
      errBox.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  // return from Stripe
  const params = new URLSearchParams(location.search);
  const status = params.get('booking');
  if (status) {
    const box = $('#return-note');
    box.hidden = false;
    box.textContent = status === 'success' ? `Payment received. Your booking reference is ${params.get('ref')}. A confirmation with the upload link is on its way.`
      : status === 'balance-paid' ? 'Final balance received. Your masters are on their way.'
      : 'Checkout was cancelled. Nothing was charged.';
  }

  update();
}
