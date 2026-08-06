const QRCode = require('qrcode');
const { hset, hgetall, roomKey } = require('../lib/store');
const { FIXED_ROOM, MAX_PLAYERS, RECIPE } = require('../lib/recipe');
const { send } = require('../lib/http');
const stats = require('../lib/stats');

/**
 * POST /api/create -> ensures THE fixed room exists, returns its code + join URL + QR.
 *
 * The game uses one permanent room (FIXED_ROOM) so the join URL — and therefore the
 * printable QR code — never changes. This endpoint is idempotent: if the room already
 * exists it is left untouched (never wiping an in-progress round); only a missing room
 * (first boot, or after the 2h TTL lapsed on an idle room) is (re)created in the lobby.
 */
module.exports = async (req, res) => {
  const code = FIXED_ROOM;
  const key = roomKey(code);
  const existing = await hgetall(key);
  if (!existing.meta) {
    await hset(key, 'meta', { code, phase: 'lobby', startedAt: null });
    await stats.bump({ roomsCreated: 1 });
  }

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const joinUrl = `${proto}://${host}/play?room=${code}`;
  let qr = null;
  try { qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 }); } catch { qr = null; }

  return send(res, 200, { code, joinUrl, qr, maxPlayers: MAX_PLAYERS, recipeLength: RECIPE.length });
};
