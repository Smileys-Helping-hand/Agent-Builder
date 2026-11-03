/**
 * Multiplayer for this game: rooms, players and one shared game state.
 *
 *   const room = connect(rules, { room: "ABCDE", name: "Ana" });
 *   room.subscribe(() => render(room.state, room.players));
 *   room.send({ type: "move", dx: 1 });
 *
 * The game's rules live in one place and run on one machine at a time: the
 * host (the first player in; when the host leaves, the next takes over with
 * the latest state). Everyone sends their actions to the host, the host
 * applies them with `rules.apply`, runs `rules.tick` at `tickHz` and sends the
 * state to everyone `snapshotHz` times a second. With `predict`, your own
 * actions show at once and the next snapshot corrects them.
 *
 * Transports: with a room-server URL (options.url or VITE_NET_URL) players
 * meet through server/room-server.mjs, from anywhere; without one, players in
 * other tabs of this browser join the same room (BroadcastChannel) — so
 * multiplayer works in a preview with no server at all.
 *
 * A dropped connection reconnects by itself and gets its seat back.
 */

export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  /** Disconnected, seat kept for a moment. */
  away?: boolean;
}

export interface Rules<S, A> {
  /** The state a new game starts from. */
  init(players: Player[]): S;
  /** A player's action. Return a new state; never change the old one. */
  apply(state: S, action: A, playerId: string): S;
  /** Time passing (physics, timers, AI), on the host only. */
  tick?(state: S, dtMs: number): S;
  join?(state: S, player: Player): S;
  leave?(state: S, playerId: string): S;
}

export interface NetOptions {
  /** ws:// or wss:// address of the room server; none = this browser's tabs only. */
  url?: string;
  /** Room to join (a join code); a new one is made when left out. */
  room?: string;
  name?: string;
  transport?: "auto" | "server" | "local";
  tickHz?: number;
  snapshotHz?: number;
  /** Show your own actions at once, before the host's next snapshot. */
  predict?: boolean;
  /** Listed in the lobby (server only). */
  public?: boolean;
}

export type Status = "connecting" | "open" | "reconnecting" | "closed";

export interface Room<S, A> {
  readonly id: string;
  readonly me: Player | null;
  readonly players: Player[];
  readonly isHost: boolean;
  readonly state: S;
  readonly status: Status;
  readonly latencyMs: number | null;
  readonly transport: "server" | "local";
  send(action: A): void;
  subscribe(listener: () => void): () => void;
  leave(): void;
}

/* ─── wire ─── */

type GameMessage<S, A> = { k: "act"; a: A } | { k: "state"; s: S; seq: number };

interface Handlers {
  welcome(roomId: string, you: { id: string; name: string; token?: string }, hostId: string | null, players: Player[]): void;
  joined(player: Player): void;
  back(player: Player): void;
  away(id: string): void;
  left(id: string): void;
  host(id: string): void;
  from(fromId: string, data: unknown): void;
  status(status: Status): void;
  latency(ms: number): void;
}

interface Transport {
  readonly kind: "server" | "local";
  toHost(data: unknown): void;
  broadcast(data: unknown): void;
  to(id: string, data: unknown): void;
  close(): void;
}

/** The room server: VITE_NET_URL when the game was built with one, else the one the page's host provides (Agent Builder's demos). */
const envUrl = (): string | undefined => {
  try {
    const built = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_NET_URL;
    if (built) return built;
  } catch {
    // Not built by Vite.
  }
  const given = (globalThis as { AB_NET_URL?: unknown }).AB_NET_URL;
  return typeof given === "string" && given ? given : undefined;
};

const storage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

/** A short code people can read out to each other. */
export function joinCode(length = 5): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

/** The open public rooms on a room server, for a lobby. */
export async function listRooms(url = envUrl()): Promise<Array<{ id: string; players: number; max: number }>> {
  if (!url) return [];
  const http = url.replace(/^ws/, "http").replace(/\/+$/, "");
  const res = await fetch(`${http}/rooms`);
  return ((await res.json()) as { rooms: Array<{ id: string; players: number; max: number }> }).rooms;
}

/* ─── server transport ─── */

