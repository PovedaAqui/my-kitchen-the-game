const { hset, hgetall, roomKey } = require('../lib/store');
const { readBody, send } = require('../lib/http');

/** POST /api/reset { code } -> back to lobby, clears player progress for a new round. */
module.exports = async (req, res) => {
  const body = await readBody(req);
  const code = (body.code || '').toUpperCase().trim();
  const key = roomKey(code);
  const fields = await hgetall(key);
  if (!fields.meta) return send(res, 404, { ok: false, error: 'Room not found.' });

  await hset(key, 'meta', { code, phase: 'lobby', startedAt: null });
  for (const pk of Object.keys(fields).filter((k) => k.startsWith('p:'))) {
    const p = fields[pk];
    await hset(key, pk, { ...p, step: 0, penalties: 0, finished: false, finishMs: null, score: 0 });
  }
  return send(res, 200, { ok: true });
};
