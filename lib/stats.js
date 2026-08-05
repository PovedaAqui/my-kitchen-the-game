/**
 * Durable usage analytics — aggregate totals only, no TTL.
 *
 * Everything lives in a single Redis hash `stats:global`, incremented as events
 * happen. This is separate from the room hashes (which expire in 2h); stats
 * persist indefinitely. Because it's one hash of plain counters, reading the
 * whole dashboard is a single hgetall.
 *
 * IMPORTANT: stats only accrue from the moment this code is deployed. Activity
 * before instrumentation was never recorded and cannot be recovered.
 *
 * Fire-and-forget: every bump is wrapped so an analytics failure can never
 * break gameplay (a stats write erroring must not fail a player's tap).
 */

const { hincrby, hgetall, hset } = require('./store');

const KEY = 'stats:global';

// One-time init marker so the dashboard can show "collecting since".
async function ensureInit() {
  try {
    const f = await hgetall(KEY);
    if (!f.since) await hset(KEY, 'since', Date.now());
  } catch (_) { /* ignore */ }
}

/** Increment one or more counters. Never throws. */
async function bump(fields) {
  try {
    await ensureInit();
    for (const [k, v] of Object.entries(fields)) {
      await hincrby(KEY, k, v);
    }
  } catch (_) { /* analytics must never break gameplay */ }
}

/** Track a running maximum (e.g. high score, most players in a room). Never throws. */
async function trackMax(field, value) {
  try {
    await ensureInit();
    const f = await hgetall(KEY);
    const cur = Number(f[field]);
    if (!Number.isFinite(cur) || value > cur) await hset(KEY, field, value);
  } catch (_) { /* ignore */ }
}

/** Track a running minimum for positive values (e.g. fastest finish ms). Never throws. */
async function trackMin(field, value) {
  try {
    if (!(value > 0)) return;
    await ensureInit();
    const f = await hgetall(KEY);
    const cur = Number(f[field]);
    if (!Number.isFinite(cur) || cur <= 0 || value < cur) await hset(KEY, field, value);
  } catch (_) { /* ignore */ }
}

/** Read + derive the full dashboard payload. */
async function snapshot() {
  const f = await hgetall(KEY);
  const n = (k) => Number(f[k] || 0);

  const roomsCreated = n('roomsCreated');
  const playersJoined = n('playersJoined');
  const roundsStarted = n('roundsStarted');
  const roundsFinished = n('roundsFinished');
  const playersFinished = n('playersFinished');
  const playersTimedOut = n('playersTimedOut');
  const totalPenalties = n('totalPenalties');
  const sumFinishMs = n('sumFinishMs');
  const sumPlayersPerRound = n('sumPlayersPerRound');

  return {
    since: n('since') || null,
    totals: {
      roomsCreated,
      playersJoined,
      roundsStarted,
      roundsFinished,
      playersFinished,
      playersTimedOut
    },
    engagement: {
      avgPlayersPerRound: roundsStarted ? +(sumPlayersPerRound / roundsStarted).toFixed(2) : 0,
      avgRoundsPerRoom: roomsCreated ? +(roundsStarted / roomsCreated).toFixed(2) : 0,
      roundCompletionRate: roundsStarted ? +(roundsFinished / roundsStarted).toFixed(3) : 0,
      timedOutRounds: n('timedOutRounds')
    },
    gameplay: {
      avgFinishSec: playersFinished ? +((sumFinishMs / playersFinished) / 1000).toFixed(2) : 0,
      fastestFinishSec: n('fastestFinishMs') > 0 ? +(n('fastestFinishMs') / 1000).toFixed(2) : null,
      highScore: n('highScore') || null,
      mostPlayersInRoom: n('mostPlayersInRoom') || null,
      avgPenaltiesPerFinish: playersFinished ? +(totalPenalties / playersFinished).toFixed(2) : 0
    }
  };
}

/**
 * Translate a lifecycle event into stat writes. Centralized so every code path
 * (auto-advance, manual start, all-finished-in-tap) records identically. Never throws.
 */
async function recordEvent(ev) {
  try {
    if (!ev) return;
    if (ev.type === 'roundStarted') {
      await bump({ roundsStarted: 1, sumPlayersPerRound: ev.players || 0 });
    } else if (ev.type === 'roundFinished') {
      const players = ev.players || [];
      let finished = 0, timedOut = 0, penalties = 0, sumMs = 0;
      for (const p of players) {
        if (p.timedOut) { timedOut++; } else { finished++; sumMs += (p.finishMs || 0); }
        penalties += (p.penalties || 0);
        if (!p.timedOut) {
          await trackMin('fastestFinishMs', p.finishMs || 0);
        }
        await trackMax('highScore', p.score || 0);
      }
      await bump({
        roundsFinished: 1,
        playersFinished: finished,
        playersTimedOut: timedOut,
        totalPenalties: penalties,
        sumFinishMs: sumMs,
        timedOutRounds: ev.timedOut ? 1 : 0
      });
    }
  } catch (_) { /* analytics must never break gameplay */ }
}

module.exports = { bump, trackMax, trackMin, recordEvent, snapshot, KEY };
