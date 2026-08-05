const { hgetall, hset, hdel, roomKey } = require('../lib/store');
const { publicRoomState } = require('../lib/recipe');
const { advance, LOBBY_MS } = require('../lib/lifecycle');
const { send } = require('../lib/http');

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
  if (playerId && fields['p:' + playerId]) {
    fields['p:' + playerId].lastSeen = now;
    await hset(key, 'p:' + playerId, fields['p:' + playerId]);
  }

  // Advance lifecycle and persist any resulting mutations.
  const writes = advance(fields, now);
  for (const w of writes) {
    if (w.value === null) await hdel(key, w.field);
    else await hset(key, w.field, w.value);
  }

  const state = publicRoomState(fields);
  // Expose countdown remaining (ms) so clients can render it without clock skew.
  const countdownMs = state.phase === 'lobby' && state.deadline ? Math.max(0, state.deadline - now) : null;
  return send(res, 200, { ok: true, ...state, countdownMs, lobbyMs: LOBBY_MS, serverNow: now });
};
