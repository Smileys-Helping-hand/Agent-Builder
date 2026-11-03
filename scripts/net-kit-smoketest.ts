/**
 * Smoketest: the games' multiplayer kit (templates/net-kit), for real: the
 * room server on a free port and players connected over WebSockets, plus two
 * "tabs" on the local transport.
 *   - the first player hosts; another joins and sees the shared state
 *   - a player's action reaches the host and comes back to everyone
 *   - the host's clock runs the game (tick) and its snapshots reach everyone
 *   - the host leaves: the next player takes over with the game as it was
 *   - a dropped player gets their seat back with their token
 *   - full rooms, flooding and the lobby list
 *   - without a server, tabs of one browser play together
 *   - inside another server, on one path (how Agent Builder hosts its demos' rooms)
 *   - NetKit puts the kit into a build and tells the model how to use it
 *
 *   npx tsx scripts/net-kit-smoketest.ts
 */
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

import { NetKit } from "../src/game/NetKit.js";

process.env.MAX_PLAYERS = "3";
process.env.SEAT_GRACE_MS = "2000";

const fail = (message: string): never => {
  throw new Error(message);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (what: string, ok: () => boolean, ms = 4000) => {
  const started = Date.now();
  while (!ok()) {
    if (Date.now() - started > ms) fail(`timed out waiting for: ${what}`);
    await sleep(20);
  }
};

interface Game {
  count: number;
  ticks: number;
  who: string[];
}
type Action = { type: "inc"; by: number };
const rules = {
  init: (): Game => ({ count: 0, ticks: 0, who: [] }),
  apply: (state: Game, action: Action, playerId: string): Game => ({ ...state, count: state.count + action.by, who: [...state.who, playerId] }),
  tick: (state: Game): Game => ({ ...state, ticks: state.ticks + 1 })
};

const main = async () => {
  const kit = path.resolve("templates/net-kit");
  const { startRoomServer } = (await import(pathToFileURL(path.join(kit, "server", "room-server.mjs")).href)) as {
    startRoomServer: (o: { port: number; log: boolean }) => Promise<{ port: number; close: () => Promise<void> }>;
  };
  const { connect, listRooms } = await import(pathToFileURL(path.join(kit, "src", "lib", "net", "index.ts")).href);
  const server = await startRoomServer({ port: 0, log: false });
  const url = `ws://127.0.0.1:${server.port}`;

  try {
    // 1. A hosts, B joins and sees the state.
    const a = connect(rules, { url, room: "TEST1", name: "Ana", tickHz: 50, snapshotHz: 25 });
    await until("Ana open", () => a.status === "open" && a.isHost);
    a.send({ type: "inc", by: 5 });
    const b = connect(rules, { url, room: "TEST1", name: "Ben", tickHz: 50, snapshotHz: 25 });
    await until("Ben sees the state", () => b.status === "open" && b.state.count === 5);
    if (b.isHost || b.players.length !== 2) fail(`Ben: host ${b.isHost}, players ${b.players.length}`);
    console.log("[PASS] the first player hosts; another joins and sees the shared state");

    // 2. B's action goes to the host and back to everyone.
    b.send({ type: "inc", by: 2 });
    await until("Ben's action applied everywhere", () => a.state.count === 7 && b.state.count === 7);
    if (a.state.who[a.state.who.length - 1] !== b.me!.id) fail("the host did not credit Ben's action to Ben");
    console.log("[PASS] a player's action reaches the host and comes back to everyone");

    // 3. The host's clock.
    const ticksBefore = b.state.ticks;
    await until("ticks reach Ben", () => b.state.ticks > ticksBefore + 5);
    console.log(`[PASS] the host runs the game's clock (${b.state.ticks} ticks) and its snapshots reach everyone`);

    // 4. The lobby.
    const lobby = await listRooms(url);
    if (!lobby.some((room: { id: string; players: number }) => room.id === "TEST1" && room.players === 2)) fail(`lobby: ${JSON.stringify(lobby)}`);
    console.log("[PASS] the lobby lists the open room");

    // 5. A room holds three here: the fourth is turned away.
    const c = connect(rules, { url, room: "TEST1", name: "Cy" });
    await until("Cy open", () => c.status === "open");
    const d = new WebSocket(url);
    const refused = await new Promise<string>((resolve) => {
      d.onopen = () => d.send(JSON.stringify({ t: "join", room: "TEST1", name: "Dee" }));
      d.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.t === "error") resolve(msg.message);
      };
    });
    if (!/full/.test(refused)) fail(`fourth player: ${refused}`);
    c.leave();
    console.log("[PASS] a full room turns the next player away");

    // 6. The host leaves: Ben takes over with the game as it was, and keeps it running.
    const countBefore = b.state.count;
    a.leave();
    await until("Ben becomes host", () => b.isHost, 6000);
    if (b.state.count !== countBefore) fail(`the game was lost in the handover: ${b.state.count} vs ${countBefore}`);
    b.send({ type: "inc", by: 1 });
    const ticksNow = b.state.ticks;
    await until("Ben's clock runs", () => b.state.ticks > ticksNow + 3 && b.state.count === countBefore + 1);
    console.log("[PASS] the host leaves: the next player takes over with the game as it was");

    // 7. A dropped connection gets its seat back with its token.
    const raw = new WebSocket(url);
    const first = await new Promise<{ id: string; token: string }>((resolve) => {
      raw.onopen = () => raw.send(JSON.stringify({ t: "join", room: "TEST2", name: "Eve" }));
      raw.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.t === "welcome") resolve(msg.you);
      };
    });
    raw.close();
    await sleep(200);
    const again = new WebSocket(url);
    const second = await new Promise<{ you: { id: string }; returning: boolean }>((resolve) => {
      again.onopen = () => again.send(JSON.stringify({ t: "join", room: "TEST2", name: "Eve", token: first.token }));
      again.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.t === "welcome") resolve(msg);
      };
    });
    if (second.you.id !== first.id || !second.returning) fail(`seat: ${JSON.stringify(second)}`);
    again.close();
    console.log("[PASS] a dropped player gets their seat back with their token");

    // 8. Flooding is cut off.
    const flood = new WebSocket(url);
    const cut = await new Promise<boolean>((resolve) => {
      flood.onopen = () => {
        flood.send(JSON.stringify({ t: "join", room: "TEST3", name: "Fay" }));
        for (let i = 0; i < 300; i++) flood.send(JSON.stringify({ t: "ping", at: i }));
      };
      flood.onmessage = (event) => {
        if (JSON.parse(String(event.data)).t === "error") resolve(true);
      };
      setTimeout(() => resolve(false), 2000);
    });
    if (!cut) fail("a flood was not cut off");
    flood.close();
    console.log("[PASS] a flood of messages is cut off");
    b.leave();

    // 9. Tabs of one browser, no server.
    const tab1 = connect(rules, { room: "LOCAL1", name: "Tab1", transport: "local", tickHz: 50, snapshotHz: 25 });
    await until("tab 1 open", () => tab1.status === "open");
    const tab2 = connect(rules, { room: "LOCAL1", name: "Tab2", transport: "local", tickHz: 50, snapshotHz: 25 });
    await until("tab 2 open", () => tab2.status === "open");
    tab2.send({ type: "inc", by: 3 });
    await until("the tabs share the game", () => tab1.state.count === 3 && tab2.state.count === 3);
    if (!tab1.isHost || tab2.isHost) fail(`local host: ${tab1.isHost} ${tab2.isHost}`);
    tab1.leave();
    tab2.leave();
    console.log("[PASS] without a server, tabs of one browser play together");
  } finally {
    await server.close();
  }

  // 10. Inside another server (how Agent Builder serves its game demos' rooms): ws://…/net and GET /net/rooms.
  const { attachRooms } = (await import(pathToFileURL(path.join(kit, "server", "room-server.mjs")).href)) as {
    attachRooms: (server: http.Server, o: { path: string }) => { handle: (req: http.IncomingMessage, res: http.ServerResponse) => boolean; close: () => void };
  };
  let rooms: ReturnType<typeof attachRooms> | null = null;
  const host = http.createServer((req, res) => {
    if (!rooms?.handle(req, res)) res.writeHead(404).end("app");
  });
  rooms = attachRooms(host, { path: "/net" });
  await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
  const hostUrl = `ws://127.0.0.1:${(host.address() as { port: number }).port}/net`;
  try {
    const p1 = connect(rules, { url: hostUrl, room: "HOSTED", name: "One", tickHz: 50, snapshotHz: 25 });
    const p2 = connect(rules, { url: hostUrl, room: "HOSTED", name: "Two", tickHz: 50, snapshotHz: 25 });
    await until("both open", () => p1.status === "open" && p2.status === "open");
    p2.send({ type: "inc", by: 4 });
    await until("shared through /net", () => p1.state.count === 4 && p2.state.count === 4);
    const listed = await listRooms(hostUrl);
    if (!listed.some((room: { id: string }) => room.id === "HOSTED")) fail(`/net/rooms: ${JSON.stringify(listed)}`);
    p1.leave();
    p2.leave();
  } finally {
    rooms.close();
    await new Promise((resolve) => host.close(resolve));
  }
  console.log("[PASS] inside another server, games play through its /net path");

  // 11. A build that asks for multiplayer gets the kit.
  if (!NetKit.wanted("a co-op dungeon crawler for 4 players online") || !NetKit.wanted("PvP arena") || NetKit.wanted("a cozy farming game")) fail("NetKit.wanted misjudged a prompt");
  const build = fs.mkdtempSync(path.join(os.tmpdir(), "netkit-"));
  try {
    if (NetKit.preamble(build)) fail("a preamble before the kit was installed");
    NetKit.install(build);
    for (const file of ["src/lib/net/index.ts", "src/lib/net/react.ts", "server/room-server.mjs", "server/package.json", "MULTIPLAYER.md", ".env.example"]) {
      if (!fs.existsSync(path.join(build, file))) fail(`the kit is missing ${file}`);
    }
    if (!/import \{ connect, joinCode/.test(NetKit.preamble(build))) fail("the preamble does not explain the kit");
    NetKit.install(build);
    if ((fs.readFileSync(path.join(build, ".env.example"), "utf8").match(/VITE_NET_URL/g) ?? []).length !== 1) fail("installing twice repeated VITE_NET_URL");
  } finally {
    fs.rmSync(build, { recursive: true, force: true });
  }
  console.log("[PASS] a build that asks for multiplayer gets the kit, and its model is told how to use it");
  console.log("All multiplayer checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Multiplayer smoketest failed:", error?.message ?? error);
    finish(1);
  });
