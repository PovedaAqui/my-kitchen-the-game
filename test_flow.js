/** End-to-end test: serverless API + hands-free lifecycle (auto-start + auto-loop). */
const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());
// Keep every player's heartbeat fresh (prevents stale-prune during waits).
const beat = (code, ids) => Promise.all(ids.map(id => get('/api/state?code=' + code + '&playerId=' + id)));

(async () => {
  let fail = 0;
  const log = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + msg); if (!ok) fail++; };

  // 1. Create + join
  const created = await post('/api/create', {});
  const code = created.code;
  log(!!code, 'created room ' + code);
  const ids = [];
  for (let i = 0; i < 3; i++) { const r = await post('/api/join', { code, name: 'Cook' + (i+1) }); ids.push(r.playerId); }
  log(ids.every(Boolean), 'joined 3 players');

  // 2. Countdown arms on first join
  let st = await get('/api/state?code=' + code + '&playerId=' + ids[0]);
  log(st.phase === 'lobby' && st.countdownMs != null && st.countdownMs > 0, 'auto-start countdown armed (' + st.countdownMs + 'ms left)');

  // 3. Wait past LOBBY_MS (test uses 2s) -> a poll should auto-start
  const t0 = Date.now();
  let started = false;
  while (Date.now() - t0 < 5000) {
    await beat(code, ids);
    st = await get('/api/state?code=' + code + '&playerId=' + ids[0]);
    if (st.phase === 'playing') { started = true; break; }
    await wait(300);
  }
  log(started, 'game AUTO-STARTED with no host click (phase=' + st.phase + ')');
  log(st.recipe && st.recipe.length === 10, 'recipe present on auto-start');
  log(Array.isArray(st.order) && st.order.length === 10 && st.order[0] === 0 && st.order[9] === 9, 'shuffled order present, anchored [0..9]: ' + JSON.stringify(st.order));
  const order = st.order;

  // 4. All players cook FOLLOWING THE SHUFFLED ORDER -> auto-finish
  for (const id of ids) for (const stepId of order) await post('/api/tap', { code, playerId: id, stepId });
  await beat(code, ids);
  st = await get('/api/state?code=' + code + '&playerId=' + ids[0]);
  log(st.phase === 'finished', 'room auto-finished when all cooked (phase=' + st.phase + ')');
  log(st.players.filter(p => p.finished).length === 3, 'all 3 finished, winner=' + st.players[0].name);

  // 5. Wait past RESULTS_MS (test uses 2s) -> AUTO-LOOP back to lobby
  const t1 = Date.now();
  let looped = false;
  while (Date.now() - t1 < 6000) {
    await beat(code, ids);
    st = await get('/api/state?code=' + code + '&playerId=' + ids[0]);
    if (st.phase === 'lobby') { looped = true; break; }
    await wait(300);
  }
  log(looped, 'AUTO-LOOPED back to lobby for next round (phase=' + st.phase + ')');
  log(st.players.length === 3 && st.players.every(p => p.step === 0 && !p.finished), 'players kept + reset for round 2');
  log(st.countdownMs != null, 'countdown re-armed for round 2 (' + st.countdownMs + 'ms)');

  // 6. Stale prune: stop beating one player, wait past STALE_MS (test 3s)
  const survivors = ids.slice(0, 2);
  const t2 = Date.now();
  let pruned = false;
  while (Date.now() - t2 < 6000) {
    await beat(code, survivors); // only 2 of 3 keep heartbeating
    st = await get('/api/state?code=' + code + '&playerId=' + survivors[0]);
    if (st.players.length === 2) { pruned = true; break; }
    await wait(400);
  }
  log(pruned, 'stale player pruned after missed heartbeats (' + st.players.length + ' left)');

  // 7. Manual "start now" override still works
  const emptyCheck = await post('/api/create', {});
  const c2 = emptyCheck.code;
  const pid = (await post('/api/join', { code: c2, name: 'Solo' })).playerId;
  const sres = await post('/api/start', { code: c2 });
  log(sres.ok && sres.startedAt > 0, 'manual "start now" override still works');

  // 8. Randomness: wrong-order tap penalized + order varies across rounds.
  const s2 = await get('/api/state?code=' + c2 + '&playerId=' + pid);
  const ord2 = s2.order;
  log(ord2 && ord2[0] === 0 && ord2[9] === 9, 'manual start also produced shuffled order: ' + JSON.stringify(ord2));
  // Tap correct first step, then a deliberately out-of-order id.
  await post('/api/tap', { code: c2, playerId: pid, stepId: ord2[0] });
  const badId = [1,2,3,4,5,6,7,8].find((x) => x !== ord2[1]);
  const bad = await post('/api/tap', { code: c2, playerId: pid, stepId: badId });
  log(bad.wrong === true, 'wrong-order tap rejected as penalty (tapped ' + badId + ', expected ' + ord2[1] + ')');
  // Sample several fresh rounds; expect at least 2 distinct orders.
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const cc = (await post('/api/create', {})).code;
    const ppid = (await post('/api/join', { code: cc, name: 'S' })).playerId;
    await post('/api/start', { code: cc });
    const ss = await get('/api/state?code=' + cc + '&playerId=' + ppid);
    seen.add(JSON.stringify(ss.order));
  }
  log(seen.size >= 2, 'order varies across rounds (' + seen.size + ' distinct in 6 samples)');

  console.log('\n' + (fail === 0 ? 'ALL TESTS PASSED' : fail + ' TEST(S) FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
