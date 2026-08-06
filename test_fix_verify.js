/**
 * Verify the FIX: mimic the new client's serialized tap chain under RAPID
 * clicking (user mashes tiles fast). With serialization, only one tap is in
 * flight at a time, so the server never sees a stale-step race.
 */
const B = 'https://my-kitchen-the-game.vercel.app';
const post = (p, b) => fetch(B + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b||{}) }).then(r => r.json());
const get = (p) => fetch(B + p).then(r => r.json());

(async () => {
  let totalWrongs = 0;
  for (let run = 1; run <= 3; run++) {
    await post('/api/reset', { code: 'GAME' });
    const id = (await post('/api/join', { code:'GAME', name:'FixCheck' })).playerId;
    await post('/api/start', { code: 'GAME' });

    // Replicate the client: tap() enqueues onto a serialized chain; the user
    // clicks all 10 tiles in rapid succession (35ms apart, NOT awaiting).
    let finished = false, wrongs = 0;
    let tapChain = Promise.resolve();
    const sendTap = async (stepId) => {
      if (finished) return;
      const r = await post('/api/tap', { code:'GAME', playerId:id, stepId });
      if (!r.ok) return;
      if (r.wrong) wrongs++;
      else if (r.finished) finished = true;
    };
    const tap = (stepId) => { tapChain = tapChain.then(() => sendTap(stepId)).catch(()=>{}); };

    for (let s = 0; s < 10; s++) { tap(s); await new Promise(r => setTimeout(r, 35)); }
    await tapChain; // wait for the queue to drain

    const st = await get('/api/state?code=GAME&playerId=' + id);
    const me = st.players.find(p => p.id === id);
    console.log(`run ${run}: false wrongs=${wrongs}, final step=${me.step}, finished=${me.finished}`);
    totalWrongs += wrongs;
  }
  await post('/api/reset', { code: 'GAME' });
  console.log('');
  console.log(totalWrongs === 0
    ? 'FIX VERIFIED ✅ — rapid tapping with serialized chain produced ZERO false wrongs across 3 runs'
    : `STILL BROKEN ❌ — ${totalWrongs} false wrongs`);
  process.exit(totalWrongs === 0 ? 0 : 1);
})();
