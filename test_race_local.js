/**
 * LOCAL test against dev-server: taps interleaved with concurrent /api/state
 * heartbeat polls (the real client runs both). Before the hb: decoupling, a poll
 * could clobber a tap's step advance. After it, they touch different fields.
 * Also exercises the server-side idempotent duplicate guard.
 */
const B = 'http://localhost:3000';
const post = (p, b) => fetch(B + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b||{}) }).then(r => r.json());
const get = (p) => fetch(B + p).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let fail = 0;
  const log = (ok, m) => { console.log((ok?'PASS':'FAIL')+' - '+m); if(!ok) fail++; };

  // --- Test 1: taps with a hammering background poll (heartbeat clobber race) ---
  await post('/api/create'); await post('/api/reset', { code:'GAME' });
  const id = (await post('/api/join', { code:'GAME', name:'Racer' })).playerId;
  await post('/api/start', { code:'GAME' });

  let polling = true;
  const poller = (async () => { while (polling) { await get('/api/state?code=GAME&playerId='+id); await sleep(20); } })();

  // Serialized taps (like the fixed client), but a poll is firing every 20ms in parallel.
  let wrongs = 0;
  for (let s = 0; s < 10; s++) {
    const r = await post('/api/tap', { code:'GAME', playerId:id, stepId:s });
    if (r.wrong) wrongs++;
    await sleep(30);
  }
  polling = false; await poller;
  let st = await get('/api/state?code=GAME&playerId='+id);
  let me = st.players.find(p => p.id === id);
  log(wrongs === 0, 'taps with concurrent heartbeat polls: no false wrongs ('+wrongs+')');
  log(me && me.finished, 'player finished despite hammering polls (step='+(me?me.step:'?')+')');

  // --- Test 2: server idempotent duplicate guard ---
  await post('/api/reset', { code:'GAME' });
  const id2 = (await post('/api/join', { code:'GAME', name:'Dup' })).playerId;
  await post('/api/start', { code:'GAME' });
  await post('/api/tap', { code:'GAME', playerId:id2, stepId:0 }); // step 0 -> now at 1
  const dup = await post('/api/tap', { code:'GAME', playerId:id2, stepId:0 }); // repeat 0
  log(dup.duplicate === true && !dup.wrong, 'duplicate tap on completed step is a no-op, not a penalty');
  log(!('penalties' in dup) || dup.penalties === 0, 'duplicate response carries no penalty increment');
  st = await get('/api/state?code=GAME&playerId='+id2);
  me = st.players.find(p => p.id === id2);
  log(me.step === 1, 'step not corrupted by duplicate (step='+me.step+')');

  // --- Test 3: genuine wrong (skip ahead) still penalized ---
  const bad = await post('/api/tap', { code:'GAME', playerId:id2, stepId:5 }); // expected 1
  log(bad.wrong === true, 'skipping ahead still correctly penalized');

  // --- Test 4: stale prune still works with hb: field ---
  await post('/api/reset', { code:'GAME' });
  const id3 = (await post('/api/join', { code:'GAME', name:'Ghost' })).playerId;
  await get('/api/state?code=GAME&playerId='+id3); // one heartbeat
  await sleep(5000); // > STALE_MS (4s), no more heartbeats
  await get('/api/state?code=GAME'); // a poll triggers prune
  st = await get('/api/state?code=GAME');
  log(!st.players.find(p => p.id === id3), 'stale player still pruned via hb: heartbeat ('+st.players.length+' left)');

  await post('/api/reset', { code:'GAME' });
  console.log('\n' + (fail===0 ? 'ALL LOCAL RACE/GUARD TESTS PASSED' : fail+' FAILED'));
  process.exit(fail===0?0:1);
})();
