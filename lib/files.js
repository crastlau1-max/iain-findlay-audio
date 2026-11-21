'use strict';
// Project file uploads: reference tracks, stems, sessions. Files are streamed to disk
// under data/uploads/<projectId>/<fileId>; the original name lives in the project record.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
const MAX_BYTES = Number(process.env.UPLOAD_MAX_MB || 500) * 1024 * 1024;
const MAX_FILES = 60;
const TYPES = ['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'zip', 'rar', '7z', 'pdf', 'txt', 'mid', 'midi', 'png', 'jpg', 'jpeg'];
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

function cleanName(name) {
  const base = path.basename(String(name || '')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim().slice(0, 160);
  return base || 'file';
}
const ext = name => (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';

function check(name, declaredSize, count) {
  if (!TYPES.includes(ext(name))) throw err(`That file type isn't accepted. Use ${TYPES.slice(0, 8).join(', ')}, zip or pdf.`, 415);
  if (declaredSize > MAX_BYTES) throw err(`Files can be up to ${Math.round(MAX_BYTES / 1024 / 1024)} MB. Zip larger sessions or send a link.`, 413);
  if (count >= MAX_FILES) throw err('This project has reached its file limit. Send a link instead.', 400);
}

// Streams the request body to disk. Resolves with the file record, or rejects and cleans up.
function receive(req, projectId, name, count) {
  name = cleanName(name);
  try { check(name, Number(req.get('content-length') || 0), count); } catch (e) { req.resume?.(); return Promise.reject(e); }
  const id = `fil_${crypto.randomBytes(8).toString('hex')}`;
  const dir = path.join(DIR, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, id);
  return new Promise((resolve, reject) => {
    let size = 0, failed = false;
    const out = fs.createWriteStream(dest, { mode: 0o600 });
    const fail = e => { if (failed) return; failed = true; out.destroy(); fs.rm(dest, { force: true }, () => {}); reject(e); };
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BYTES) { fail(err(`Files can be up to ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`, 413)); req.destroy(); }
    });
    req.on('aborted', () => fail(err('Upload interrupted.')));
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (!size) { fs.rm(dest, { force: true }, () => {}); return reject(err('That file is empty.')); }
      resolve({ id, name, size, type: ext(name) });
    });
    req.pipe(out);
  });
}

function filePath(projectId, fileId) {
  if (!/^pj_[0-9a-f]{12}$/.test(projectId) || !/^fil_[0-9a-f]{16}$/.test(fileId)) return null;
  const p = path.join(DIR, projectId, fileId);
  return fs.existsSync(p) ? p : null;
}

function send(res, projectId, file) {
  const p = file && filePath(projectId, file.id);
  if (!p) return res.status(404).json({ error: 'That file is no longer available.' });
  res.set('Cache-Control', 'private, no-store');
  res.download(p, file.name);
}

module.exports = { receive, send, filePath, cleanName, TYPES, MAX_BYTES, MAX_FILES };
