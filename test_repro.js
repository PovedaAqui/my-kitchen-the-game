/**
 * Reproduce the "I picked the right ingredient but it says wrong" report.
 * Faithfully mirrors the client:
 *   - "Next step" prompt shown to the user = recipe[myStep]  (renderNext)
 *   - grid tiles carry data-id = recipe.id, laid out per `layout` (renderGrid)
 * The obedient user ALWAYS taps the tile whose label matches the Next-step prompt.
 * We send that tile's data-id to /api/tap and check whether the server calls it wrong.
 */
const B = 'https://my-kitchen-the-game.vercel.app';
const post = (p, b) => fetch(B + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b||{}) }).then(r => r.json());
const get = (p) => fetch(B + p).then(r => r.json());

(async () => {
  await post('/api/reset', { code: 'GAME' });
  const j = await post('/api/join', { code: 'GAME', name: 'Repro' });
  const id = j.playerId;
  await post('/api/start', { code: 'GAME' });
  const st = await get('/api/state?code=GAME&playerId=' + id);
  const recipe = st.recipe;                 // [{id,emoji,label,note}...]
  const layout = st.layout;                 // shuffled recipe-ids for tile positions
  console.log('layout (tile positions -> recipe id):', JSON.stringify(layout));
  console.log('');

  let myStep = 0, wrongs = 0;
  for (let n = 0; n < recipe.length; n++) {
    // What the UI tells the user to do next:
    const prompt = recipe[myStep];                    // renderNext(): recipe[myStep]
    // The user finds the tile whose LABEL matches the prompt and taps it.
    const tileRid = layout.find(rid => recipe[rid].label === prompt.label);
    // tap() sends that tile's data-id (which is recipe[rid].id === rid)
    const r = await post('/api/tap', { code:'GAME', playerId:id, stepId: tileRid });
    const verdict = r.wrong ? 'WRONG ❌' : (r.finished ? 'done ✅' : 'ok ✅');
    console.log(`step ${myStep}: prompt="${prompt.label}" (id ${prompt.id}) -> tapped tile id ${tileRid} -> ${verdict}`);
    if (r.wrong) { wrongs++; myStep = r.step; }
    else if (r.finished) { myStep = recipe.length; }
    else myStep = r.step;
  }

  console.log('');
  console.log(wrongs === 0
    ? 'RESULT: obedient player got ZERO wrongs — label/id mapping is correct. Bug is UX (strict order), not a mapping defect.'
    : `RESULT: ${wrongs} WRONG(s) while following the prompt exactly — REAL BUG in tile/label/id mapping.`);
  await post('/api/reset', { code: 'GAME' });
})();
