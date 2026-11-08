# Games that keep being built

Game Maker → **Keep building a game**, or ask Jarvis (`continuous.start` with
`kind: "game"`). Describe the game; it builds it for hours or days, and every
finished milestone becomes a version you can play.

## What happens

1. **A production plan.** Your prompt becomes the goal the roadmap is written
   from: an original design (`GAME_DESIGN.md`: its own name, world and
   characters), the core loop playable first, then content, art, animation,
   sound, menus and saving, online multiplayer when you asked for it, polish,
   then upgrades for as long as it runs.
2. **A real engine.** A new game starts on Phaser 3, or three.js when it is 3D
   (`templates/game-engines`): scenes or a lit world, input, a game loop, sound made
   in code, saving, and rules in tested modules, with `ASSETS.md` and, for multiplayer,
   the multiplayer kit. Its pictures are listed in `art.json` and drawn on this PC by
   the image engine (ArtStudio), so they belong to the game.
   `npm run check:game-engines` installs, builds and runs both in a real browser.
3. **Every step is held to a game's bar:** real art for everything, animation
   for every state, particles and screen shake, Web Audio sound and music,
   game rules in tested modules, playable at the end of each step.
4. **The checks include the asset rules.** A step fails, and is fixed like any
   failing check, when the game:
   - loads a picture, sound, model or font from the internet;
   - ships a file that is not in `ASSETS.md` with its source (pictures the
     image engine drew are known and need no row);
   - lists a source that is not free: only generated, procedural, original,
     CC0, public domain, and OFL fonts — never CC-BY, "royalty free", bought or
     ripped;
   - uses names or characters from someone else's game or film.
5. **A version at every milestone.** When a milestone is done (and after each
   kept upgrade) the game is built and kept as the next version in
   `data/game-demos/<session>/v<N>/`. The newest 25 keep their files. Each has
   a play link; one that does not build says why and takes no number.
6. **Follow-ups.** Send notes from the game's card at any time: the step in
   progress stops and the roadmap is revised around what you said.

## Where to play it

- **In the app:** **▶ Play here** on the game's card, full window, any version.
- **In a tab:** **Open in a tab**; the link works for anyone you send it to.
- **Download:** a zip of that version. `Play.bat` (Windows) or `play.sh` starts a small
  server on that computer and opens the game.
- **Windows app:** **Make a Windows app** builds that version into a folder with an `.exe`
  (Electron, about 105 MB zipped, a few minutes the first time). It is not an installer and
  is not code-signed, so Windows may warn before running it.
- **SaveState:** the newest version goes to `games/made-<name>/`, where SaveState's Mini
  Games lists Agent Builder's finished games (Mini Games → the Agent Builder list → add).

These are web games on real engines, also packaged for Windows. Native engines (Godot,
Unity export) are not part of this flow; Unity levels have their own panel.

Approvals work as for every project: the game's own folder only changes when
you approve a delivery (Agent → Continuous). The versions are playable before
that.

## Multiplayer

`src/lib/net` gives a game rooms with join codes, one shared game state run by
a host (pure rules: `init`, `apply`, `tick`, `join`, `leave`), snapshots to
everyone else, host hand-over when the host leaves (the game carries on as it
was), seats kept for 30 s so a dropped player comes back, a lobby list, and
latency. Without a server, tabs of one browser play together.

- **The game's own server:** `server/` in the game (`npm install && npm start`,
  port 8787). Point the game at it with `VITE_NET_URL`.
- **Through Agent Builder:** the builder hosts the same rooms at `/net` on its
  own address, and a version opened from its play link uses them. A link
  shared through the tunnel is an online game with nothing else to run.
  `NET_RELAY=off` turns that off.

Limits: 16 players a room (`MAX_PLAYERS`), 500 rooms (`MAX_ROOMS`), 64 KB a
message, 120 messages a second a player.

Any build whose prompt asks for multiplayer gets the kit, not only
continuous games. Tests: `npm run test:game-director`, `npm run test:net-kit`.

## The studio process (8 November)

A game is made in the phases a studio uses: pre-production (concept and pillars in GAME_DESIGN.md, an art bible in
ART_BIBLE.md), production (a vertical slice at final quality first, then content, animation and feel, sound, menus and
saving, multiplayer when asked for), then alpha (every feature, a CHANGELOG entry per version), beta (content complete,
balance, teaching, accessibility, phone performance) and a release candidate (no known bugs, credits, store text), then
live updates.

**QA before a version counts:** each one is opened in a real browser; it must load with no script errors and draw. Its
screenshot shows on the game's card with a QA badge, and only versions that pass go to SaveState's shelf.

**Every game plays from its card** in Game Studio (the older games/ ones too): Play opens it full window in the app.

Two are running: **Lanternfall** (a 2D action-platformer on Phaser) and **Driftworks** (a 3D hover-racer on three.js
with online races).
