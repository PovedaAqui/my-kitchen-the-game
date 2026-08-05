/**
 * My Kitchen: The Game — Gallo Pinto Cook-Off
 * Real-time multiplayer party game. Host shows a QR code on a big screen;
 * up to 10 players join from their phones and race to cook Nicaragua's
 * national dish, gallo pinto, by performing the recipe steps in the
 * correct order as fast as they can.
 */

const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;

app.use(express.static(path.join(__dirname, 'public')));

/**
 * The authentic Nicaraguan gallo pinto recipe, as an ordered list of steps.
 * Nicaraguan gallo pinto uses small red beans ("frijoles rojos de seda"),
 * day-old white rice, and the local sweet pepper called "chiltoma".
 * Players must tap these in this exact order to cook correctly.
 */
const RECIPE = [
  { id: 0, emoji: '\uD83E\uDED2', label: 'Heat oil in the pan', note: 'A splash of oil over medium heat.' },
  { id: 1, emoji: '\uD83E\uDDC5', label: 'Saute the diced onion', note: 'Until soft and fragrant.' },
  { id: 2, emoji: '\uD83E\uDED1', label: 'Add the chopped chiltoma', note: 'Nicaraguan sweet bell pepper.' },
  { id: 3, emoji: '\uD83E\uDDC4', label: 'Stir in the minced garlic', note: 'Just until aromatic.' },
  { id: 4, emoji: '\uD83E\uDED8', label: 'Add the cooked red beans', note: 'Frijoles rojos de seda.' },
  { id: 5, emoji: '\uD83C\uDF5A', label: 'Fold in the day-old rice', note: 'Cold white rice fries best.' },
  { id: 6, emoji: '\uD83E\uDD63', label: 'Splash in the bean broth', note: 'Gives the pinto its color.' },
  { id: 7, emoji: '\uD83E\uDDC2', label: 'Season with salt', note: 'To taste.' },
  { id: 8, emoji: '\uD83D\uDD25', label: 'Fry until slightly crispy', note: 'Stir so it catches a little.' },
  { id: 9, emoji: '\uD83C\uDF7D\uFE0F', label: 'Plate and serve', note: 'Gallo pinto is ready!' }
];

/** In-memory game rooms keyed by 4-char code. Single-process, resets on restart. */
const rooms = {};

function makeRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function publicRoomState(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: Object.values(room.players)
      .map((p) => ({
        id: p.id,
        name: p.name,
        step: p.step,
        total: RECIPE.length,
        finished: p.finished,
        finishMs: p.finishMs,
        score: p.score,
        connected: p.connected
      }))
      .sort((a, b) => {
        // Finished players first (by time), then by progress.
        if (a.finished && b.finished) return a.finishMs - b.finishMs;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.step - a.step;
      })
  };
}

function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  io.to('host:' + code).emit('room:update', publicRoomState(room));
}

function computeScore(finishMs, penalties) {
  // Base 1000, minus 1 point per 100ms elapsed, minus 150 per wrong tap. Floor 100.
  const timePenalty = Math.floor(finishMs / 100);
  const score = 1000 - timePenalty - penalties * 150;
  return Math.max(100, score);
}

