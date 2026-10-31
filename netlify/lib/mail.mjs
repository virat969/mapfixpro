// Dependency-free email sender (SMTP over implicit TLS, AUTH PLAIN) + the owner notification email.
// Built for Gmail (smtp.gmail.com:465 with an App Password) but works with any SMTP host that
// offers implicit TLS. Credentials only ever come from server-side environment variables.
import tls from 'node:tls';
import crypto from 'node:crypto';
import { escapeHtml, formatWhen } from './util.mjs';

const CRLF = '\r\n';
// Header-safe address: no whitespace, quotes, brackets, commas or other characters that could inject headers.
// (An apostrophe, as in o'brien@example.com, is legal and allowed.)
const ADDR_RE = /^[^\s<>"(),;:\\]+@[^\s<>"(),;:\\]+$/;

export function mailConfig(env) {
  env = env || process.env;
  const user = String(env.GMAIL_USER || env.SMTP_USER || '').trim();
  const pass = String(env.GMAIL_APP_PASSWORD || env.SMTP_PASSWORD || '').replace(/\s+/g, '');
  const to = String(env.NOTIFY_EMAIL || user).trim();
  return {
    configured: !!(user && pass && ADDR_RE.test(user) && ADDR_RE.test(to)),
    user,
    pass,
    to,
    host: String(env.SMTP_HOST || 'smtp.gmail.com').trim(),
    port: Number(env.SMTP_PORT) || 465,
    timeZone: String(env.NOTIFY_TIMEZONE || '').trim()
  };
}

/* ---------- MIME helpers ---------- */

function b64Lines(buf) {
  return buf.toString('base64').replace(/.{1,76}/g, '$&' + CRLF).replace(/\r\n$/, '');
}

/** RFC 2047 encoded-word(s) for any header text that is not plain printable ASCII. */
export function encodeHeader(text) {
  const s = String(text).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const words = [];
  let chunk = '';
  for (const ch of Array.from(s)) {
    if (Buffer.byteLength(chunk + ch) > 42) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => '=?UTF-8?B?' + Buffer.from(w).toString('base64') + '?=').join(CRLF + ' ');
}

