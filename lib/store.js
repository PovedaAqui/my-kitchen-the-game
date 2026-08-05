/**
 * Shared state store.
 * In production on Vercel, backed by Upstash Redis (via the Vercel Upstash
 * integration, which injects UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_*).
 * Locally, when no credentials are present, it falls back to an in-process
 * Map so the game logic can be run and tested without any external service.
 *
 * Each game room is a single Redis hash keyed `room:<CODE>` with fields:
 *   meta        -> { code, phase, startedAt }
 *   p:<id>      -> { id, name, step, penalties, finished, finishMs, score, connected }
 * Storing each player in its own hash field means a player's tap only writes
 * that player's field, so concurrent taps from different players never clobber
 * one another.
 */

const KEY_TTL_SECONDS = 60 * 60 * 2; // rooms self-expire after 2h

let _redis; // undefined = not resolved, null = no creds
function redis() {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  const { Redis } = require('@upstash/redis');
  _redis = new Redis({ url, token });
  return _redis;
}

const mem = globalThis.__mkMem || (globalThis.__mkMem = new Map()); // key -> Map(field -> obj)
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

async function hset(key, field, obj) {
  const r = redis();
  if (r) {
    await r.hset(key, { [field]: obj });
    await r.expire(key, KEY_TTL_SECONDS);
    return;
  }
  let m = mem.get(key);
  if (!m) { m = new Map(); mem.set(key, m); }
  m.set(field, clone(obj));
}

async function hgetall(key) {
  const r = redis();
  if (r) return (await r.hgetall(key)) || {};
  const m = mem.get(key);
  if (!m) return {};
  const o = {};
  for (const [k, v] of m) o[k] = clone(v);
  return o;
}

async function hdel(key, field) {
  const r = redis();
  if (r) { await r.hdel(key, field); return; }
  const m = mem.get(key);
  if (m) m.delete(field);
}

async function del(key) {
  const r = redis();
  if (r) { await r.del(key); return; }
  mem.delete(key);
}

function roomKey(code) { return 'room:' + code; }

module.exports = { hset, hgetall, hdel, del, roomKey, usingRedis: () => !!redis() };
