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

async function hincrby(key, field, n) {
  const r = redis();
  if (r) return await r.hincrby(key, field, n);
  let m = mem.get(key);
  if (!m) { m = new Map(); mem.set(key, m); }
  const cur = Number(m.get(field) || 0) + n;
  m.set(field, cur);
  return cur;
}

async function del(key) {
  const r = redis();
  if (r) { await r.del(key); return; }
  mem.delete(key);
}

/**
 * Atomically advance a player's step for a tap. Prevents the serverless
 * read-modify-write race where two concurrent taps read the same stale step.
 *
 * On Redis this runs as a single Lua script (the whole read-check-mutate-write
 * is atomic). On the in-memory dev store it's plain synchronous logic (Node is
 * single-threaded, so there's no race to guard against there).
 *
 * `field` is the player hash field (e.g. "p:abc"). `stepId` is the tapped id,
 * `recipeLen` the number of steps, `now` the finish timestamp source.
 * Returns { outcome: 'advance'|'finish'|'duplicate'|'wrong'|'missing'|'notplaying',
 *           player } where player is the updated player object (or null).
 *
 * Scoring is applied by the caller after this returns (keeps score logic in one
 * place); this function only owns the atomic step/penalty mutation.
 */
const TAP_LUA = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return cjson.encode({outcome='missing'}) end
local p = cjson.decode(raw)
local metaRaw = redis.call('HGET', KEYS[1], 'meta')
local meta = metaRaw and cjson.decode(metaRaw) or {}
if meta.phase ~= 'playing' then return cjson.encode({outcome='notplaying'}) end
if p.finished then return cjson.encode({outcome='duplicate', player=p}) end
local stepId = tonumber(ARGV[2])
local recipeLen = tonumber(ARGV[3])
local outcome
if stepId == p.step then
  p.step = p.step + 1
  if p.step >= recipeLen then
    p.finished = true
    outcome = 'finish'
  else
    outcome = 'advance'
  end
elseif stepId < p.step then
  outcome = 'duplicate'
else
  p.penalties = (p.penalties or 0) + 1
  outcome = 'wrong'
end
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(p))
return cjson.encode({outcome=outcome, player=p})
`;

async function tapStep(key, field, stepId, recipeLen) {
  const r = redis();
  if (r) {
    const res = await r.eval(TAP_LUA, [key], [field, String(stepId), String(recipeLen)]);
    return typeof res === 'string' ? JSON.parse(res) : res;
  }
  // In-memory path: single-threaded, so a plain read-modify-write is safe.
  const m = mem.get(key);
  if (!m) return { outcome: 'missing', player: null };
  const p = clone(m.get(field));
  if (!p) return { outcome: 'missing', player: null };
  const meta = m.get('meta');
  if (!meta || meta.phase !== 'playing') return { outcome: 'notplaying', player: null };
  if (p.finished) return { outcome: 'duplicate', player: p };
  let outcome;
  if (stepId === p.step) {
    p.step += 1;
    if (p.step >= recipeLen) { p.finished = true; outcome = 'finish'; }
    else outcome = 'advance';
  } else if (stepId < p.step) {
    outcome = 'duplicate';
  } else {
    p.penalties = (p.penalties || 0) + 1;
    outcome = 'wrong';
  }
  m.set(field, clone(p));
  return { outcome, player: p };
}

function roomKey(code) { return 'room:' + code; }

module.exports = { hset, hgetall, hdel, hincrby, del, tapStep, roomKey, usingRedis: () => !!redis() };