io.on('connection', (socket) => {
  // ---- HOST ----
  socket.on('host:create', async (_data, ack) => {
    const code = makeRoomCode();
    rooms[code] = {
      code,
      phase: 'lobby', // lobby -> playing -> finished
      players: {},
      hostSocket: socket.id,
      startedAt: null
    };
    socket.join('host:' + code);
    socket.data.role = 'host';
    socket.data.room = code;

    const ip = getLanIp();
    const joinUrl = `http://${ip}:${PORT}/play?room=${code}`;
    let qr = null;
    try {
      qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 });
    } catch (e) {
      qr = null;
    }
    if (ack) ack({ code, joinUrl, qr, maxPlayers: MAX_PLAYERS, recipeLength: RECIPE.length });
    broadcastRoom(code);
  });

  socket.on('host:start', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || room.phase !== 'lobby') return;
    if (Object.keys(room.players).length === 0) return;
    room.phase = 'playing';
    room.startedAt = Date.now();
    for (const p of Object.values(room.players)) {
      p.step = 0;
      p.penalties = 0;
      p.finished = false;
      p.finishMs = null;
      p.score = 0;
    }
    io.to('players:' + code).emit('game:start', { recipe: RECIPE, startedAt: room.startedAt });
    io.to('host:' + code).emit('game:start', { startedAt: room.startedAt });
    broadcastRoom(code);
  });

  socket.on('host:reset', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    room.phase = 'lobby';
    room.startedAt = null;
    for (const p of Object.values(room.players)) {
      p.step = 0;
      p.penalties = 0;
      p.finished = false;
      p.finishMs = null;
      p.score = 0;
    }
    io.to('players:' + code).emit('game:reset');
    broadcastRoom(code);
  });

  // ---- PLAYER ----
  socket.on('player:join', ({ code, name }, ack) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return ack && ack({ ok: false, error: 'Room not found.' });
    if (room.phase !== 'lobby') return ack && ack({ ok: false, error: 'Game already started.' });
    if (Object.keys(room.players).length >= MAX_PLAYERS) {
      return ack && ack({ ok: false, error: 'Kitchen is full (10 cooks max).' });
    }
    const cleanName = (name || '').toString().trim().slice(0, 16) || 'Cook';
    room.players[socket.id] = {
      id: socket.id,
      name: cleanName,
      step: 0,
      penalties: 0,
      finished: false,
      finishMs: null,
      score: 0,
      connected: true
    };
    socket.join('players:' + code);
    socket.data.role = 'player';
    socket.data.room = code;
    if (ack) ack({ ok: true, code, name: cleanName, recipeLength: RECIPE.length });
    broadcastRoom(code);
  });

  socket.on('player:tap', ({ stepId }) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    const p = room.players[socket.id];
    if (!p || p.finished) return;

    if (stepId === p.step) {
      // Correct next step.
      p.step += 1;
      if (p.step >= RECIPE.length) {
        p.finished = true;
        p.finishMs = Date.now() - room.startedAt;
        p.score = computeScore(p.finishMs, p.penalties);
        socket.emit('player:finished', { finishMs: p.finishMs, score: p.score, penalties: p.penalties });

        // If everyone still connected has finished, end the game.
        const active = Object.values(room.players).filter((x) => x.connected);
        if (active.length > 0 && active.every((x) => x.finished)) {
          room.phase = 'finished';
          io.to('players:' + code).emit('game:over', publicRoomState(room));
          io.to('host:' + code).emit('game:over', publicRoomState(room));
        }
      } else {
        socket.emit('player:progress', { step: p.step });
      }
    } else {
      // Wrong tap: penalty.
      p.penalties += 1;
      socket.emit('player:wrong', { step: p.step, penalties: p.penalties });
    }
    broadcastRoom(code);
  });

  socket.on('disconnect', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    if (socket.data.role === 'host' && room.hostSocket === socket.id) {
      // Host left: tear the room down after a short grace period.
      io.to('players:' + code).emit('host:left');
      delete rooms[code];
      return;
    }
    if (socket.data.role === 'player' && room.players[socket.id]) {
      room.players[socket.id].connected = false;
      // Remove disconnected players from the lobby so slots free up.
      if (room.phase === 'lobby') delete room.players[socket.id];
      broadcastRoom(code);
    }
  });
});

app.get('/', (_req, res) => res.redirect('/host'));
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLanIp();
  console.log(`\nGallo Pinto Cook-Off running:`);
  console.log(`  Host screen : http://localhost:${PORT}/host`);
  console.log(`  On your LAN : http://${ip}:${PORT}/host`);
  console.log(`  Players scan the QR shown on the host screen.\n`);
});
