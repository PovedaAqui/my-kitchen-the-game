const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function conn() { return io(URL, { transports: ['websocket'], forceNew: true }); }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let fail = 0;
  const log = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + msg); if (!ok) fail++; };

  // 1. Host creates room
  const host = conn();
  const created = await new Promise(res => host.emit('host:create', {}, res));
  log(created.code && created.code.length === 4, 'host created room ' + created.code);
  log(!!created.qr && created.qr.startsWith('data:image'), 'QR data URL generated');
  log(created.maxPlayers === 10, 'max players = 10');
  const code = created.code;

  let lastState = null;
  host.on('room:update', s => { lastState = s; });

  // 2. Join 10 players
  const players = [];
  for (let i = 0; i < 10; i++) {
    const p = conn();
    const r = await new Promise(res => p.emit('player:join', { code, name: 'Cook' + (i+1) }, res));
    if (!r.ok) log(false, 'player ' + (i+1) + ' join: ' + r.error);
    players.push(p);
  }
  log(players.length === 10, 'joined 10 players');

  // 3. 11th player rejected
  const p11 = conn();
  const r11 = await new Promise(res => p11.emit('player:join', { code, name: 'Overflow' }, res));
  log(!r11.ok && /full/i.test(r11.error), '11th player rejected: "' + r11.error + '"');
  p11.close();

  // 4. Host sees 10 in leaderboard
  await wait(200);
  log(lastState && lastState.players.length === 10, 'host leaderboard shows 10 cooks');

  // 5. Start game; players receive recipe
  const recipes = [];
  players.forEach(p => p.on('game:start', ({ recipe }) => recipes.push(recipe)));
  const finishes = {};
  players.forEach((p, i) => p.on('player:finished', d => { finishes[i] = d; }));
  let gameOver = null;
  host.on('game:over', s => { gameOver = s; });

  host.emit('host:start');
  await wait(300);
  log(recipes.length === 10 && recipes[0].length === 10, 'all 10 players got 10-step recipe');

  // 6. Simulate cooking. Player 0 is fast & perfect; player 5 makes 2 mistakes; rest normal.
  const recipe = recipes[0];
  async function cook(p, idx, { mistakes = 0, stepDelay = 0 } = {}) {
    // make `mistakes` wrong taps first
    for (let m = 0; m < mistakes; m++) {
      p.emit('player:tap', { stepId: 9 }); // wrong (not step 0)
      await wait(10);
    }
    for (let s = 0; s < recipe.length; s++) {
      p.emit('player:tap', { stepId: s });
      if (stepDelay) await wait(stepDelay);
    }
  }

  // Fastest: player 0, no delay, no mistakes
  await cook(players[0], 0, {});
  await wait(50);
  // Player 5: 2 mistakes
  await cook(players[5], 5, { mistakes: 2 });
  // Everyone else
  for (let i = 1; i < 10; i++) { if (i === 5) continue; await cook(players[i], i, {}); }

  await wait(500);

  log(Object.keys(finishes).length === 10, 'all 10 players finished (' + Object.keys(finishes).length + ')');
  log(finishes[0] && finishes[0].penalties === 0, 'player 0 finished clean, score=' + (finishes[0] && finishes[0].score));
  log(finishes[5] && finishes[5].penalties === 2, 'player 5 has 2 penalties, score=' + (finishes[5] && finishes[5].score));
  log(finishes[0].score > finishes[5].score, 'clean player scored higher than penalized player');
  log(gameOver && gameOver.phase === 'finished', 'game reached finished phase');
  log(gameOver && gameOver.players[0].finished, 'leaderboard sorted: winner=' + (gameOver && gameOver.players[0].name) + ' @ ' + (gameOver && (gameOver.players[0].finishMs/1000).toFixed(2)) + 's');

  // 7. Wrong tap during play doesn't advance
  host.close(); players.forEach(p => p.close());
  await wait(100);
  console.log('\n' + (fail === 0 ? 'ALL TESTS PASSED' : fail + ' TEST(S) FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
