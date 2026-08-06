/**
 * Production smoke test against the LIVE deployment (real Upstash Redis).
 * Robust to pre-existing players (the fixed room persists cooks across sessions):
 * it measures the join DELTA and cooks EVERY player present, so a lingering
 * session can't skew the result. Uses /api/start to skip the 30s auto-start.
 */
const BASE = process.env.BASE || 'https://my-kitchen-the-game.vercel.app';
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b||{}) }).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());
const state = () => get('/api/state?code=GAME');

(async () => {
  let fail = 0;
  const log = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + msg); if (!ok) fail++; };

  // 1. Fixed room + stable QR URL, idempotent create.
  const c1 = await post('/api/create');
  const c2 = await post('/api/create');
  log(c1.code === 'GAME' && c2.code === 'GAME', 'production returns fixed code GAME (' + c1.code + '/' + c2.code + ')');
  log(c1.joinUrl === c2.joinUrl && c1.joinUrl.endsWith('/play?room=GAME'), 'stable join URL: ' + c1.joinUrl);
  log(typeof c1.qr === 'string' && c1.qr.startsWith('data:image/png'), 'QR data-URL present');

  // Clean slate.
  await post('/api/reset', { code: 'GAME' });

  // 2. Baseline count, then simulate 3 QR joins -> assert DELTA of 3.
  const baseline = (await state()).players.length;
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = await post('/api/join', { code: 'GAME', name: 'Test' + (i+1) });
    if (r.playerId) ids.push(r.playerId);
  }
  let st = await state();
  log(ids.length === 3, 'joined 3 players via fixed room');
  log(st.players.length - baseline === 3, 'player count grew by exactly 3 (baseline ' + baseline + ' -> ' + st.players.length + ')');
  log(st.phase === 'lobby' && st.countdownMs != null, 'lobby countdown armed (' + st.countdownMs + 'ms)');

  // 3. Idempotency guard: re-create MUST NOT wipe or reset players.
  const beforeCreate = st.players.length;
  await post('/api/create');
  st = await state();
  log(st.players.length === beforeCreate, 're-create did NOT wipe joined players (' + st.players.length + ' present)');

  // 4. Manual start.
  const s = await post('/api/start', { code: 'GAME' });
  log(s.ok && s.startedAt > 0, 'manual start flipped room to playing');
  st = await state();
  log(st.phase === 'playing' && Array.isArray(st.layout) && st.layout.length === 10, 'playing with shuffled 10-tile layout: ' + JSON.stringify(st.layout));

  // 5. Cook EVERY player currently in the room through the fixed order 0..9.
  const allIds = st.players.map(p => p.id);
  for (const id of allIds) for (let stepId = 0; stepId < 10; stepId++) await post('/api/tap', { code: 'GAME', playerId: id, stepId });
  st = await state();
  log(st.phase === 'finished', 'round finished when all cooked (phase=' + st.phase + ')');
  const finishers = st.players.filter(p => p.finished);
  log(finishers.length === st.players.length && finishers.length > 0,
      'every player scored (' + finishers.length + '/' + st.players.length + '), winner=' + st.players[0].name + ' (' + st.players[0].score + 'pts)');

  // 6. Wrong-order tap is penalized (fresh round).
  await post('/api/reset', { code: 'GAME' });
  const solo = await post('/api/join', { code: 'GAME', name: 'Penalty' });
  await post('/api/start', { code: 'GAME' });
  await post('/api/tap', { code: 'GAME', playerId: solo.playerId, stepId: 0 }); // correct
  const bad = await post('/api/tap', { code: 'GAME', playerId: solo.playerId, stepId: 7 }); // wrong
  log(bad.wrong === true, 'out-of-order tap penalized (fixed play order enforced)');

  // 7. Cleanup: reset to a clean lobby.
  await post('/api/reset', { code: 'GAME' });
  st = await state();
  log(st.phase === 'lobby', 'cleaned up — room back to lobby');

  console.log('\n' + (fail === 0 ? 'ALL PRODUCTION TESTS PASSED' : fail + ' TEST(S) FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
