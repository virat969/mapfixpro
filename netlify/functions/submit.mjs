// POST /api/submit — receives order + contact submissions from the website.
//
// Order of operations (the customer sees "success" only when step 6 or 7 really happened):
//  1. same-site + size checks      2. honeypot + timing    3. optional Turnstile
//  4. validate every field         5. rate limit           6. save to Netlify Blobs
//  7. email the owner (photos attached)
// Success is returned if the request was saved OR emailed. If both fail, the customer gets an error.

import { json, clientIp, makeReference } from '../lib/util.mjs';
import { validateSubmission, sniffImage, safeFileName, LIMITS } from '../lib/validate.mjs';
import { getStorage, rateLimitHit } from '../lib/store.mjs';
import { mailConfig, sendOwnerNotification } from '../lib/mail.mjs';

const MIN_FILL_MS = 3000;           // humans need more than 3 seconds to fill the form
const RATE_LIMIT = 6;               // submissions per IP...
const RATE_WINDOW_SECONDS = 3600;   // ...per hour

const GENERIC_FAIL = 'Sorry, your request was NOT sent because we could not save it. Please try again in a moment.';

function fail(status, message, extra) {
  return json(status, Object.assign({ ok: false, message }, extra || {}));
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    return data && data.success === true;
  } catch (e) {
    console.error('turnstile verification error:', e && e.message);
    return false;
  }
}

