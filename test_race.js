/**
 * Reproduce the suspected race: a player taps the correct ingredients FAST,
 * firing the next tap before the previous one's server round-trip commits.
 * On serverless, concurrent lambdas read-modify-write the same Redis hash,
 * so a later-but-correct tap can be judged against a stale `step`.
 */
const B = 'https://my-kitchen-the-game.vercel.app';
const post = (p, b) => fetch(B + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b||{}) }).then(r => r.json());
const get = (p) => fetch(B + p).then(r => r.json());

(async () => {
  console.log('--- Scenario A: fully SEQUENTIAL correct taps (await each) ---');
  await runRound(false);
  console.log('\n--- Scenario B: RAPID correct taps (fire next without awaiting) ---');
  await runRound(true);
  await post('/api/reset', { code: 'GAME' });
})();

async function runRound(rapid) {
  await post('/api/reset', { code: 'GAME' });
  const id = (await post('/api/join', { code:'GAME', name: rapid?'Rapid':'Slow' })).playerId;
  await post('/api/start', { code: 'GAME' });

  // Correct order is always ids 0..9 (fixed play order).
  let wrongs = 0;
  if (!rapid) {
    for (let s = 0; s < 10; s++) {
      const r = await post('/api/tap', { code:'GAME', playerId:id, stepId:s });
      if (r.wrong) { wrongs++; console.log(`  tap ${s}: WRONG (penalties=${r.penalties})`); }
    }
  } else {
    // Fire taps back-to-back with only a tiny gap, NOT awaiting the response —
    // exactly what a fast thumb does on a phone.
    const promises = [];
    for (let s = 0; s < 10; s++) {
      promises.push(post('/api/tap', { code:'GAME', playerId:id, stepId:s }).then(r => ({ s, r })));
      await new Promise(res => setTimeout(res, 40)); // ~40ms between taps = fast but human
    }
    const results = await Promise.all(promises);
    for (const { s, r } of results) {
      if (r.wrong) { wrongs++; console.log(`  tap ${s}: WRONG (penalties=${r.penalties})`); }
    }
  }
  const st = await get('/api/state?code=GAME&playerId=' + id);
  const me = st.players.find(p => p.id === id);
  console.log(`  => wrongs=${wrongs}, final step=${me?me.step:'?'}, penalties=${me?me.penalties:'?'}, finished=${me?me.finished:'?'}`);
  console.log(`  ${wrongs===0 ? 'no false wrongs' : 'FALSE WRONGS REPRODUCED ❌ — correct taps rejected'}`);
}
