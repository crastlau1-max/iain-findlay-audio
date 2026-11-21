// Account: projects, profile, password, email verification.
import { $, $$, el, api, money, toast } from './lib.js';
import { initNav, me } from './nav.js';

initNav();
const q = new URLSearchParams(location.search);

// A verification link can be opened signed in or out.
if (q.has('verify')) {
  try { await api('/api/account/verify', { method: 'POST', body: { token: q.get('verify') } }); toast('Email confirmed.'); }
  catch (x) { toast(x.message); }
  history.replaceState(null, '', '/account');
}

let user = await me();
if (!user) location.replace(`/signin?next=${encodeURIComponent('/account')}`);
else {
  if (q.has('verify')) user = (await api('/api/account/me')).user;
  render();
}

function render() {
  // tabs
  const tabs = $$('.pf-tabs [role="tab"]');
  const show = name => {
    if (!tabs.some(t => t.dataset.tab === name)) name = 'projects';
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    $$('.pf-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
  };
  tabs.forEach(t => t.addEventListener('click', () => { history.replaceState(null, '', `#${t.dataset.tab}`); show(t.dataset.tab); }));
  show(location.hash.slice(1));
  addEventListener('hashchange', () => show(location.hash.slice(1)));

  // verification banner
  const banner = $('#verify-banner');
  if (!user.verified) {
    const resend = el('button', { class: 'btn btn-sm', type: 'button' }, 'Resend link');
    resend.addEventListener('click', async () => {
      resend.disabled = true;
      try { await api('/api/account/verify/resend', { method: 'POST' }); toast(`Link sent to ${user.email}.`); }
      catch (x) { toast(x.message); resend.disabled = false; }
    });
    banner.replaceChildren(el('span', {}, `Confirm ${user.email} to see projects sent from this email before you had an account.`), resend);
    banner.hidden = false;
  }

  // profile
  $('#p-email').value = user.email; $('#p-name').value = user.name || ''; $('#p-artist').value = user.artist || '';
  $('#profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { user = await api('/api/account/profile', { method: 'PATCH', body: { name: $('#p-name').value, artist: $('#p-artist').value } }); toast('Saved.'); }
    catch (x) { toast(x.message); }
  });
  $('#pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#pw-new').value !== $('#pw-new2').value) return toast('Passwords don\'t match.');
    try { await api('/api/account/password', { method: 'POST', body: { current: $('#pw-cur').value, next: $('#pw-new').value } }); e.target.reset(); toast('Password changed.'); }
    catch (x) { toast(x.message); }
  });
  $('#signout').addEventListener('click', async () => { await api('/api/account/logout', { method: 'POST' }); location.href = '/'; });

  loadProjects();
}

async function loadProjects() {
  const list = $('#proj-list');
  try {
    const { projects } = await api('/api/account/projects');
    if (!projects.length) {
      list.replaceChildren(el('li', { class: 'proj-empty' }, el('p', {}, 'No projects yet.'), el('a', { class: 'btn btn-primary btn-sm', href: '/book/request' }, 'Request a quote')));
      return;
    }
    const when = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    list.replaceChildren(...projects.map(p => el('li', {}, el('a', { class: 'proj-row', href: `/project/${p.id}` },
      el('div', { class: 'proj-main' },
        el('div', { class: 'proj-title' }, p.title, p.unread ? el('span', { class: 'unread-dot', 'aria-label': `${p.unread} unread` }, String(p.unread)) : null),
        el('div', { class: 'label' }, `${p.services.map(s => s[0].toUpperCase() + s.slice(1)).join(', ')} · ${p.songs} song${p.songs === 1 ? '' : 's'} · Updated ${when(p.updatedAt)}`)),
      el('div', { class: 'proj-side' },
        el('span', { class: `status s-${p.status}` }, p.statusLabel),
        p.totalCents != null ? el('span', { class: 'label' }, money(p.totalCents)) : null)))));
  } catch (x) { list.replaceChildren(el('li', { class: 'label' }, x.message)); }
}
