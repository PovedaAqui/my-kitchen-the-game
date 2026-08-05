/** End-to-end test against the local dev server (in-memory store fallback). */
const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

(async () => {
  let fail = 0;
  const log = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + msg); if (!ok) fail++; };

  // 1. Create room
  const created = await post('/api/create', {});
  log(created.code && created.code.length === 4, 'created room ' + created.code);
  log(!!created.qr && created.qr.startsWith('data:image'), 'QR data URL generated');
  log(created.maxPlayers === 10, 'max players = 10');
  const code = created.code;

  // 2. Join 10 players
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const r = await post('/api/join', { code, name: 'Cook' + (i+1) });
    if (!r.ok) log(false, 'join ' + (i+1) + ': ' + r.error); else ids.push(r.playerId);
  }
  log(ids.length === 10, 'joined 10 players');

  // 3. 11th rejected
  const r11 = await post('/api/join', { code, name: 'Overflow' });
  log(!r11.ok && /full/i.test(r11.error), '11th player rejected: "' + r11.error + '"');

  // 4. State shows 10 in lobby
  let st = await get('/api/state?code=' + code);
  log(st.ok && st.players.length === 10 && st.phase === 'lobby', 'state: 10 cooks in lobby');

  // 5. Start
  const started = await post('/api/start', { code });
  log(started.ok && started.startedAt > 0, 'game started');
  st = await get('/api/state?code=' + code);
  log(st.phase === 'playing' && st.recipe.length === 10, 'phase playing, 10-step recipe present');

  // 6. Wrong tap = penalty, no advance
  const wrong = await post('/api/tap', { code, playerId: ids[0], stepId: 5 });
  log(wrong.ok && wrong.wrong && wrong.penalties === 1 && wrong.step === 0, 'wrong tap penalized, step stays 0');

  // 7. Player 0 cooks clean and fast
  for (let s = 0; s < 10; s++) {
    var res0 = await post('/api/tap', { code, playerId: ids[0], stepId: s });
  }
  log(res0.finished && res0.penalties === 1, 'player 0 finished (1 earlier penalty), score=' + res0.score);

  // 8. Player 5 makes 2 wrong taps then finishes
  await post('/api/tap', { code, playerId: ids[5], stepId: 9 });
  await post('/api/tap', { code, playerId: ids[5], stepId: 3 });
  let res5;
  for (let s = 0; s < 10; s++) res5 = await post('/api/tap', { code, playerId: ids[5], stepId: s });
  log(res5.finished && res5.penalties === 2, 'player 5 finished with 2 penalties, score=' + res5.score);
  log(res0.score > res5.score, 'faster/cleaner player 0 outscored player 5 (' + res0.score + ' > ' + res5.score + ')');

  // 9. Remaining players finish -> room goes finished
  for (let i = 1; i < 10; i++) {
    if (i === 5) continue;
    for (let s = 0; s < 10; s++) await post('/api/tap', { code, playerId: ids[i], stepId: s });
  }
  await wait(100);
  st = await get('/api/state?code=' + code);
  log(st.phase === 'finished', 'room reached finished phase');
  log(st.players.filter(p => p.finished).length === 10, 'all 10 players finished');
  log(st.players[0].finished, 'leaderboard sorted, top = ' + st.players[0].name + ' @ ' + (st.players[0].finishMs/1000).toFixed(2) + 's · ' + st.players[0].score + 'pts');

  // 10. Reset -> lobby
  await post('/api/reset', { code });
  st = await get('/api/state?code=' + code);
  log(st.phase === 'lobby' && st.players.every(p => p.step === 0 && !p.finished), 'reset returns room to fresh lobby');

  console.log('\n' + (fail === 0 ? 'ALL TESTS PASSED' : fail + ' TEST(S) FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
