/**
 * HOST-FREE proof against the LIVE deployment.
 * Simulates ONLY what a phone does after scanning the QR:
 *   - POST /api/join   (what the play page does on tap)
 *   - GET  /api/state  (the 700ms client poll)
 * It NEVER calls /api/create (host boot) or /api/start (host button).
 * If the room auto-creates and the round auto-starts, the host is provably
 * not needed for people to play.
 *
 * Uses short lifecycle timings? No — production LOBBY_MS is 30s, so we poll
 * until the auto-start deadline passes on its own.
 */
const BASE = process.env.BASE || 'https://my-kitchen-the-game.vercel.app';
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b||{}) }).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const stateAs = (id) => get('/api/state?code=GAME&playerId=' + id); // includes heartbeat

(async () => {
  let fail = 0;
  const log = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + msg); if (!ok) fail++; };

  // Fresh phone #1 scans the QR and joins. NO host has ever opened this room.
  const p1 = await post('/api/join', { code: 'GAME', name: 'Phone1' });
  log(p1.ok && !!p1.playerId, 'phone scanned QR and joined with NO host open (room auto-created)');

  // The play page immediately starts polling /api/state.
  let st = await stateAs(p1.playerId);
  log(st.ok && st.phase === 'lobby', 'room exists in lobby purely from the player join');
  log(st.countdownMs != null && st.countdownMs > 0, 'auto-start countdown armed by the PLAYER poll (' + Math.round(st.countdownMs/1000) + 's)');

  // A second phone scans a moment later.
  const p2 = await post('/api/join', { code: 'GAME', name: 'Phone2' });
  log(p2.ok && !!p2.playerId, 'second phone joined the same fixed room');

  // Poll like two phones would, until the round AUTO-STARTS. No host, no Start button.
  const t0 = Date.now();
  let started = false;
  while (Date.now() - t0 < 40000) { // production LOBBY_MS is 30s
    await stateAs(p1.playerId);
    st = await stateAs(p2.playerId);
    if (st.phase === 'playing') { started = true; break; }
    await wait(1500);
  }
  log(started, 'round AUTO-STARTED with no host and no Start click (phase=' + st.phase + ')');
  log(Array.isArray(st.layout) && st.layout.length === 10, 'game layout dealt on auto-start: ' + JSON.stringify(st.layout));
  log(st.players.length === 2, 'both phones are in the round (' + st.players.map(p=>p.name).join(', ') + ')');

  // Both cook to completion — round should auto-finish, again host-free.
  for (const id of [p1.playerId, p2.playerId]) for (let s = 0; s < 10; s++) await post('/api/tap', { code:'GAME', playerId:id, stepId:s });
  await stateAs(p1.playerId);
  st = await stateAs(p2.playerId);
  log(st.phase === 'finished', 'round AUTO-FINISHED when both cooked (phase=' + st.phase + ')');
  log(st.players.every(p => p.finished), 'both scored, winner=' + st.players[0].name + ' (' + st.players[0].score + 'pts)');

  // Cleanup: reset to a clean lobby.
  await post('/api/reset', { code: 'GAME' });

  console.log('\n' + (fail === 0 ? 'HOST-FREE: ALL PASSED — players do not need the host' : fail + ' TEST(S) FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
