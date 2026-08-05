const { snapshot } = require('../lib/stats');
const { send } = require('../lib/http');

/**
 * GET /api/stats?token=XXX  (or Authorization: Bearer XXX)
 * Returns aggregate usage totals. Protected by STATS_TOKEN env var.
 * If STATS_TOKEN is unset, the endpoint refuses (fail closed) rather than
 * leaking data — set the env var to enable it.
 */
module.exports = async (req, res) => {
  const expected = process.env.STATS_TOKEN;
  if (!expected) {
    return send(res, 503, { ok: false, error: 'Stats disabled: STATS_TOKEN not configured on the server.' });
  }
  const url = new URL(req.url, 'http://localhost');
  const qToken = url.searchParams.get('token');
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const provided = qToken || bearer;
  if (provided !== expected) {
    return send(res, 401, { ok: false, error: 'Unauthorized.' });
  }
  const data = await snapshot();
  return send(res, 200, { ok: true, ...data });
};