function displayAddress(name, addr) {
  const safe = String(name).replace(/["\\\r\n<>]/g, '').trim();
  return safe ? encodeHeader(safe) + ' <' + addr + '>' : addr;
}

function assertAddr(a) {
  if (!ADDR_RE.test(a)) throw new Error('Invalid email address');
  return a;
}

/** Builds a complete RFC 5322 message (multipart/mixed > multipart/alternative + attachments). */
export function buildMessage({ from, fromName, to, replyTo, replyToName, subject, text, html, attachments, domain }) {
  const id = crypto.randomBytes(12).toString('hex');
  const boundaryMixed = '=_mix_' + crypto.randomBytes(12).toString('hex');
  const boundaryAlt = '=_alt_' + crypto.randomBytes(12).toString('hex');
  const headers = [
    'From: ' + displayAddress(fromName, assertAddr(from)),
    'To: ' + assertAddr(to),
    replyTo ? 'Reply-To: ' + displayAddress(replyToName, assertAddr(replyTo)) : null,
    'Subject: ' + encodeHeader(subject),
    'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
    'Message-ID: <' + id + '@' + (domain || 'mapfixpro.local') + '>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' + boundaryMixed + '"'
  ].filter(Boolean);

  const parts = [];
  parts.push(
    '--' + boundaryMixed + CRLF +
    'Content-Type: multipart/alternative; boundary="' + boundaryAlt + '"' + CRLF + CRLF +
    '--' + boundaryAlt + CRLF +
    'Content-Type: text/plain; charset=UTF-8' + CRLF +
    'Content-Transfer-Encoding: base64' + CRLF + CRLF +
    b64Lines(Buffer.from(text, 'utf8')) + CRLF +
    '--' + boundaryAlt + CRLF +
    'Content-Type: text/html; charset=UTF-8' + CRLF +
    'Content-Transfer-Encoding: base64' + CRLF + CRLF +
    b64Lines(Buffer.from(html, 'utf8')) + CRLF +
    '--' + boundaryAlt + '--'
  );
  for (const a of attachments || []) {
    const name = encodeHeader(a.filename).replace(/"/g, '');
    parts.push(
      '--' + boundaryMixed + CRLF +
      'Content-Type: ' + a.contentType + '; name="' + name + '"' + CRLF +
      'Content-Transfer-Encoding: base64' + CRLF +
      'Content-Disposition: attachment; filename="' + name + '"' + CRLF + CRLF +
      b64Lines(a.content)
    );
  }
  parts.push('--' + boundaryMixed + '--');
  return headers.join(CRLF) + CRLF + CRLF + parts.join(CRLF) + CRLF;
}

/* ---------- SMTP client ---------- */

export async function sendSmtp({ host, port, user, pass, from, to, message, timeoutMs }) {
  const socket = tls.connect({ host, port, servername: host });
  const lines = [];
  let partial = '';
  let failure = null;
  let closed = false;
  let wake = null;
  const poke = () => { if (wake) { const w = wake; wake = null; w(); } };

  socket.setEncoding('utf8');
  socket.on('data', (d) => {
    partial += d;
    let i;
    while ((i = partial.indexOf(CRLF)) >= 0) { lines.push(partial.slice(0, i)); partial = partial.slice(i + 2); }
    poke();
  });
  socket.on('error', (e) => { failure = e; poke(); });
  socket.on('close', () => { closed = true; poke(); });

  const timer = setTimeout(() => socket.destroy(new Error('SMTP timeout')), timeoutMs || 8000);

  async function reply() {
    const seen = [];
    for (;;) {
      while (!lines.length) {
        if (failure) throw failure;
        if (closed) throw new Error('SMTP connection closed unexpectedly');
        await new Promise((r) => { wake = r; });
      }
      const line = lines.shift();
      seen.push(line);
      const m = /^(\d{3})([ -])/.exec(line);
      if (!m) throw new Error('Malformed SMTP reply');
      if (m[2] === ' ') return { code: Number(m[1]), text: seen.join(' | ') };
    }
  }
  async function expect(codes, what) {
    const r = await reply();
    if (!codes.includes(r.code)) throw new Error('SMTP ' + what + ' failed: ' + r.code + ' ' + r.text.slice(0, 160));
    return r;
  }
  const send = (s) => { socket.write(s + CRLF); };

  try {
    await expect([220], 'greeting');
    send('EHLO mapfixpro.netlify.app');
    await expect([250], 'EHLO');
    send('AUTH PLAIN ' + Buffer.from('\0' + user + '\0' + pass).toString('base64'));
    await expect([235], 'authentication');
    send('MAIL FROM:<' + assertAddr(from) + '>');
    await expect([250], 'MAIL FROM');
    send('RCPT TO:<' + assertAddr(to) + '>');
    await expect([250, 251], 'RCPT TO');
    send('DATA');
    await expect([354], 'DATA');
    socket.write(message.replace(/^\./gm, '..') + CRLF + '.' + CRLF);
    const done = await expect([250], 'message delivery');
    send('QUIT');
    return done.text;
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}

/* ---------- Owner notification ---------- */

function row(label, value, opts) {
  return (
    '<tr><td style="padding:8px 12px;border-bottom:1px solid #e3e8ef;color:#5b6b80;font-size:13px;white-space:nowrap;vertical-align:top">' +
    escapeHtml(label) +
    '</td><td style="padding:8px 12px;border-bottom:1px solid #e3e8ef;font-size:15px;color:#0a2342;word-break:break-word">' +
    (opts && opts.raw ? value : escapeHtml(value).replace(/\n/g, '<br>')) +
    '</td></tr>'
  );
}

export function buildNotification(record, cfg, adminUrl) {
  const isOrder = record.type === 'order';
  const when = formatWhen(record.receivedAt, cfg.timeZone);
  const photos = record.photos || [];
  const fields = isOrder
    ? [
        ['Reference', record.reference],
        ['Submitted', when],
        ['Full name', record.customerName],
        ['Business name', record.businessName],
        ['Email', record.email],
        ['Google Maps link', record.mapsLink],
        ['Requested service', record.service],
        ['Selected package', record.package],
        ['Description of changes', record.description],
        ['Uploaded photos', photos.length ? photos.length + ' attached (' + photos.map((p) => p.filename).join(', ') + ')' : 'None']
      ]
    : [
        ['Reference', record.reference],
        ['Submitted', when],
        ['Name', record.name],
        ['Email', record.email],
        ['Topic', record.subject],
        ['Message', record.message]
      ];

  const subject = isOrder
    ? 'New MapFixPro order ' + record.reference + ' - ' + record.businessName + ' (' + record.package.replace(/ \(.*\)/, '') + ')'
    : 'New MapFixPro message ' + record.reference + ' - ' + record.subject;

  const text =
    (isOrder ? 'NEW SERVICE REQUEST' : 'NEW CONTACT MESSAGE') + '\n\n' +
    fields.map(([k, v]) => k + ': ' + v).join('\n') + '\n\n' +
    (isOrder
      ? 'Pricing note: Starter from $5, Standard from $10 are starting prices. Confirm the final price with the customer before any work begins. No payment was taken on the website.\n\n'
      : '') +
    'Reply to this email to answer the customer directly.\n' +
    (adminUrl ? 'Review all requests (mobile friendly): ' + adminUrl + '\n' : '');

  const mapsRow = (k, v) =>
    k === 'Google Maps link'
      ? row(k, '<a href="' + escapeHtml(v) + '" style="color:#1a5fd0">' + escapeHtml(v) + '</a>', { raw: true })
      : k === 'Email'
        ? row(k, '<a href="mailto:' + escapeHtml(v) + '" style="color:#1a5fd0">' + escapeHtml(v) + '</a>', { raw: true })
        : row(k, v);

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;color:#0a2342">' +
    '<div style="background:#0a2342;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;font-size:18px;font-weight:700">' +
    (isOrder ? 'New service request' : 'New contact message') + ' &middot; ' + escapeHtml(record.reference) + '</div>' +
    '<table style="width:100%;border-collapse:collapse;border:1px solid #e3e8ef;border-top:0">' +
    fields.map(([k, v]) => mapsRow(k, v)).join('') + '</table>' +
    (isOrder
      ? '<p style="font-size:13px;color:#5b6b80;margin:14px 0 0">Starter (from $5) and Standard (from $10) are starting prices. Confirm the final price with the customer before work begins. No payment was taken on the website.</p>'
      : '') +
    '<p style="font-size:13px;color:#5b6b80;margin:8px 0 0">Reply to this email to answer the customer directly.' +
    (adminUrl ? ' <a href="' + escapeHtml(adminUrl) + '" style="color:#1a5fd0">Open all requests</a>.' : '') + '</p></div>';

  return { subject, text, html };
}

/**
 * Sends the owner notification (photos attached). Throws on any failure.
 * `photoFiles` is [{filename, contentType, content: Buffer}].
 */
export async function sendOwnerNotification(record, photoFiles, cfg, adminUrl) {
  const { subject, text, html } = buildNotification(record, cfg, adminUrl);
  const message = buildMessage({
    from: cfg.user,
    fromName: 'MapFixPro Orders',
    to: cfg.to,
    replyTo: record.email,
    replyToName: record.customerName || record.name,
    subject,
    text,
    html,
    attachments: photoFiles,
    domain: (cfg.user.split('@')[1] || 'mapfixpro.local')
  });
  await sendSmtp({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    pass: cfg.pass,
    from: cfg.user,
    to: cfg.to,
    message,
    timeoutMs: 8000
  });
}
