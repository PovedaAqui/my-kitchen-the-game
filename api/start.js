const { hset, hgetall, roomKey } = require('../lib/store');
const { readBody, send } = require('../lib/http');

/** POST /api/start { code } -> flips room to playing, stamps startedAt, resets players. */
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
  await hset(key, 'meta', { code, phase: 'playing', startedAt });
  for (const pk of playerKeys) {
    const p = fields[pk];
    await hset(key, pk, { ...p, step: 0, penalties: 0, finished: false, finishMs: null, score: 0 });
  }
  return send(res, 200, { ok: true, startedAt });
};
