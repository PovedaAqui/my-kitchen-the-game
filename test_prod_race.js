const B = process.env.BASE || 'https://my-kitchen-the-game.vercel.app';
const post = (p, b) => fetch(B + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b||{}) }).then(r => r.json());
const get = (p) => fetch(B + p).then(r => r.json());

(async () => {
  // 1) Server idempotent guard on production
  await post('/api/reset', { code:'GAME' });
  const id = (await post('/api/join', { code:'GAME', name:'DupProd' })).playerId;
  await post('/api/start', { code:'GAME' });
  await post('/api/tap', { code:'GAME', playerId:id, stepId:0 });
  const dup = await post('/api/tap', { code:'GAME', playerId:id, stepId:0 });
  console.log('1) duplicate tap ->', JSON.stringify(dup));

  // 2) OLD bug repro: raw concurrent taps (no serialization). With the server
  //    idempotent guard, even unserialized duplicates/races should NOT penalize.
  await post('/api/reset', { code:'GAME' });
  const id2 = (await post('/api/join', { code:'GAME', name:'RaceProd' })).playerId;
  await post('/api/start', { code:'GAME' });
  const ps = [];
  for (let s = 0; s < 10; s++) { ps.push(post('/api/tap', { code:'GAME', playerId:id2, stepId:s })); await new Promise(r => setTimeout(r, 35)); }
  const rs = await Promise.all(ps);
  const wrongs = rs.filter(r => r.wrong).length;
  let st = await get('/api/state?code=GAME&playerId=' + id2);
  let me = st.players.find(p => p.id === id2);
  console.log('2) rapid UNserialized taps -> false wrongs:', wrongs, '| final step:', me.step, '| finished:', me.finished);

  // 3) NEW client behavior: serialized tap chain, rapid clicks
  await post('/api/reset', { code:'GAME' });
  const id3 = (await post('/api/join', { code:'GAME', name:'SerProd' })).playerId;
  await post('/api/start', { code:'GAME' });
  let fin = false, w = 0, chain = Promise.resolve();
  const send = async s => { if (fin) return; const r = await post('/api/tap', { code:'GAME', playerId:id3, stepId:s }); if (r.wrong) w++; else if (r.finished) fin = true; };
  const tap = s => { chain = chain.then(() => send(s)).catch(() => {}); };
  for (let s = 0; s < 10; s++) { tap(s); await new Promise(r => setTimeout(r, 35)); }
  await chain;
  let st3 = await get('/api/state?code=GAME&playerId=' + id3);
  let me3 = st3.players.find(p => p.id === id3);
  console.log('3) rapid SERIALIZED taps -> false wrongs:', w, '| final step:', me3.step, '| finished:', me3.finished);

  await post('/api/reset', { code:'GAME' });
  console.log('');
  console.log((dup.duplicate === true && wrongs === 0 && w === 0 && me3.finished)
    ? 'PRODUCTION FIX VERIFIED ✅'
    : 'PROBLEM REMAINS ❌');
})();
