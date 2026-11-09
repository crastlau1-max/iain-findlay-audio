'use strict';
// Email notifications through Resend (https://resend.com, free tier).
// Needs RESEND_API_KEY and MAIL_FROM (an address on a domain verified in Resend).
// Without them, emails are logged instead of sent, and everything else keeps working.

const enabled = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

function layout(title, bodyHtml, cta) {
  const button = cta ? `<p style="margin:28px 0"><a href="${cta.url}" style="background:#D4A359;color:#170F04;text-decoration:none;padding:12px 20px;border-radius:4px;font-weight:600;display:inline-block">${cta.label}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#0d0d11;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#EDE9E2">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="font-family:Georgia,serif;font-size:22px;margin-bottom:24px">Iain Findlay</div>
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 14px">${title}</h1>
    <div style="font-size:15px;line-height:1.6;color:#B5B0A7">${bodyHtml}</div>
    ${button}
    <p style="font-size:12px;color:#5E5B56;margin-top:32px">You're getting this because of a project request on Iain Findlay's site.</p>
  </div></body></html>`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function send({ to, subject, title, html, cta, replyTo }) {
  if (!to) return { skipped: true };
  if (!enabled()) {
    console.log(`[mail] (not sent, email not configured) to ${to}: ${subject}${cta ? ` -> ${cta.url}` : ''}`);
    return { skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html: layout(title || subject, html, cta), reply_to: replyTo || process.env.ADMIN_EMAIL || undefined })
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { sent: true };
  } catch (err) {
    console.warn('[mail] failed:', err.message);
    return { error: err.message };
  }
}

module.exports = { send, enabled, esc };