function serverTransport(url: string, roomId: string, name: string, isPublic: boolean, on: Handlers): Transport {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let pinger: ReturnType<typeof setInterval> | null = null;
  const tokenKey = `net-token:${url}:${roomId}`;
  let token = storage()?.getItem(tokenKey) ?? undefined;

  const send = (message: unknown) => {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  };

  const open = () => {
    on.status(attempt === 0 ? "connecting" : "reconnecting");
    socket = new WebSocket(url);
    socket.onopen = () => {
      attempt = 0;
      send({ t: "join", room: roomId, name, token, public: isPublic });
      pinger = setInterval(() => send({ t: "ping", at: Date.now() }), 5000);
      send({ t: "ping", at: Date.now() });
    };
    socket.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome": {
          const you = msg.you as { id: string; name: string; token: string };
          token = you.token;
          storage()?.setItem(tokenKey, you.token);
          on.welcome(String(msg.room), you, (msg.host as string) ?? null, (msg.players as Player[]) ?? []);
          on.status("open");
          break;
        }
        case "joined":
          on.joined(msg.player as Player);
          break;
        case "back":
          on.back(msg.player as Player);
          break;
        case "away":
          on.away(String(msg.id));
          break;
        case "left":
          on.left(String(msg.id));
          break;
        case "host":
          on.host(String(msg.id));
          break;
        case "from":
          on.from(String(msg.from), msg.data);
          break;
        case "pong":
          on.latency(Date.now() - Number(msg.at));
          break;
      }
    };
    socket.onclose = () => {
      if (pinger) clearInterval(pinger);
      if (closed) return on.status("closed");
      // Back again with a growing wait: 0.5 s, 1, 2, 4… up to 15 s.
      const wait = Math.min(15_000, 500 * 2 ** attempt++);
      on.status("reconnecting");
      setTimeout(() => !closed && open(), wait);
    };
  };
  open();

  return {
    kind: "server",
    toHost: (data) => send({ t: "to-host", data }),
    broadcast: (data) => send({ t: "broadcast", data }),
    to: (id, data) => send({ t: "to", id, data }),
    close: () => {
      closed = true;
      if (pinger) clearInterval(pinger);
      socket?.close();
    }
  };
}

/* ─── local transport: other tabs of this browser ─── */

