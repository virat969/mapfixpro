// GET /api/admin/... — private, token-protected review API used by /admin.html (mobile friendly).
// Disabled until ADMIN_TOKEN (at least 24 characters) is set in Netlify environment variables.
//
//   GET /api/admin/orders?offset=0&limit=25     -> newest requests first
//   GET /api/admin/photo/<reference>/<1-4>      -> the uploaded image

import { json, safeEqual, clientIp, REF_RE } from '../lib/util.mjs';
import { getStorage, rateLimitBlocked, rateLimitHit } from '../lib/store.mjs';

const MAX_FAILS = 10;
const FAIL_WINDOW = 3600;
const IMAGE_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export default async (req, context) => {
  if (req.method !== 'GET') return json(405, { ok: false, message: 'Method not allowed.' });

  const token = String(process.env.ADMIN_TOKEN || '');
  if (token.length < 24) {
    return json(503, { ok: false, message: 'Admin access is not enabled. Set ADMIN_TOKEN (24+ characters) in Netlify.' });
  }

  let storage;
  try { storage = await getStorage(); } catch (e) {
    console.error('admin storage init failed:', e && e.message);
    return json(500, { ok: false, message: 'Storage is unavailable.' });
  }

  const ip = clientIp(req, context);
  if (await rateLimitBlocked(storage, 'admin-fail', ip, MAX_FAILS, FAIL_WINDOW)) {
    return json(429, { ok: false, message: 'Too many failed attempts. Try again later.' });
  }

  const auth = req.headers.get('authorization') || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!supplied || !safeEqual(supplied, token)) {
    await rateLimitHit(storage, 'admin-fail', ip, MAX_FAILS, FAIL_WINDOW);
    return json(401, { ok: false, message: 'Wrong or missing access token.' });
  }

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean);

  try {
    if (parts[0] === 'orders') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const keys = (await storage.list('orders/')).sort().reverse(); // keys start with a sortable timestamp
      const slice = keys.slice(offset, offset + limit);
      const items = (await Promise.all(slice.map((k) => storage.getJSON(k)))).filter(Boolean);
      return json(200, { ok: true, total: keys.length, offset, items });
    }

    if (parts[0] === 'photo' && parts.length === 3) {
      const ref = parts[1];
      const n = Number(parts[2]);
      if (!REF_RE.test(ref) || !(n >= 1 && n <= 4)) return json(400, { ok: false, message: 'Bad photo reference.' });
      const keys = await storage.list('photos/' + ref + '/' + n + '.');
      if (!keys.length) return json(404, { ok: false, message: 'Photo not found.' });
      const ext = keys[0].split('.').pop();
      const data = await storage.get(keys[0]);
      if (!data || !IMAGE_TYPES[ext]) return json(404, { ok: false, message: 'Photo not found.' });
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': IMAGE_TYPES[ext],
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'inline'
        }
      });
    }
  } catch (e) {
    console.error('admin error:', e && e.message);
    return json(500, { ok: false, message: 'Could not load data.' });
  }

  return json(404, { ok: false, message: 'Not found.' });
};

export const config = { path: ['/api/admin', '/api/admin/*'] };