export default async (req, context) => {
  if (req.method !== 'POST') return fail(405, 'Method not allowed.', { error: 'method' });

  /* 1. same-site + size */
  const origin = req.headers.get('origin');
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === new URL(req.url).host; } catch (e) { ok = false; }
    if (!ok) return fail(403, 'This request was not allowed.', { error: 'origin' });
  }
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > LIMITS.MAX_REQUEST_BYTES) {
    return fail(413, 'Your photos are too large to send together. Please remove one or choose smaller photos. Your request was NOT sent.', { error: 'too-large' });
  }
  const ctype = req.headers.get('content-type') || '';
  if (!/^multipart\/form-data/i.test(ctype)) return fail(400, 'Unsupported request format.', { error: 'format' });

  let form;
  try {
    form = await req.formData();
  } catch (e) {
    return fail(400, 'We could not read your submission. Please try again.', { error: 'parse' });
  }
  const field = (name) => {
    const v = form.get(name);
    return typeof v === 'string' ? v : '';
  };

  const type = field('type') === 'contact' ? 'contact' : field('type') === 'order' ? 'order' : '';
  if (!type) return fail(400, 'Unsupported request type.', { error: 'type' });

  /* 2. honeypot + timing */
  if (field('website')) return fail(400, 'Your request was NOT sent because it looked like automated spam.', { error: 'spam' });
  const startedAt = Number(field('startedAt'));
  const now = Date.now();
  if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now + 60000) {
    return fail(400, 'Please reload the page and try again. Your request was NOT sent.', { error: 'stale' });
  }
  if (now - startedAt < MIN_FILL_MS) {
    return fail(400, 'That was very fast. Please check your answers and press send again. Your request was NOT sent.', { error: 'too-fast' });
  }

  const ip = clientIp(req, context);

  /* 3. optional Turnstile (enabled when TURNSTILE_SECRET_KEY is set) */
  const turnstileSecret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (turnstileSecret) {
    const passed = await verifyTurnstile(turnstileSecret, field('cf-turnstile-response'), ip);
    if (!passed) {
      return fail(400, 'The spam check did not pass. Please try again. Your request was NOT sent.', { error: 'turnstile', fields: { turnstile: 'Please complete the spam check and try again.' } });
    }
  }

  /* 4. validate */
  const { errors, value } = validateSubmission(type, field);

  const photoEntries = type === 'order'
    ? form.getAll('photos').filter((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function' && f.size > 0)
    : [];
  const photos = [];
  if (photoEntries.length > LIMITS.MAX_PHOTOS) {
    errors.photos = 'You can attach up to ' + LIMITS.MAX_PHOTOS + ' photos.';
  } else {
    let total = 0;
    for (let i = 0; i < photoEntries.length; i++) {
      const f = photoEntries[i];
      if (f.size > LIMITS.MAX_PHOTO_BYTES) { errors.photos = '"' + String(f.name).slice(0, 60) + '" is larger than 4 MB.'; break; }
      const buf = Buffer.from(await f.arrayBuffer());
      const kind = sniffImage(buf);
      if (!kind) { errors.photos = '"' + String(f.name).slice(0, 60) + '" is not a JPG, PNG or WebP image.'; break; }
      total += buf.length;
      if (total > LIMITS.MAX_TOTAL_PHOTO_BYTES) { errors.photos = 'The photos are too large to send together. Please remove one or choose smaller photos.'; break; }
      photos.push({ n: i + 1, filename: safeFileName(f.name, kind.ext, i + 1), type: kind.type, ext: kind.ext, size: buf.length, buf });
    }
  }

  if (Object.keys(errors).length) {
    return fail(422, 'Please fix the highlighted fields and send again. Your request was NOT sent.', { error: 'validation', fields: errors });
  }

  let storage = null;
  try { storage = await getStorage(); } catch (e) { console.error('storage init failed:', e && e.message); }

  /* 5. rate limit */
  if (storage && !(await rateLimitHit(storage, 'submit', ip, RATE_LIMIT, RATE_WINDOW_SECONDS))) {
    return fail(429, 'Too many requests from your connection. Please wait a while and try again. Your request was NOT sent.', { error: 'rate-limit' });
  }

  /* build the record */
  const receivedAt = new Date().toISOString();
  const reference = makeReference(type === 'order' ? 'MFP' : 'MSG');
  const record = type === 'order'
    ? {
        type, reference, receivedAt, status: 'New',
        customerName: value.customerName, businessName: value.businessName, email: value.email,
        mapsLink: value.mapsLink, service: value.service, serviceKey: value.serviceKey,
        package: value.package, packageKey: value.packageKey, description: value.description,
        consent: 'yes',
        photos: photos.map((p) => ({ n: p.n, filename: p.filename, type: p.type, size: p.size }))
      }
    : {
        type, reference, receivedAt, status: 'New',
        name: value.name, email: value.email, subject: value.subject, message: value.message
      };
  record.notify = { emailed: false, detail: 'pending' };

  /* 6. save */
  let saved = false;
  if (storage) {
    try {
      await Promise.all(photos.map((p) => storage.put('photos/' + reference + '/' + p.n + '.' + p.ext, p.buf)));
      await storage.putJSON('orders/' + receivedAt.replace(/[-:.]/g, '') + '_' + reference, record);
      saved = true;
    } catch (e) {
      console.error('SAVE FAILED for ' + reference + ':', e && e.message);
    }
  }

  /* 7. email the owner */
  const cfg = mailConfig();
  let emailed = false;
  if (!cfg.configured) {
    record.notify = { emailed: false, detail: 'Email is not configured (set GMAIL_USER and GMAIL_APP_PASSWORD).' };
    console.warn('Email notification skipped: GMAIL_USER / GMAIL_APP_PASSWORD not configured.');
  } else {
    try {
      const adminUrl = new URL(req.url).origin + '/admin.html';
      await sendOwnerNotification(
        record,
        photos.map((p) => ({ filename: p.filename, contentType: p.type, content: p.buf })),
        cfg,
        adminUrl
      );
      emailed = true;
      record.notify = { emailed: true, detail: 'Sent to ' + cfg.to };
    } catch (e) {
      const detail = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 200);
      record.notify = { emailed: false, detail: 'Email failed: ' + detail };
      console.error('EMAIL FAILED for ' + reference + ':', detail);
    }
  }

  // Record the email outcome so the admin page can show it (best effort).
  if (saved) {
    try { await storage.putJSON('orders/' + receivedAt.replace(/[-:.]/g, '') + '_' + reference, record); } catch (e) { /* non-fatal */ }
  }

  if (!saved && !emailed) {
    console.error('SUBMISSION LOST? ' + reference + ' could be neither saved nor emailed.');
    return fail(500, GENERIC_FAIL + ' Your answers are still in the form.', { error: 'not-saved' });
  }

  return json(200, { ok: true, reference });
};

export const config = { path: '/api/submit' };
