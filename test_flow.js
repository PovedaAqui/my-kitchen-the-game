/** End-to-end test: fixed-room serverless API + hands-free lifecycle (auto-start + auto-loop). */
const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());
// Keep every player's heartbeat fresh (prevents stale-prune during waits).
const beat = (code, ids) => Promise.all(ids.map(id => get('/api/state?code=' + code + '&playerId=' + id)));

(async () => {
  let fail = 0;
  const log = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + msg); if (!ok) fail++; };

  // 0. Start from a clean lobby so the run is deterministic regardless of prior state.
  const bootstrap = await post('/api/create', {});
  const code = bootstrap.code;
  await post('/api/reset', { code });

  // 1. Fixed room: create is idempotent and always returns the SAME code + join URL.
  const c1 = await post('/api/create', {});
  const c2 = await post('/api/create', {});
  log(!!code, 'fixed room code is ' + code);
  log(c1.code === code && c2.code === code, 'create is idempotent — same code every call (' + c1.code + '/' + c2.code + ')');
  log(c1.joinUrl === c2.joinUrl && /\/play\?room=/.test(c1.joinUrl), 'stable join URL for a fixed QR: ' + c1.joinUrl);
  log(typeof c1.qr === 'string' && c1.qr.startsWith('data:image/png'), 'QR data-URL generated');

  // 1b. Join
  const ids = [];
  for (let i = 0; i < 3; i++) { const r = await post('/api/join', { code, name: 'Cook' + (i+1) }); ids.push(r.playerId); }
  log(ids.every(Boolean), 'joined 3 players');

  // 2. Countdown arms on first join
  let st = await get('/api/state?code=' + code + '&playerId=' + ids[0]);
  log(st.phase === 'lobby' && st.countdownMs != null && st.countdownMs > 0, 'auto-start countdown armed (' + st.countdownMs + 'ms left)');

  // 2b. Create MUST NOT wipe players/round while the room is live (idempotency guard).
  await post('/api/create', {});
  st = await get('/api/state?code=' + code + '&playerId=' + ids[0]);
  log(st.players.length === 3, 'repeat create did NOT wipe joined players');

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
  const layout = st.layout;
  const sortedLayout = layout ? [...layout].sort((a,b)=>a-b).join(',') : '';
  log(Array.isArray(layout) && layout.length === 10 && sortedLayout === '0,1,2,3,4,5,6,7,8,9', 'shuffled display layout present (all 10 ids): ' + JSON.stringify(layout));

  // 3b. Play order is FIXED: tapping out of canonical sequence is penalized.
  await post('/api/tap', { code, playerId: ids[0], stepId: 0 }); // correct first step
  const wrongTap = await post('/api/tap', { code, playerId: ids[0], stepId: 5 }); // should be 1
  log(wrongTap.wrong === true, 'out-of-order tap penalized (fixed play order enforced)');
  for (let s = 1; s < 10; s++) await post('/api/tap', { code, playerId: ids[0], stepId: s });

  // 4. Remaining players cook in FIXED canonical order 0..9 -> auto-finish
  for (const id of ids.slice(1)) for (let stepId = 0; stepId < 10; stepId++) await post('/api/tap', { code, playerId: id, stepId });
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

  // 7. Auto-create-on-join: fresh room after a wipe still accepts a QR scan with no host open.
  await post('/api/reset', { code });
  // Simulate the room having lapsed by deleting it, then join straight from the QR link.
  const solo = await post('/api/join', { code, name: 'Scanner' });
  log(solo.ok && !!solo.playerId, 'player can join the fixed room directly (QR works standalone)');

  // 7b. Manual "start now" override still works
  const sres = await post('/api/start', { code });
  log(sres.ok && sres.startedAt > 0, 'manual "start now" override still works');

  // 8. Randomness: display layout varies across rounds (reset + restart the same fixed room).
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    await post('/api/reset', { code });
    const ppid = (await post('/api/join', { code, name: 'S' })).playerId;
    await post('/api/start', { code });
    const ss = await get('/api/state?code=' + code + '&playerId=' + ppid);
    seen.add(JSON.stringify(ss.layout));
  }
  log(seen.size >= 2, 'display layout varies across rounds (' + seen.size + ' distinct in 8 samples)');

  console.log('\n' + (fail === 0 ? 'ALL TESTS PASSED' : fail + ' TEST(S) FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
