# 🇳🇮 My Kitchen: The Game — Gallo Pinto Cook-Off

A real-time multiplayer party game. The host shows a **QR code** on a big screen; up to **10 players** scan it with their phones and race to cook Nicaragua's national dish, **gallo pinto**, by tapping the recipe steps in the correct order as fast as they can.

Fastest cook with the fewest mistakes wins. 🥇

## The dish

Nicaraguan gallo pinto is made from **day-old white rice** and **small red beans** (*frijoles rojos de seda*), sautéed with **onion**, **chiltoma** (Nicaraguan sweet pepper), and **garlic**, then splashed with **bean broth** for its signature color and fried until slightly crispy. The 10 in-game steps follow that authentic method.

## How to play

1. **Host** opens `http://localhost:3000/host` on the shared/big screen.
2. Players **scan the QR code** (or open the join URL and type the 4-letter room code).
3. Up to **10 cooks** join the lobby with a name.
4. Host presses **Start Cooking!**
5. Every player gets the same recipe. Tap the **10 steps in the correct order** — the "Next step" card tells you what's next.
6. Wrong taps cost a **150-point penalty**. Finish fastest for the highest score.
7. First to plate the gallo pinto wins. 🏆

## Scoring

`score = 1000 − (finishMs ÷ 100) − (wrongTaps × 150)`, floored at 100. Fast + accurate = high score.

## Run it

```bash
npm install
npm start
```

Then open the **host** URL printed in the console. Players must be on the **same Wi-Fi/LAN** — the QR encodes your machine's LAN IP so phones can reach the server.

- Host screen: `/host`
- Player screen: `/play?room=CODE` (the QR points here)

### Play over the internet

To let players join from anywhere, expose port 3000 with a tunnel and share that URL:

```bash
npx localtunnel --port 3000     # or ngrok http 3000
```

Set `PORT` to change the port: `PORT=8080 npm start`.

## Tech

- **Node.js + Express** — static hosting & routes
- **Socket.IO** — real-time lobby, gameplay, and live leaderboard
- **qrcode** — generates the join QR on the host screen
- Pure HTML/CSS/JS front end, no build step

## Project layout

```
server.js          # game server: rooms, recipe, scoring, sockets
public/host.html   # big-screen host: QR, lobby, live leaderboard
public/play.html   # phone client: join + cooking gameplay
package.json
```

State is in-memory and single-process — a server restart clears all rooms. Perfect for a party; not meant for persistence.

## License

MIT
