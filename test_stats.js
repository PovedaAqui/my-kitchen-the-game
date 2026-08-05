/** Stats instrumentation test: play rounds, then verify aggregate counters. */
const BASE = process.env.BASE || 'http://localhost:3001';
const TOKEN = process.env.STATS_TOKEN || 'testtoken';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());
const raw = (p) => fetch(BASE + p);

(async () => {
  let fail = 0;
  const log = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + msg); if (!ok) fail++; };

  // Auth gating
  const noTok = await raw('/api/stats');
  log(noTok.status === 401, 'stats endpoint rejects missing token (401)');
  const badTok = await raw('/api/stats?token=wrong');
  log(badTok.status === 401, 'stats endpoint rejects bad token (401)');

  // Baseline snapshot
  const before = await get('/api/stats?token=' + TOKEN);
  log(before.ok, 'stats endpoint accepts valid token');
  const b = before.totals;

  // Play 2 full rounds via manual start in one room.
  const code = (await post('/api/create', {})).code;
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await post('/api/join', { code, name: 'P' + i })).playerId);
  // Round 1
  await post('/api/start', { code });
  let st = await get('/api/state?code=' + code + '&playerId=' + ids[0]);
  await wait(60); // let a little time pass so finishMs is realistic (>0)
  for (const id of ids) for (const s of st.order) await post('/api/tap', { code, playerId: id, stepId: s });
  await get('/api/state?code=' + code + '&playerId=' + ids[0]);
  // Reset to lobby, round 2
  await post('/api/reset', { code });
  await post('/api/start', { code });
  st = await get('/api/state?code=' + code + '&playerId=' + ids[0]);
  await wait(60);
  for (const id of ids) for (const s of st.order) await post('/api/tap', { code, playerId: id, stepId: s });
  await get('/api/state?code=' + code + '&playerId=' + ids[0]);

  await wait(200);
  const after = await get('/api/stats?token=' + TOKEN);
  const a = after.totals;

  log(a.roomsCreated - b.roomsCreated === 1, 'roomsCreated +1 (' + b.roomsCreated + ' -> ' + a.roomsCreated + ')');
  log(a.playersJoined - b.playersJoined === 3, 'playersJoined +3 (' + b.playersJoined + ' -> ' + a.playersJoined + ')');
  log(a.roundsStarted - b.roundsStarted === 2, 'roundsStarted +2 (' + b.roundsStarted + ' -> ' + a.roundsStarted + ')');
  log(a.roundsFinished - b.roundsFinished === 2, 'roundsFinished +2 (' + b.roundsFinished + ' -> ' + a.roundsFinished + ')');
  log(a.playersFinished - b.playersFinished === 6, 'playersFinished +6 (' + b.playersFinished + ' -> ' + a.playersFinished + ')');
  log(after.engagement.avgPlayersPerRound > 0, 'avgPlayersPerRound derived (' + after.engagement.avgPlayersPerRound + ')');
  log(after.gameplay.fastestFinishSec != null, 'fastestFinishSec tracked (' + after.gameplay.fastestFinishSec + 's; sub-10ms bot finishes round to 0.00)');
  log(after.gameplay.highScore != null && after.gameplay.highScore > 0, 'highScore tracked (' + after.gameplay.highScore + ')');
  log(after.gameplay.mostPlayersInRoom >= 3, 'mostPlayersInRoom tracked (' + after.gameplay.mostPlayersInRoom + ')');
  log(after.engagement.roundCompletionRate > 0, 'roundCompletionRate derived (' + (after.engagement.roundCompletionRate*100).toFixed(1) + '%)');

  console.log('\n' + (fail === 0 ? 'ALL STATS TESTS PASSED' : fail + ' STATS TEST(S) FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
