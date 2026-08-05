/**
 * Server-driven room lifecycle — the piece that lets the game run WITHOUT a
 * host clicking Start every round.
 *
 * Vercel is serverless: there are no background timers or long-lived processes.
 * So the lifecycle is advanced LAZILY. Every /api/state poll (host and players
 * poll ~700ms) calls advance(), which is a pure function of the stored room
 * state + the current wall clock. It decides, idempotently, whether a phase
 * transition is due and returns the field mutations to persist. Whoever polls
 * first triggers the transition; everyone else sees the already-applied result.
 *
 * Timeline of one hands-free round:
 *   lobby (idle)  --first player joins-->  lobby (armed, deadline = now+LOBBY_MS)
 *   lobby armed   --deadline passes-->      playing (startedAt = now)
 *   playing       --all finish OR PLAY_MS-->finished (endedAt = now)
 *   finished      --RESULTS_MS passes-->    lobby (idle, players kept + reset)
 *
 * Config (ms):
 *   LOBBY_MS   countdown once the first cook is in the lobby
 *   PLAY_MS    hard cap on a round so one stuck player can't wedge the loop
 *   RESULTS_MS how long the final board is shown before auto-resetting
 *   STALE_MS   a player is pruned if their last heartbeat is older than this
 */

const LOBBY_MS = Number(process.env.LOBBY_MS) || 30000;
const PLAY_MS = Number(process.env.PLAY_MS) || 120000;
const RESULTS_MS = Number(process.env.RESULTS_MS) || 15000;
const STALE_MS = Number(process.env.STALE_MS) || 12000;

const { RECIPE, computeScore } = require('./recipe');

function playerFields(fields) {
  return Object.keys(fields).filter((k) => k.startsWith('p:'));
}

/**
 * Advance the room based on `now`. Mutates the passed-in `fields` object in
 * place AND returns a list of { field, value } writes the caller must persist
 * (value === null means delete the field). Returns [] when nothing changed.
 */
function advance(fields, now) {
  const writes = [];
  if (!fields.meta) return writes;
  const meta = fields.meta;
  const setMeta = (patch) => {
    Object.assign(meta, patch);
    writes.push({ field: 'meta', value: meta });
  };

  // --- Prune stale players (missed heartbeats). Never prune mid-round finishers. ---
  const pkeys = playerFields(fields);
  for (const pk of pkeys) {
    const p = fields[pk];
    const last = p.lastSeen || 0;
    const stale = now - last > STALE_MS;
    if (stale && !(meta.phase === 'playing' && p.finished)) {
      delete fields[pk];
      writes.push({ field: pk, value: null });
    }
  }

  const activeKeys = playerFields(fields);
  const players = activeKeys.map((k) => fields[k]);

  if (meta.phase === 'lobby') {
    if (players.length === 0) {
      // Empty lobby: disarm any countdown.
      if (meta.deadline != null) setMeta({ deadline: null });
    } else {
      // Someone's here: arm the countdown if not already armed.
      if (meta.deadline == null) {
        setMeta({ deadline: now + LOBBY_MS });
      } else if (now >= meta.deadline) {
        // Countdown elapsed -> auto-start.
        const startedAt = now;
        for (const pk of activeKeys) {
          const p = fields[pk];
          Object.assign(p, { step: 0, penalties: 0, finished: false, finishMs: null, score: 0 });
          writes.push({ field: pk, value: p });
        }
        setMeta({ phase: 'playing', startedAt, deadline: null, endedAt: null });
      }
    }
  } else if (meta.phase === 'playing') {
    const connected = players; // all remaining are considered connected
    const allDone = connected.length > 0 && connected.every((p) => p.finished);
    const timedOut = meta.startedAt != null && now - meta.startedAt >= PLAY_MS;
    if (allDone || timedOut) {
      // Any unfinished player at timeout gets scored on what they completed.
      if (timedOut) {
        for (const pk of activeKeys) {
          const p = fields[pk];
          if (!p.finished) {
            p.finished = true;
            p.finishMs = PLAY_MS;
            p.timedOut = true;
            p.score = Math.max(50, computeScore(PLAY_MS, p.penalties) - (RECIPE.length - p.step) * 50);
            writes.push({ field: pk, value: p });
          }
        }
      }
      setMeta({ phase: 'finished', endedAt: now, deadline: null });
    }
  } else if (meta.phase === 'finished') {
    if (meta.endedAt != null && now - meta.endedAt >= RESULTS_MS) {
      // Auto-loop: reset kept players and drop back to an idle lobby.
      for (const pk of activeKeys) {
        const p = fields[pk];
        Object.assign(p, { step: 0, penalties: 0, finished: false, finishMs: null, score: 0, timedOut: false });
        writes.push({ field: pk, value: p });
      }
      setMeta({ phase: 'lobby', startedAt: null, endedAt: null, deadline: null });
    }
  }

  return writes;
}

module.exports = { advance, LOBBY_MS, PLAY_MS, RESULTS_MS, STALE_MS };
