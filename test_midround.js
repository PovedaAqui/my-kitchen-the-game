/** Verifies the mid-round join contract: 409 + roundInProgress while playing,
 *  then success once the room auto-loops back to lobby. */
const BASE = 'http://localhost:3000';
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b||{}) }).then(async r => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(BASE + p).then(r => r.json());
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let fail = 0;
  const log = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + msg); if (!ok) fail++; };

  await post('/api/create');
  await post('/api/reset', { code: 'GAME' });

  // Player A joins and the round auto-starts (LOBBY_MS=2s in dev).
  const a = (await post('/api/join', { code: 'GAME', name: 'A' })).body;
  const t0 = Date.now();
  let st;
  while (Date.now() - t0 < 5000) {
    await get('/api/state?code=GAME&playerId=' + a.playerId);
    st = await get('/api/state?code=GAME&playerId=' + a.playerId);
    if (st.phase === 'playing') break;
    await wait(300);
  }
  log(st.phase === 'playing', 'round is playing (' + st.phase + ')');

  // Player B tries to join MID-ROUND -> 409 with explicit roundInProgress flag.
  const midJoin = await post('/api/join', { code: 'GAME', name: 'Latecomer' });
  log(midJoin.status === 409, 'mid-round join rejected with 409 (got ' + midJoin.status + ')');
  log(midJoin.body.roundInProgress === true, 'response carries roundInProgress:true (the auto-retry signal)');
  log(!midJoin.body.playerId, 'no playerId issued mid-round (not placed in a new/other room)');

  // Finish the round so it auto-loops back to lobby.
  for (let s = 0; s < 10; s++) await post('/api/tap', { code:'GAME', playerId:a.playerId, stepId:s });
  const t1 = Date.now();
  while (Date.now() - t1 < 6000) {
    await get('/api/state?code=GAME&playerId=' + a.playerId);
    st = await get('/api/state?code=GAME');
    if (st.phase === 'lobby') break;
    await wait(300);
  }
  log(st.phase === 'lobby', 'room auto-looped back to lobby (' + st.phase + ')');

  // Player B's background retry would now succeed.
  const retry = await post('/api/join', { code: 'GAME', name: 'Latecomer' });
  log(retry.status === 200 && retry.body.ok && !!retry.body.playerId, 'the same join now SUCCEEDS once looped to lobby (auto-retry lands them in next round)');

  await post('/api/reset', { code: 'GAME' });
  console.log('\n' + (fail === 0 ? 'MID-ROUND JOIN CONTRACT: ALL PASSED' : fail + ' FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
