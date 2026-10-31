// Server-side validation. The browser checks are only a convenience: everything is re-checked here.

export const SERVICES = {
  'name-address': 'Business name and address corrections',
  hours: 'Business opening hours updates',
  photos: 'Business photo upload assistance',
  pin: 'Location and map pin corrections',
  info: 'Business information updates'
};

export const PACKAGES = {
  starter: 'Starter (from $5)',
  standard: 'Standard (from $10)'
};

export const CONTACT_TOPICS = {
  general: 'General question',
  existing: 'Question about an existing request',
  pricing: 'Pricing question',
  other: 'Something else'
};

export const LIMITS = {
  MAX_PHOTOS: 4,
  MAX_PHOTO_BYTES: 4 * 1024 * 1024, // 4 MB per image
  // Netlify synchronous functions accept ~6 MB per request *after* base64 encoding.
  // The browser shrinks photos to fit; these caps keep a safe margin below that.
  MAX_TOTAL_PHOTO_BYTES: Math.floor(3.8 * 1024 * 1024),
  MAX_REQUEST_BYTES: 4 * 1024 * 1024 + 256 * 1024
};

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

// Control characters (except tab/newline), line/paragraph separators and bidi-override characters.
const CONTROL_RE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069]',
  'g'
);

/** Trim, drop control / bidi-override characters, normalise newlines. */
export function cleanText(v) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .trim();
}

/** Single-line variant: newlines and tabs become spaces (prevents header injection). */
export function cleanLine(v) {
  return cleanText(v).replace(/[\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
}

export function normalizeUrl(v) {
  v = cleanLine(v);
  if (!v) return '';
  if (/^http:\/\//i.test(v)) return 'https://' + v.slice(7);
  if (!/^https:\/\//i.test(v) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return 'https://' + v;
  return v;
}

const MAPS_HELP =
  'Please paste a Google Maps link, for example one starting with https://maps.app.goo.gl/ or https://www.google.com/maps/.';

function checkMapsLink(raw) {
  if (!raw) return 'Please paste the Google Maps link to your business.';
  if (raw.length > 500) return 'That link is too long.';
  if (/\s/.test(raw)) return 'The link should not contain spaces. ' + MAPS_HELP;
  let url;
  try {
    url = new URL(normalizeUrl(raw));
  } catch (e) {
    return MAPS_HELP;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return MAPS_HELP;
  const host = url.hostname.toLowerCase();
  const path = url.pathname || '/';
  if (host === 'maps.app.goo.gl') return path.length > 1 ? '' : MAPS_HELP;
  if (host === 'goo.gl') return path.indexOf('/maps') === 0 ? '' : MAPS_HELP;
  if (host === 'g.page') return path.length > 1 ? '' : MAPS_HELP;
  if (/^maps\.google\.[a-z.]{2,6}$/.test(host)) return '';
  if (/^(www\.)?google\.[a-z.]{2,6}$/.test(host)) return path.indexOf('/maps') === 0 ? '' : MAPS_HELP;
  return MAPS_HELP;
}

function checkEmail(v) {
  if (!v) return 'Please enter your email address.';
  if (v.length > 254 || !EMAIL_RE.test(v) || /\.\./.test(v)) return 'Please enter a valid email address, like name@example.com.';
  if (!/^[A-Za-z]{2,}$/.test(v.split('.').pop())) return 'Please enter a valid email address, like name@example.com.';
  return '';
}

function checkLength(v, min, max, emptyMsg) {
  if (!v) return emptyMsg;
  if (v.length < min) return min > 5 ? 'Please add a little more detail (at least ' + min + ' characters).' : 'This looks too short.';
  if (v.length > max) return 'Please keep this under ' + max + ' characters.';
  return '';
}

function linkCount(s) {
  const m = s.match(/https?:\/\/|www\./gi);
  return m ? m.length : 0;
}

/**
 * Validates a parsed submission. `get(name)` returns the raw string for a field.
 * Returns { errors: {field: message}, value: {...clean fields} }.
 */
export function validateSubmission(type, get) {
  const errors = {};
  const value = {};

  if (type === 'order') {
    value.customerName = cleanLine(get('customerName'));
    value.businessName = cleanLine(get('businessName'));
    value.email = cleanLine(get('email')).toLowerCase();
    const rawLink = cleanLine(get('mapsLink'));
    value.mapsLink = normalizeUrl(rawLink);
    value.serviceKey = cleanLine(get('service'));
    value.packageKey = cleanLine(get('package'));
    value.description = cleanText(get('description'));

    let m;
    if ((m = checkLength(value.customerName, 2, 100, 'Please enter your full name.'))) errors.customerName = m;
    else if (/https?:\/\/|www\./i.test(value.customerName)) errors.customerName = 'Please enter your name, not a web address.';
    if ((m = checkLength(value.businessName, 2, 150, 'Please enter your business name.'))) errors.businessName = m;
    if ((m = checkEmail(value.email))) errors.email = m;
    if ((m = checkMapsLink(rawLink))) errors.mapsLink = m;
    if (!Object.prototype.hasOwnProperty.call(SERVICES, value.serviceKey)) errors.service = 'Please choose the service you need.';
    if (!Object.prototype.hasOwnProperty.call(PACKAGES, value.packageKey)) errors.package = 'Please choose a request option.';
    if ((m = checkLength(value.description, 20, 2000, 'Please fill in what you would like changed.'))) errors.description = m;
    else if (linkCount(value.description) > 3) errors.description = 'Please remove some of the links. Describe the change in words.';
    if (cleanLine(get('consent')) !== 'yes') errors.consent = 'Please confirm this box so we can proceed.';

    value.service = SERVICES[value.serviceKey];
    value.package = PACKAGES[value.packageKey];
  } else {
    value.name = cleanLine(get('name'));
    value.email = cleanLine(get('email')).toLowerCase();
    value.subjectKey = cleanLine(get('subject'));
    value.message = cleanText(get('message'));

    let m;
    if ((m = checkLength(value.name, 2, 100, 'Please enter your full name.'))) errors.contactName = m;
    else if (/https?:\/\/|www\./i.test(value.name)) errors.contactName = 'Please enter your name, not a web address.';
    if ((m = checkEmail(value.email))) errors.contactEmail = m;
    if (!Object.prototype.hasOwnProperty.call(CONTACT_TOPICS, value.subjectKey)) errors.contactSubject = 'Please choose a topic.';
    if ((m = checkLength(value.message, 10, 2000, 'Please fill in your message.'))) errors.contactMessage = m;
    else if (linkCount(value.message) > 3) errors.contactMessage = 'Please remove some of the links. Describe your question in words.';

    value.subject = CONTACT_TOPICS[value.subjectKey];
  }
  return { errors, value };
}

/** Identifies the real file type from its first bytes. Never trusts the browser-supplied type. */
export function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return { type: 'image/png', ext: 'png' };
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) return { type: 'image/webp', ext: 'webp' };
  return null;
}

/** Safe attachment name: no paths, no odd characters, extension matches the sniffed type. */
export function safeFileName(original, ext, index) {
  let base = String(original || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '');
  base = base.normalize('NFKD').replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\s+/g, '-').replace(/^[.-]+/, '').slice(0, 50);
  if (!base) base = 'photo-' + index;
  return base + '.' + ext;
}
