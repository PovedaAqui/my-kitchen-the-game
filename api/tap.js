const { hset, hgetall, roomKey } = require('../lib/store');
const { RECIPE, computeScore, publicRoomState } = require('../lib/recipe');
const { readBody, send } = require('../lib/http');

/**
 * POST /api/tap { code, playerId, stepId }
 * Validates the tap against the player's current step. Correct advances;
 * wrong adds a penalty. Finishing computes the score. If every connected
 * player is finished, the room flips to `finished`.
 */
module.exports = async (req, res) => {
  const body = await readBody(req);
  const code = (body.code || '').toUpperCase().trim();
  const playerId = body.playerId;
  const stepId = Number(body.stepId);
  const key = roomKey(code);
  const fields = await hgetall(key);
  if (!fields.meta) return send(res, 404, { ok: false, error: 'Room not found.' });
  if (fields.meta.phase !== 'playing') return send(res, 409, { ok: false, error: 'Not in play.' });

  const pk = 'p:' + playerId;
  const p = fields[pk];
  if (!p) return send(res, 404, { ok: false, error: 'Player not found.' });
  if (p.finished) return send(res, 200, { ok: true, finished: true, score: p.score, finishMs: p.finishMs });

  const startedAt = fields.meta.startedAt;
  let result;
  if (stepId === p.step) {
    p.step += 1;
    if (p.step >= RECIPE.length) {
      p.finished = true;
      p.finishMs = Date.now() - startedAt;
      p.score = computeScore(p.finishMs, p.penalties);
      result = { ok: true, finished: true, score: p.score, finishMs: p.finishMs, penalties: p.penalties };
    } else {
      result = { ok: true, step: p.step };
    }
  } else {
    p.penalties += 1;
    result = { ok: true, wrong: true, step: p.step, penalties: p.penalties };
  }
  await hset(key, pk, p);

  // Re-read to check if the whole room is done (accounts for concurrent finishers).
  const after = await hgetall(key);
  const players = Object.keys(after).filter((k) => k.startsWith('p:')).map((k) => after[k]);
  const active = players.filter((x) => x.connected);
  if (active.length > 0 && active.every((x) => x.finished) && after.meta.phase === 'playing') {
    await hset(key, 'meta', { ...after.meta, phase: 'finished' });
  }
  return send(res, 200, result);
};
