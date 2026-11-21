// Sign in, create account, forgot password and reset password on one page.
import { $, $$, api } from './lib.js?v=5';
import { initNav, me } from './nav.js?v=5';

initNav();
const q = new URLSearchParams(location.search);
const mode = ['signin', 'signup', 'forgot', 'reset'].includes(q.get('mode')) ? q.get('mode') : 'signin';
const nextUrl = (() => { const n = q.get('next') || '/account'; return n.startsWith('/') && !n.startsWith('//') ? n : '/account'; })();

const TITLES = { signin: 'Sign in', signup: 'Create account', forgot: 'Reset password', reset: 'New password' };
const BUTTONS = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Save password' };
$('#auth-title').textContent = TITLES[mode];
$('#auth-btn').textContent = BUTTONS[mode];
document.title = `${TITLES[mode]} · Iain Findlay`;
$$('[data-only]').forEach(n => { n.hidden = !n.dataset.only.split(' ').includes(mode); });
$$('.auth-links a').forEach(a => { const u = new URL(a.href); if (q.has('next')) u.searchParams.set('next', nextUrl); a.href = u.pathname + u.search; });
if (mode === 'signup' || mode === 'reset') { $('#f-pass').autocomplete = 'new-password'; $('#f-pass').placeholder = '8 characters or more'; }
if (mode === 'reset') $('#f-pass-label').textContent = 'New password';

if ((mode === 'signin' || mode === 'signup') && await me()) location.replace(nextUrl);

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const errBox = $('#form-error'); errBox.textContent = '';
  const btn = $('#auth-btn'); btn.disabled = true;
  const email = $('#f-email').value, password = $('#f-pass').value;
  if ((mode === 'signup' || mode === 'reset') && password !== $('#f-pass2').value) { errBox.textContent = 'Passwords don\'t match.'; btn.disabled = false; $('#f-pass2').focus(); return; }
  try {
    if (mode === 'signin') { await api('/api/account/login', { method: 'POST', body: { email, password } }); location.href = nextUrl; }
    if (mode === 'signup') { await api('/api/account/signup', { method: 'POST', body: { email, password, name: $('#f-name').value, artist: $('#f-artist').value, website: $('#f-website').value } }); location.href = nextUrl; }
    if (mode === 'forgot') {
      await api('/api/account/forgot', { method: 'POST', body: { email } });
      const ok = $('#auth-ok'); ok.hidden = false; ok.textContent = 'If that email has an account, a reset link is on its way.';
    }
    if (mode === 'reset') { await api('/api/account/reset', { method: 'POST', body: { token: q.get('token'), password } }); location.href = '/account'; }
  } catch (x) { errBox.textContent = x.message; }
  finally { btn.disabled = false; }
});
