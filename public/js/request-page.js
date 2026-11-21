// Quote request in four steps: service, project, account, review.
import { $, $$, el, api, icons, dropZone, uploadFile, bytes } from './lib.js?v=5';
import { initNav, me } from './nav.js?v=5';

initNav();
const form = $('#rq-form');
const errBox = $('#form-error');
const steps = $$('.rq-step');
const stepper = $$('#rq-steps li');
const prev = $('#rq-prev'), next = $('#rq-next');
const q = new URLSearchParams(location.search);
let step = 0, mode = 'signup', user = await me();

const cfg = await api('/api/config');

// ---------- step 1: services ----------
const wanted = q.get('service');
cfg.services.forEach((s, i) => $('#svc-grid').append(el('label', { class: 'choice' },
  el('input', { type: 'checkbox', name: 'services', value: s.id, checked: wanted ? s.id === wanted : i === 0 }),
  el('span', { class: 'box', html: icons.check }), el('div', { class: 'name' }, s.name))));
const drums = cfg.addOns.find(a => a.id === 'live_drums');
if (drums) $('#addon-wrap').append(el('div', { class: 'h3', style: 'font-size:14px;margin-bottom:10px' }, 'Add-on'), el('label', { class: 'choice' },
  el('input', { type: 'checkbox', name: 'liveDrums', checked: wanted === 'live_drums' }), el('span', { class: 'box', html: icons.check }),
  el('div', { class: 'name' }, drums.name)));
const songs = el('input', { id: 'songs-input', type: 'number', name: 'songs', value: 1, min: 1, max: 50, inputmode: 'numeric' });
const setSongs = v => { songs.value = Math.min(50, Math.max(1, parseInt(v, 10) || 1)); };
$('#songs-slot').append(el('div', { class: 'stepper' },
  el('button', { type: 'button', 'aria-label': 'Fewer songs', onclick: () => setSongs(+songs.value - 1) }, '−'), songs,
  el('button', { type: 'button', 'aria-label': 'More songs', onclick: () => setSongs(+songs.value + 1) }, '+')));
if (q.has('course')) { $('#r-title').value = 'Recording course'; $('#r-desc').value = 'Enrollment in the recording course.'; }

// ---------- step 2: files (reference tracks, stems, sessions) ----------
const drop = dropZone({ label: 'Drop reference tracks or stems, or browse' });
$('#file-slot').append(drop.node);

// ---------- step 3: account ----------
function paintAccount() {
  $('#acct-signed').hidden = !user;
  $('#acct-forms').hidden = Boolean(user);
  if (user) $('#acct-email').textContent = user.email;
  $$('.seg [role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $$('#acct-forms [data-only]').forEach(n => { n.hidden = n.dataset.only !== mode; });
  $('#a-pass').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
}
$$('.seg [role="tab"]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; errBox.textContent = ''; paintAccount(); }));
$('#acct-switch').addEventListener('click', async e => {
  e.preventDefault();
  await api('/api/account/logout', { method: 'POST' }); user = null; mode = 'login'; paintAccount();
});
paintAccount();

// ---------- data ----------
function collect() {
  const fd = new FormData(form);
  return {
    services: fd.getAll('services'), liveDrums: fd.get('liveDrums') === 'on', songs: songs.value,
    title: $('#r-title').value, description: $('#r-desc').value, references: $('#r-refs').value,
    deadline: $('#r-deadline').value, budget: $('#r-budget').value
  };
}

function check(i) {
  const d = collect();
  if (i === 0 && !d.services.length) return 'Choose at least one service.';
  if (i === 1 && d.description.trim().length < 10) { $('#r-desc').focus(); return 'Add some details about the project.'; }
  return '';
}

async function ensureAccount() {
  if (user) return;
  if (mode === 'signup' && $('#a-pass').value !== $('#a-pass2').value) { $('#a-pass2').focus(); throw new Error('Passwords don\'t match.'); }
  const body = { email: $('#a-email').value, password: $('#a-pass').value };
  if (mode === 'signup') Object.assign(body, { name: $('#a-name').value, artist: $('#a-artist').value, website: $('#a-website').value });
  const r = await api(`/api/account/${mode === 'signup' ? 'signup' : 'login'}`, { method: 'POST', body });
  user = r.user;
  paintAccount();
}

function review() {
  const d = collect();
  const name = id => [...cfg.services, ...cfg.addOns].find(s => s.id === id)?.name || id;
  const rows = [
    ['Services', d.services.map(name).join(', ')],
    ['Add-on', d.liveDrums ? drums?.name : null],
    ['Songs', d.songs], ['Title', d.title || 'Untitled project'], ['Details', d.description],
    ['Files', drop.files().map(f => `${f.name} (${bytes(f.size)})`).join('\n')],
    ['Reference links', d.references], ['Deadline', d.deadline], ['Budget', d.budget], ['Account', user?.email]
  ].filter(([, v]) => v);
  $('#rq-review').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))]));
}

function go(i) {
  step = i;
  steps.forEach((s, j) => { s.hidden = j !== i; });
  stepper.forEach((s, j) => { s.className = j < i ? 'done' : j === i ? 'now' : ''; });
  prev.hidden = i === 0;
  next.textContent = i === steps.length - 1 ? 'Send request' : 'Continue';
  if (i === 3) review();
  errBox.textContent = '';
  window.scrollTo({ top: 0 });
}

prev.addEventListener('click', () => go(Math.max(0, step - 1)));
form.addEventListener('submit', async e => {
  e.preventDefault();
  errBox.textContent = '';
  const problem = check(step);
  if (problem) { errBox.textContent = problem; return; }
  next.disabled = true;
  try {
    if (step === 2) await ensureAccount();
    if (step < steps.length - 1) { go(step + 1); return; }
    const r = await api('/api/projects', { method: 'POST', body: collect() });
    await sendFiles(r.id);
    location.href = `/project/${r.id}?new=1`;
  } catch (x) {
    errBox.textContent = x.status === 401 && step === 3 ? 'Sign in again to send this request.' : x.message;
    if (x.status === 401 && step === 3) { user = null; paintAccount(); go(2); }
  } finally { next.disabled = false; }
});
// Files go up one at a time after the project exists. A failed file doesn't block the request.
async function sendFiles(id) {
  const list = drop.files();
  if (!list.length) return;
  const bar = $('#up-progress'), fill = bar.firstElementChild;
  const total = list.reduce((s, f) => s + f.size, 0);
  let done = 0, failed = [];
  bar.hidden = false;
  for (const [i, f] of list.entries()) {
    next.textContent = `Uploading ${i + 1} of ${list.length}`;
    try { await uploadFile(`/api/projects/${id}/files`, f, p => { fill.style.width = `${Math.round((done + f.size * p) / total * 100)}%`; }); }
    catch (x) { failed.push(`${f.name}: ${x.message}`); }
    done += f.size;
  }
  if (failed.length) sessionStorage.setItem('uploadErrors', failed.join('\n'));
}

go(0);
