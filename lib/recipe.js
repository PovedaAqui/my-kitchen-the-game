/**
 * Gallo pinto recipe + shared game helpers, used by every API function.
 */

const RECIPE = [
  { id: 0, emoji: '\uD83E\uDED2', label: 'Heat oil in the pan', note: 'A splash of oil over medium heat.' },
  { id: 1, emoji: '\uD83E\uDDC5', label: 'Saute the diced onion', note: 'Until soft and fragrant.' },
  { id: 2, emoji: '\uD83E\uDED1', label: 'Add the chopped chiltoma', note: 'Nicaraguan sweet bell pepper.' },
  { id: 3, emoji: '\uD83E\uDDC4', label: 'Stir in the minced garlic', note: 'Just until aromatic.' },
  { id: 4, emoji: '\uD83E\uDED8', label: 'Add the cooked red beans', note: 'Frijoles rojos de seda.' },
  { id: 5, emoji: '\uD83C\uDF5A', label: 'Fold in the day-old rice', note: 'Cold white rice fries best.' },
  { id: 6, emoji: '\uD83E\uDD63', label: 'Splash in the bean broth', note: 'Gives the pinto its color.' },
  { id: 7, emoji: '\uD83E\uDDC2', label: 'Season with salt', note: 'To taste.' },
  { id: 8, emoji: '\uD83D\uDD25', label: 'Fry until slightly crispy', note: 'Stir so it catches a little.' },
  { id: 9, emoji: '\uD83C\uDF7D\uFE0F', label: 'Plate and serve', note: 'Gallo pinto is ready!' }
];

const MAX_PLAYERS = 10;

function makeRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function newPlayerId() {
  return Math.random().toString(36).slice(2, 10);
}

function computeScore(finishMs, penalties) {
  const score = 1000 - Math.floor(finishMs / 100) - penalties * 150;
  return Math.max(100, score);
}

/** Build the client-facing room snapshot (sorted leaderboard) from raw hash fields. */
function publicRoomState(fields) {
  const meta = fields.meta || { code: null, phase: 'lobby', startedAt: null };
  const players = Object.keys(fields)
    .filter((k) => k.startsWith('p:'))
    .map((k) => fields[k])
    .map((p) => ({
      id: p.id, name: p.name, step: p.step, total: RECIPE.length,
      finished: p.finished, finishMs: p.finishMs, score: p.score, connected: p.connected
    }))
    .sort((a, b) => {
      if (a.finished && b.finished) return a.finishMs - b.finishMs;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.step - a.step;
    });
  return { code: meta.code, phase: meta.phase, startedAt: meta.startedAt, endedAt: meta.endedAt || null, deadline: meta.deadline || null, players, recipe: RECIPE };
}

module.exports = { RECIPE, MAX_PLAYERS, makeRoomCode, newPlayerId, computeScore, publicRoomState };
