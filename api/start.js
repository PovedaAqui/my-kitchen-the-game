const { hset, hgetall, roomKey } = require('../lib/store');
const { makeOrder } = require('../lib/recipe');
const { readBody, send } = require('../lib/http');
const stats = require('../lib/stats');

/** POST /api/start { code } -> manual override: flips room to playing with a fresh shuffled order. */
module.exports = async (req, res) => {
  const body = await readBody(req);
  const code = (body.code || '').toUpperCase().trim();
  const key = roomKey(code);
  const fields = await hgetall(key);
  if (!fields.meta) return send(res, 404, { ok: false, error: 'Room not found.' });
  if (fields.meta.phase !== 'lobby') return send(res, 409, { ok: false, error: 'Already started.' });

  const playerKeys = Object.keys(fields).filter((k) => k.startsWith('p:'));
  if (playerKeys.length === 0) return send(res, 409, { ok: false, error: 'No cooks have joined yet.' });

  const startedAt = Date.now();
  await hset(key, 'meta', { code, phase: 'playing', startedAt, deadline: null, endedAt: null, order: makeOrder() });
  for (const pk of playerKeys) {
    const p = fields[pk];
    await hset(key, pk, { ...p, step: 0, penalties: 0, finished: false, finishMs: null, score: 0, lastSeen: Date.now() });
  }
  await stats.recordEvent({ type: 'roundStarted', players: playerKeys.length });
  return send(res, 200, { ok: true, startedAt });
};
