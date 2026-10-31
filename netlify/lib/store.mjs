// Storage adapter.
//  - On Netlify: Netlify Blobs (private, server-side only, strongly consistent).
//  - Local development / automated tests ONLY: set MAPFIXPRO_LOCAL_STORE_DIR to use plain files.
// Never set MAPFIXPRO_LOCAL_STORE_DIR on Netlify.
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './util.mjs';

const STORE_NAME = 'mapfixpro';

function toArrayBuffer(data) {
  if (typeof data === 'string') return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function wrap(raw) {
  return {
    async putJSON(key, obj) { await raw.put(key, JSON.stringify(obj)); },
    async getJSON(key) {
      const buf = await raw.get(key);
      return buf ? JSON.parse(buf.toString('utf8')) : null;
    },
    put: (key, data) => raw.put(key, data),
    get: (key) => raw.get(key),
    list: (prefix) => raw.list(prefix),
    del: (key) => raw.del(key)
  };
}

async function blobsBackend() {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  return {
    async put(key, data) { await store.set(key, toArrayBuffer(data)); },
    async get(key) {
      const ab = await store.get(key, { type: 'arrayBuffer' });
      return ab ? Buffer.from(ab) : null;
    },
    async list(prefix) {
      const res = await store.list({ prefix });
      return res.blobs.map((b) => b.key);
    },
    async del(key) { await store.delete(key); }
  };
}

function fileBackend(dir) {
  const file = (key) => path.join(dir, encodeURIComponent(key));
  return {
    async put(key, data) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(key), data);
    },
    async get(key) {
      try { return await fs.readFile(file(key)); } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async list(prefix) {
      try {
        const names = await fs.readdir(dir);
        return names.map(decodeURIComponent).filter((k) => k.startsWith(prefix || ''));
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
    async del(key) { try { await fs.unlink(file(key)); } catch (e) { /* already gone */ } }
  };
}

export async function getStorage() {
  const dir = process.env.MAPFIXPRO_LOCAL_STORE_DIR;
  return wrap(dir ? fileBackend(dir) : await blobsBackend());
}

/**
 * Fixed-window counter. Returns true when the caller is still within `limit`.
 * Fails open (returns true) if the counter itself cannot be read or written, so a storage
 * hiccup never blocks real customers.
 */
export async function rateLimitHit(storage, bucket, id, limit, windowSeconds) {
  try {
    const key = 'rl/' + bucket + '/' + sha256(id).slice(0, 32);
    const now = Math.floor(Date.now() / 1000);
    let rec = await storage.getJSON(key);
    if (!rec || now - rec.start > windowSeconds) rec = { start: now, count: 0 };
    rec.count += 1;
    await storage.putJSON(key, rec);
    return rec.count <= limit;
  } catch (e) {
    console.error('rate-limit store error (failing open):', e && e.message);
    return true;
  }
}

/** Read-only check used for admin lockout: true when the bucket is already over the limit. */
export async function rateLimitBlocked(storage, bucket, id, limit, windowSeconds) {
  try {
    const key = 'rl/' + bucket + '/' + sha256(id).slice(0, 32);
    const rec = await storage.getJSON(key);
    if (!rec) return false;
    const now = Math.floor(Date.now() / 1000);
    return now - rec.start <= windowSeconds && rec.count >= limit;
  } catch (e) {
    return false;
  }
}