function localTransport(roomId: string, name: string, on: Handlers): Transport {
  const id = Math.random().toString(36).slice(2, 10);
  const joinedAt = Date.now() + Math.random();
  const channel = new BroadcastChannel(`net-room:${roomId}`);
  const seen = new Map<string, Player & { lastSeen: number }>();
  let hostId: string | null = null;
  let closed = false;

  const me: Player = { id, name, joinedAt };
  const post = (message: Record<string, unknown>) => !closed && channel.postMessage({ ...message, sender: id });
  const present = () => [...seen.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const electHost = () => {
    const next = present()[0]?.id ?? null;
    if (next !== hostId) {
      hostId = next;
      if (next) on.host(next);
    }
  };

  seen.set(id, { ...me, lastSeen: Date.now() });
  channel.onmessage = (event: MessageEvent) => {
    const msg = event.data as Record<string, unknown>;
    if (!msg || msg.sender === id) return;
    const sender = String(msg.sender);
    if (msg.t === "hello" || msg.t === "beat") {
      const known = seen.has(sender);
      seen.set(sender, { id: sender, name: String(msg.name), joinedAt: Number(msg.joinedAt), lastSeen: Date.now() });
      if (!known) {
        on.joined({ id: sender, name: String(msg.name), joinedAt: Number(msg.joinedAt) });
        if (msg.t === "hello") post({ t: "beat", name, joinedAt });
        electHost();
      }
      return;
    }
    if (msg.t === "bye") {
      if (seen.delete(sender)) on.left(sender);
      electHost();
      return;
    }
    if (msg.t === "msg" && (msg.to === id || msg.to === "*")) on.from(sender, msg.data);
  };

  // Hello, then a heartbeat; a tab silent for 6 s has gone.
  post({ t: "hello", name, joinedAt });
  const beat = setInterval(() => {
    post({ t: "beat", name, joinedAt });
    const now = Date.now();
    for (const player of [...seen.values()]) {
      if (player.id !== id && now - player.lastSeen > 6000) {
        seen.delete(player.id);
        on.left(player.id);
      }
    }
    electHost();
  }, 2000);

  // Welcome after a moment, once the tabs already in the room have answered.
  setTimeout(() => {
    if (closed) return;
    hostId = present()[0]?.id ?? id;
    on.welcome(roomId, { id, name }, hostId, present().map(({ lastSeen: _seen, ...p }) => p));
    on.status("open");
    on.latency(0);
  }, 150);

  return {
    kind: "local",
    toHost: (data) => hostId && post({ t: "msg", to: hostId, data }),
    broadcast: (data) => post({ t: "msg", to: "*", data }),
    to: (target, data) => post({ t: "msg", to: target, data }),
    close: () => {
      post({ t: "bye" });
      closed = true;
      clearInterval(beat);
      channel.close();
    }
  };
}

/* ─── the room ─── */

export function connect<S, A>(rules: Rules<S, A>, options: NetOptions = {}): Room<S, A> {
  const url = options.url ?? envUrl();
  const useServer = options.transport === "server" || (options.transport !== "local" && Boolean(url));
  const roomId = options.room ?? joinCode();
  const name = (options.name ?? "Player").slice(0, 24);
  const tickMs = 1000 / Math.max(1, Math.min(60, options.tickHz ?? 20));
  const snapshotMs = 1000 / Math.max(1, Math.min(30, options.snapshotHz ?? 15));

  const listeners = new Set<() => void>();
  let state: S = rules.init([]);
  let confirmed: S = state;
  let players: Player[] = [];
  let me: Player | null = null;
  let hostId: string | null = null;
  let status: Status = "connecting";
  let latencyMs: number | null = null;
  let seq = 0;
  let loop: ReturnType<typeof setInterval> | null = null;
  let lastTick = Date.now();
  let lastSnapshot = 0;
  let started = false;

  const notify = () => listeners.forEach((listener) => listener());
  const isHost = () => Boolean(me && hostId === me.id);
  const snapshot = (): GameMessage<S, A> => ({ k: "state", s: state, seq: ++seq });

  // The host's clock: the game's time, and the snapshots everyone sees.
  const startHosting = () => {
    if (!started) {
      state = rules.init(players);
      started = true;
    }
    confirmed = state;
    lastTick = Date.now();
    loop ??= setInterval(() => {
      if (!isHost()) return;
      const now = Date.now();
      if (rules.tick) state = rules.tick(state, now - lastTick);
      lastTick = now;
      confirmed = state;
      if (now - lastSnapshot >= snapshotMs) {
        lastSnapshot = now;
        transport.broadcast(snapshot());
      }
      notify();
    }, tickMs);
  };

  const handlers: Handlers = {
    welcome(_room, you, host, list) {
      me = { id: you.id, name: you.name, joinedAt: list.find((p) => p.id === you.id)?.joinedAt ?? Date.now() };
      players = list;
      hostId = host;
      if (isHost()) startHosting();
      else transport.toHost({ k: "hello" });
      notify();
    },
    joined(player) {
      players = [...players.filter((p) => p.id !== player.id), player];
      if (isHost()) {
        if (rules.join) state = rules.join(state, player);
        transport.to(player.id, snapshot());
      }
      notify();
    },
    back(player) {
      players = players.map((p) => (p.id === player.id ? { ...p, away: false } : p));
      if (isHost()) transport.to(player.id, snapshot());
      notify();
    },
    away(id) {
      players = players.map((p) => (p.id === id ? { ...p, away: true } : p));
      notify();
    },
    left(id) {
      players = players.filter((p) => p.id !== id);
      if (isHost() && rules.leave) state = rules.leave(state, id);
      notify();
    },
    host(id) {
      hostId = id;
      // Taking over: carry on from the last state the old host sent.
      if (isHost()) {
        started = true;
        state = confirmed;
        startHosting();
        transport.broadcast(snapshot());
      }
      notify();
    },
    from(fromId, data) {
      const message = data as GameMessage<S, A> | { k: "hello" };
      if (!message || typeof message !== "object") return;
      if (isHost() && message.k === "act") {
        state = rules.apply(state, message.a, fromId);
        notify();
      } else if (isHost() && message.k === "hello") {
        transport.to(fromId, snapshot());
      } else if (!isHost() && message.k === "state") {
        confirmed = message.s;
        state = message.s;
        started = true;
        notify();
      }
    },
    status(next) {
      status = next;
      notify();
    },
    latency(ms) {
      latencyMs = ms;
      notify();
    }
  };

  const transport: Transport = useServer
    ? serverTransport(url!, roomId, name, options.public !== false, handlers)
    : localTransport(roomId, name, handlers);

  return {
    get id() {
      return roomId;
    },
    get me() {
      return me;
    },
    get players() {
      return players;
    },
    get isHost() {
      return isHost();
    },
    get state() {
      return state;
    },
    get status() {
      return status;
    },
    get latencyMs() {
      return latencyMs;
    },
    get transport() {
      return transport.kind;
    },
    send(action: A) {
      if (!me) return;
      if (isHost()) {
        state = rules.apply(state, action, me.id);
        notify();
        return;
      }
      if (options.predict) {
        state = rules.apply(state, action, me.id);
        notify();
      }
      transport.toHost({ k: "act", a: action });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    leave() {
      if (loop) clearInterval(loop);
      loop = null;
      transport.close();
      status = "closed";
      notify();
    }
  };
}

/** Smooth movement between two snapshots: a value `alpha` (0..1) of the way from a to b. */
export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, alpha));
}
