# 🇳🇮 My Kitchen: The Game — Gallo Pinto Cook-Off

A real-time multiplayer party game, **built to run on Vercel**. The host shows a **QR code** on a big screen; up to **10 players** scan it with their phones and race to cook Nicaragua's national dish, **gallo pinto**, by tapping the recipe steps in the correct order as fast as they can.

Fastest cook with the fewest mistakes wins. 🥇

## Architecture (Vercel-native)

This is **not** a long-lived socket server — it's designed for Vercel's serverless model:

- **`/api/*`** — stateless serverless functions (`create`, `join`, `start`, `tap`, `state`, `reset`).
- **Upstash Redis** — shared game state, so every function invocation and every player sees the same room. Each room is one Redis hash (`room:<CODE>`); each player is a separate hash field, so concurrent taps never clobber each other. Rooms auto-expire after 2h.
- **`/public/*`** — static host + player pages that talk to the API and **poll `/api/state`** (~700ms) for the live lobby, leaderboard, and cooking progress. No WebSockets required.

## Deploy to Vercel

1. **Connect the repo** in the Vercel dashboard (Add New → Project → import this repo). No build step — it's static + serverless functions.
2. **Add Upstash Redis** (required for shared state):
   - Vercel dashboard → your project → **Storage** → **Marketplace** → **Upstash** → **Redis** → create a database and connect it to the project.
   - This injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (the code also accepts `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
3. **Redeploy** so the functions pick up the env vars.

That's it — open `https://<your-project>.vercel.app/host` and have players scan the QR.

> Without Upstash credentials the app falls back to an in-memory store. That's fine for local dev, but on Vercel each serverless instance has its own memory, so **Upstash is required in production** for players to share a room.

## How to play

1. **Host** opens `/host` → gets a room code + QR.
2. Players **scan the QR** (or open `/play` and type the 4-letter code).
3. Up to **10 cooks** join with a name.
4. Host presses **Start Cooking!**
5. Everyone taps the **10 steps in the correct order** — the "Next step" card guides them. Wrong taps cost a **150-pt penalty**.
6. First to plate the gallo pinto wins. 🏆

## Scoring

`score = 1000 − (finishMs ÷ 100) − (wrongTaps × 150)`, floored at 100. Fast + accurate = high score.

## The dish

Nicaraguan gallo pinto: **day-old white rice** and **small red beans** (*frijoles rojos de seda*), sautéed with **onion**, **chiltoma** (Nicaraguan sweet pepper), and **garlic**, splashed with **bean broth** for color, fried until slightly crispy. The 10 in-game steps follow that authentic method.

## Local development

```bash
npm install
npm run dev      # emulates Vercel routing on http://localhost:3000
npm test         # end-to-end API test (16 checks), in-memory store
```

`npm run dev` uses `dev-server.js`, a small harness that maps the same `/api/*` and page routes Vercel serves. It uses the in-memory store unless you export `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.

## Project layout

```
api/            # serverless functions: create, join, start, tap, state, reset
lib/
  store.js      # Upstash Redis (prod) or in-memory Map (local) — same interface
  recipe.js     # gallo pinto steps, scoring, leaderboard shaping
  http.js       # body parsing + JSON responses
public/
  host.html     # big-screen host: QR, lobby, live leaderboard (polls /api/state)
  play.html     # phone client: join + cooking gameplay
vercel.json     # route rewrites (/host, /play)
dev-server.js   # LOCAL ONLY: Vercel routing emulator
test_flow.js    # end-to-end API test
```

## License

MIT
