/**
 * Verify the atomic tapStep Lua path against REAL Upstash Redis, using a
 * throwaway key (room:__luatest__) so the live room:GAME is never touched.
 * Confirms the cjson round-trip matches how the Upstash client stores objects,
 * and that concurrent unserialized taps no longer produce false wrongs.
 */
const fs = require('fs');
// Load Upstash creds from .env.local
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim().replace(/^["']|["']$/g, ''); process.env[m[1]] = v; }
}

const store = require('./lib/store');
const { hset, hdel, hgetall, tapStep, del } = store;

const KEY = 'room:__luatest__';
const N = 10;

(async () => {
  console.log('usingRedis:', store.usingRedis());
  if (!store.usingRedis()) { console.log('NOT on Redis — aborting (creds missing)'); process.exit(1); }

  let fail = 0;
  const log = (ok, m) => { console.log((ok?'PASS':'FAIL')+' - '+m); if(!ok) fail++; };

  // Fresh throwaway room in playing phase with one player at step 0.
  await del(KEY);
  await hset(KEY, 'meta', { code:'__luatest__', phase:'playing', startedAt: Date.now() });
  await hset(KEY, 'p:tester', { id:'tester', name:'T', step:0, penalties:0, finished:false, finishMs:null, score:0, connected:true });

  // 1) cjson round-trip: a single correct tap advances step 0 -> 1.
  let r = await tapStep(KEY, 'p:tester', 0, N);
  log(r.outcome === 'advance' && r.player.step === 1, 'Lua correct tap advances (outcome='+r.outcome+', step='+(r.player&&r.player.step)+')');

  // 2) wrong (skip ahead) increments penalty, step unchanged.
  r = await tapStep(KEY, 'p:tester', 7, N);
  log(r.outcome === 'wrong' && r.player.step === 1 && r.player.penalties === 1, 'Lua skip-ahead penalized (outcome='+r.outcome+', pen='+(r.player&&r.player.penalties)+')');

  // 3) duplicate (already-passed step) is a no-op, no penalty.
  r = await tapStep(KEY, 'p:tester', 0, N);
  log(r.outcome === 'duplicate' && r.player.step === 1 && r.player.penalties === 1, 'Lua duplicate is no-op (outcome='+r.outcome+')');

  // 4) verify the stored object is intact & readable via normal hgetall (shape preserved).
  const after = await hgetall(KEY);
  const p = after['p:tester'];
  log(p && p.step === 1 && p.name === 'T' && p.connected === true, 'stored player object intact after Lua writes (step='+(p&&p.step)+', name='+(p&&p.name)+')');

  // 5) THE RACE: reset and fire all remaining correct taps CONCURRENTLY (unserialized).
  await hset(KEY, 'p:tester', { id:'tester', name:'T', step:0, penalties:0, finished:false, finishMs:null, score:0, connected:true });
  const ps = [];
  for (let s = 0; s < N; s++) ps.push(tapStep(KEY, 'p:tester', s, N)); // no await between = all in flight
  const results = await Promise.all(ps);
  const wrongs = results.filter(x => x.outcome === 'wrong').length;
  const fin = await hgetall(KEY);
  const fp = fin['p:tester'];
  // With atomicity, every correct step is applied exactly once regardless of order;
  // no correct tap becomes a penalty. Final step should reach N (finished).
  log(wrongs === 0, 'CONCURRENT unserialized correct taps -> ZERO false wrongs (was 4-7 before atomic fix) [got '+wrongs+']');
  log(fp && (fp.finished === true || fp.step === N), 'player reached finish under concurrency (step='+(fp&&fp.step)+', finished='+(fp&&fp.finished)+')');

  // Cleanup throwaway key.
  await del(KEY);
  console.log('\n' + (fail===0 ? 'ATOMIC tapStep VERIFIED ON REAL REDIS ✅' : fail+' FAILED ❌'));
  process.exit(fail===0?0:1);
})();
