const { hset, hgetall, roomKey } = require('../lib/store');
const { newPlayerId, MAX_PLAYERS, RECIPE } = require('../lib/recipe');
const { readBody, send } = require('../lib/http');
const stats = require('../lib/stats');

/** POST /api/join { code, name } -> registers a player, returns playerId. */
module.exports = async (req, res) => {
  const body = await readBody(req);
  const code = (body.code || '').toUpperCase().trim();
  const key = roomKey(code);
  const fields = await hgetall(key);
  if (!fields.meta) return send(res, 404, { ok: false, error: 'Room not found.' });
  if (fields.meta.phase === 'playing') return send(res, 409, { ok: false, error: 'Round in progress — you\'ll be in for the next one.' });

  const playerCount = Object.keys(fields).filter((k) => k.startsWith('p:')).length;
  if (playerCount >= MAX_PLAYERS) return send(res, 409, { ok: false, error: 'Kitchen is full (10 cooks max).' });

  const name = (body.name || '').toString().trim().slice(0, 16) || 'Cook';
  const id = newPlayerId();
  await hset(key, 'p:' + id, {
    id, name, step: 0, penalties: 0, finished: false, finishMs: null, score: 0, connected: true, lastSeen: Date.now()
  });
  await stats.bump({ playersJoined: 1 });
  await stats.trackMax('mostPlayersInRoom', playerCount + 1);
  return send(res, 200, { ok: true, code, playerId: id, name, recipeLength: RECIPE.length });
};
