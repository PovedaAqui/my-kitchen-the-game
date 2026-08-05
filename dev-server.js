/**
 * Local dev harness ONLY. Mimics Vercel's routing so the serverless API
 * functions and static pages can be exercised locally without `vercel dev`.
 * Not used in production — on Vercel each file in /api is its own function
 * and /public is served statically. Uses the in-memory store fallback unless
 * Upstash env vars are set.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const routes = {
  '/api/create': require('./api/create'),
  '/api/join': require('./api/join'),
  '/api/start': require('./api/start'),
  '/api/tap': require('./api/tap'),
  '/api/state': require('./api/state'),
  '/api/reset': require('./api/reset')
};
const pages = { '/': 'host.html', '/host': 'host.html', '/play': 'play.html' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (routes[p]) return routes[p](req, res);

  let file = pages[p];
  if (!file && p.endsWith('.html')) file = p.slice(1);
  if (file) {
    const fp = path.join(__dirname, 'public', file);
    if (fs.existsSync(fp)) {
      res.setHeader('Content-Type', mime[path.extname(fp)] || 'text/plain');
      return res.end(fs.readFileSync(fp));
    }
  }
  res.statusCode = 404; res.end('Not found');
});

server.listen(PORT, () => console.log('Dev server (Vercel emulation) on http://localhost:' + PORT));
