const { hset, hgetall, tapStep, roomKey } = require('../lib/store');
const { RECIPE, computeScore } = require('../lib/recipe');
const { readBody, send } = require('../lib/http');
const stats = require('../lib/stats');

/**
 * POST /api/tap { code, playerId, stepId }
 * Validates the tap against the player's current step. Correct advances;
 * wrong adds a penalty; a tap for an already-completed step is an idempotent
 * no-op. The step/penalty mutation is done ATOMICALLY (single Redis Lua op)
 * so concurrent taps from a fast tapper can't race on a stale step. Finishing
 * computes the score. If every connected player is finished, the room flips
 * to `finished`.
 */
module.exports = async (req, res) => {
  const body = await readBody(req);
  const code = (body.code || '').toUpperCase().trim();
  const playerId = body.playerId;
  const stepId = Number(body.stepId);
  const key = roomKey(code);
  const pk = 'p:' + playerId;

  // Bump this player's heartbeat (separate field) so an actively-tapping player
  // is never pruned mid-round even if their poll is briefly delayed.
  await hset(key, 'hb:' + playerId, Date.now());

  // Atomic step advance / penalty / duplicate detection.
  const { outcome, player: p } = await tapStep(key, pk, stepId, RECIPE.length);
  if (outcome === 'missing') return send(res, 404, { ok: false, error: 'Player not found.' });
  if (outcome === 'notplaying') return send(res, 409, { ok: false, error: 'Not in play.' });

  let result;
  if (outcome === 'finish') {
    // Only ONE tap ever gets 'finish' (subsequent taps see finished=true and
    // return 'duplicate'), so writing the score here is race-free.
    const startedAt = (await hgetall(key)).meta.startedAt;
    p.finishMs = Date.now() - startedAt;
    p.score = computeScore(p.finishMs, p.penalties || 0);
    await hset(key, pk, p);
    result = { ok: true, finished: true, score: p.score, finishMs: p.finishMs, penalties: p.penalties || 0 };
  } else if (outcome === 'duplicate') {
    // Already-completed step (double-tap / late retry) or already finished.
    result = p && p.finished
      ? { ok: true, finished: true, score: p.score, finishMs: p.finishMs }
      : { ok: true, step: p ? p.step : 0, duplicate: true };
  } else if (outcome === 'wrong') {
    result = { ok: true, wrong: true, step: p.step, penalties: p.penalties };
  } else { // 'advance'
    result = { ok: true, step: p.step };
  }

  // Re-read to check if the whole room is done (accounts for concurrent finishers).
  const after = await hgetall(key);
  const players = Object.keys(after).filter((k) => k.startsWith('p:')).map((k) => after[k]);
  const active = players.filter((x) => x.connected);
  if (active.length > 0 && active.every((x) => x.finished) && after.meta && after.meta.phase === 'playing') {
    await hset(key, 'meta', { ...after.meta, phase: 'finished', endedAt: Date.now(), deadline: null });
    await stats.recordEvent({
      type: 'roundFinished',
      timedOut: false,
      players: active.map((x) => ({ finishMs: x.finishMs, score: x.score, penalties: x.penalties, timedOut: !!x.timedOut }))
    });
  }
  return send(res, 200, result);
};
