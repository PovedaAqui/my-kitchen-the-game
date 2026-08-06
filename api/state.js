const { hgetall, hset, hdel, roomKey } = require('../lib/store');
const { publicRoomState } = require('../lib/recipe');
const { advance, LOBBY_MS } = require('../lib/lifecycle');
const { send } = require('../lib/http');
const stats = require('../lib/stats');

/**
 * GET /api/state?code=XXXX[&playerId=YYY]
 * Polled by host + players (~700ms). This is the tick that drives the whole
 * hands-free lifecycle: it advances the room (auto-start countdown, play cap,
 * auto-loop reset) and persists any transition before returning the snapshot.
 * If playerId is present, it also refreshes that player's heartbeat.
 */
module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const code = (url.searchParams.get('code') || '').toUpperCase().trim();
  const playerId = url.searchParams.get('playerId');
  const key = roomKey(code);
  const fields = await hgetall(key);
  if (!fields.meta) return send(res, 404, { ok: false, error: 'Room not found.' });

  const now = Date.now();

  // Heartbeat: mark this poller as alive so the lifecycle doesn't prune them.
  // Written to a SEPARATE field (hb:<id>), never the player object, so a poll's
  // heartbeat can never clobber a concurrent tap's step advance (they touch
  // different hash fields, which Redis updates independently).
  if (playerId && fields['p:' + playerId]) {
    await hset(key, 'hb:' + playerId, now);
    fields['hb:' + playerId] = now; // reflect locally for advance()'s prune check
  }

  // Advance lifecycle and persist any resulting mutations.
  const { writes, events } = advance(fields, now);
  for (const w of writes) {
    if (w.value === null) await hdel(key, w.field);
    else await hset(key, w.field, w.value);
  }
  // Record analytics for any lifecycle transitions (fire-and-forget).
  for (const ev of events) await stats.recordEvent(ev);

  const state = publicRoomState(fields);
  // Expose countdown remaining (ms) so clients can render it without clock skew.
  const countdownMs = state.phase === 'lobby' && state.deadline ? Math.max(0, state.deadline - now) : null;
  return send(res, 200, { ok: true, ...state, countdownMs, lobbyMs: LOBBY_MS, serverNow: now });
};
