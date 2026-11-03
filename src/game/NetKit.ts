/**
 * NetKit — multiplayer for the games Agent Builder makes.
 *
 * Copies templates/net-kit into a build: src/lib/net (rooms, players, one
 * shared state run by a host, migration, reconnection, lobby, a local mode
 * across tabs) and server/ (the generic room server, `npm start`), with
 * MULTIPLAYER.md. The build's model is told how to use it, so a multiplayer
 * game is written around one set of rules instead of ad-hoc sockets.
 *
 * Tested end to end by scripts/net-kit-smoketest.ts.
 */
import fs from "fs";
import path from "path";

const KIT_DIR = () => path.resolve(process.env.NET_KIT_DIR ?? "templates/net-kit");

const copyDir = (from: string, to: string) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
};

const GUIDE = `# Multiplayer

This game plays online through \`src/lib/net\`: rooms with join codes, one shared game state, and a host
that runs the rules (when the host leaves, the next player carries on with the game as it was).

## Playing together

- **In one browser** (testing): open the game in two tabs and join the same room code. No server needed.
- **Over the internet**: run the room server and point the game at it.

\`\`\`
cd server && npm install && npm start        # ws://localhost:8787
\`\`\`

Then build the game with \`VITE_NET_URL=wss://your-server\` (or ws://localhost:8787 on one PC). Behind
Cloudflare Tunnel or any TLS proxy, use wss://. \`GET /rooms\` on the server lists open rooms for the lobby.

## In code

\`\`\`ts
import { connect, joinCode } from "./lib/net";
const room = connect(rules, { room: code ?? joinCode(), name });
room.subscribe(() => draw(room.state, room.players));
room.send({ type: "move", dx: 1 });
\`\`\`

\`rules\` is \`{ init(players), apply(state, action, playerId), tick?(state, dtMs), join?, leave? }\`, pure functions:
the host runs them; everyone else sees the host's snapshots.
`;

export const NetKit = {
  /** The prompt asks for players playing together. */
  wanted(text: string): boolean {
    return /\b(multi-?player|online (play|game|match)|co-?op|cooperative|pvp|player vs\.? player|versus|lobby|matchmaking|play with friends|massively|mmo)\b/i.test(text);
  },

  installed(workspace: string): boolean {
    return fs.existsSync(path.join(workspace, "src", "lib", "net", "index.ts"));
  },

  install(workspace: string): void {
    const kit = KIT_DIR();
    if (!fs.existsSync(path.join(kit, "src", "lib", "net", "index.ts"))) throw new Error(`The multiplayer kit is missing (${kit}).`);
    copyDir(path.join(kit, "src"), path.join(workspace, "src"));
    copyDir(path.join(kit, "server"), path.join(workspace, "server"));
    fs.writeFileSync(path.join(workspace, "MULTIPLAYER.md"), GUIDE, "utf8");
    const example = path.join(workspace, ".env.example");
    const existing = fs.existsSync(example) ? fs.readFileSync(example, "utf8") : "";
    if (!/VITE_NET_URL/.test(existing)) {
      fs.writeFileSync(example, `${existing.trimEnd() ? `${existing.trimEnd()}\n\n` : ""}# The multiplayer room server (server/); empty = players in other tabs of this browser.\nVITE_NET_URL=\n`, "utf8");
    }
  },

  /** What the build's model is told when the game has the kit. */
  preamble(workspace: string): string {
    if (!NetKit.installed(workspace)) return "";
    return `Multiplayer: this game plays online through src/lib/net (already written — import it, never rewrite it or add a socket library):
  import { connect, joinCode, listRooms, lerp, type Rules, type Player } from "./lib/net";
  import { useRoom } from "./lib/net/react";   // re-renders on every change, leaves on unmount
Put ALL shared game logic in one pure rules object: { init(players), apply(state, action, playerId), tick?(state, dtMs), join?(state, player), leave?(state, playerId) }.
The host runs the rules; every player calls room.send(action) and draws room.state and room.players (room.me, room.isHost, room.status, room.latencyMs).
Give the game a lobby: create a room (joinCode()), join by code, show who is in, then play; show "reconnecting" when room.status says so.
Use lerp to smooth movement between snapshots. Keep state small (it is sent 15 times a second). server/ is the room server; leave it as it is.

`;
  }
};
