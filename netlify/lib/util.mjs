// Small shared helpers for the MapFixPro Netlify Functions.
import crypto from 'node:crypto';

export const REF_RE = /^(MFP|MSG)-\d{8}-[A-Z2-9]{6}$/;

export function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      },
      extraHeaders || {}
    )
  });
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function clientIp(req, context) {
  return (
    (context && context.ip) ||
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cryptographically random reference such as MFP-20261031-K7Q2XM. */
export function makeReference(prefix, date) {
  const d = date || new Date();
  const ymd =
    String(d.getUTCFullYear()) +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[crypto.randomInt(chars.length)];
  return prefix + '-' + ymd + '-' + out;
}

/** Formats a date for the owner: UTC always, plus NOTIFY_TIMEZONE (e.g. Asia/Kolkata) when set. */
export function formatWhen(iso, timeZone) {
  const d = new Date(iso);
  let local = '';
  if (timeZone) {
    try {
      local = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone
      }).format(d) + ' (' + timeZone + ')';
    } catch (e) {
      local = '';
    }
  }
  const utc = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return local ? local + ' / ' + utc : utc;
}
