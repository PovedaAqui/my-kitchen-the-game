const { hgetall, roomKey } = require('../lib/store');
const { publicRoomState } = require('../lib/recipe');
const { send } = require('../lib/http');

/** GET /api/state?code=XXXX -> current room snapshot (polled by host + players). */
module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const code = (url.searchParams.get('code') || '').toUpperCase().trim();
  const fields = await hgetall(roomKey(code));
  if (!fields.meta) return send(res, 404, { ok: false, error: 'Room not found.' });
  return send(res, 200, { ok: true, ...publicRoomState(fields) });
};
