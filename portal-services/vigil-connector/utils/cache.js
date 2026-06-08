'use strict';

const TTL_MS = parseInt(process.env.VIGIL_CACHE_TTL_MS || '120000', 10);

const store = new Map();

function keyOf(kind, extra) {
  return `${kind}:${extra || 'default'}`;
}

function get(kind, extra) {
  const k = keyOf(kind, extra);
  const e = store.get(k);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(k);
    return null;
  }
  return e.data;
}

function set(kind, data, extra, ttlMs) {
  const k = keyOf(kind, extra);
  store.set(k, { data, expires: Date.now() + (ttlMs || TTL_MS) });
  return data;
}

function invalidate(kind, extra) {
  if (kind) store.delete(keyOf(kind, extra));
  else store.clear();
}

function stats() {
  const now = Date.now();
  let active = 0;
  store.forEach((e) => { if (e.expires > now) active += 1; });
  return { entries: store.size, active, ttl_ms: TTL_MS };
}

module.exports = { get, set, invalidate, stats, TTL_MS };
