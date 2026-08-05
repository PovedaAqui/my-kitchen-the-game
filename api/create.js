const QRCode = require('qrcode');
const { hset, hgetall, roomKey } = require('../lib/store');
const { makeRoomCode, MAX_PLAYERS, RECIPE } = require('../lib/recipe');
const { send } = require('../lib/http');

/** POST /api/create -> creates a fresh room, returns code + join URL + QR. */
module.exports = async (req, res) => {
  let code, exists;
  // Avoid collisions: retry a few times if the code already exists.
  for (let i = 0; i < 6; i++) {
    code = makeRoomCode();
    exists = (await hgetall(roomKey(code))).meta;
    if (!exists) break;
  }
  await hset(roomKey(code), 'meta', { code, phase: 'lobby', startedAt: null });

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const joinUrl = `${proto}://${host}/play?room=${code}`;
  let qr = null;
  try { qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 }); } catch { qr = null; }

  return send(res, 200, { code, joinUrl, qr, maxPlayers: MAX_PLAYERS, recipeLength: RECIPE.length });
};
