#!/usr/bin/env node
/**
 * Room server for the game's multiplayer (src/lib/net). Generic: it knows
 * nothing about the game. It keeps rooms of players, makes the first player
 * the host (the game's authority), relays messages between the host and the
 * others, and hands the host role on when the host leaves.
 *
 *   npm install && node room-server.mjs           # port 8787, or PORT=…
 *
 * Players reach it at ws://<host>:8787 (wss:// behind a TLS proxy such as
 * Cloudflare Tunnel). GET /rooms lists the open public rooms for a lobby;
 * GET /health answers "ok".
 *
 * Safety: messages over 64 KB are refused, each player may send 120 messages a
 * second, rooms hold at most MAX_PLAYERS (16), there are at most MAX_ROOMS
 * (500) rooms, and a player who drops keeps their seat for 30 seconds so a
 * reconnect lands back in the same game.
 *
 * Inside another server: attachRooms(httpServer, { path: '/net' }) serves the
 * same rooms on ws://<that server>/net (and GET /net/rooms).
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16;
const MAX_BYTES = 64 * 1024;
const RATE_PER_SECOND = 120;
const SEAT_GRACE_MS = Number(process.env.SEAT_GRACE_MS) || 30_000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;
const ROOM_NAME = /^[A-Za-z0-9_-]{1,40}$/;

/** room id -> { id, public, created, hostId, players: Map<id, {id,name,token,socket,joinedAt,goneAt}> } */
const rooms = new Map();
const newId = () => randomBytes(6).toString('base64url');

const send = (socket, message) => {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
};
const present = (room) => [...room.players.values()].filter((p) => !p.goneAt);
const roster = (room) => present(room).map((p) => ({ id: p.id, name: p.name, joinedAt: p.joinedAt }));
const toRoom = (room, message, exceptId) => {
  for (const player of present(room)) if (player.id !== exceptId) send(player.socket, message);
};

/** The host leaves: the longest-present player takes over, with the last state they saw. */
const pickHost = (room) => {
  const next = present(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  room.hostId = next ? next.id : null;
  if (next) toRoom(room, { t: 'host', id: next.id });
};

const dropSeat = (room, player) => {
  room.players.delete(player.id);
  toRoom(room, { t: 'left', id: player.id });
  if (room.hostId === player.id) pickHost(room);
  if (room.players.size === 0) rooms.delete(room.id);
};

/** GET /rooms: the open public rooms, for a lobby. */
const listing = () => ({
  rooms: [...rooms.values()]
    .filter((room) => room.public && present(room).length < MAX_PLAYERS)
    .map((room) => ({ id: room.id, players: present(room).length, max: MAX_PLAYERS, created: room.created })),
});

/** Serves rooms on a WebSocketServer. */
function serveRooms(wss) {
  wss.on('connection', (socket) => {
    let room = null;
    let me = null;
    let windowStart = Date.now();
    let count = 0;

    socket.on('message', (raw) => {
      // A flood is cut off rather than relayed.
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > RATE_PER_SECOND) return send(socket, { t: 'error', message: 'Too many messages.' });
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return send(socket, { t: 'error', message: 'Messages are JSON.' });
      }

      if (msg.t === 'ping') return send(socket, { t: 'pong', at: msg.at });

      if (msg.t === 'join') {
        if (room) return;
        const roomId = typeof msg.room === 'string' && ROOM_NAME.test(msg.room) ? msg.room : newId();
        room = rooms.get(roomId);
        if (!room) {
          if (rooms.size >= MAX_ROOMS) {
            send(socket, { t: 'error', message: 'The server is full; try again soon.' });
            return socket.close();
          }
          room = { id: roomId, public: msg.public !== false, created: now, hostId: null, players: new Map() };
          rooms.set(roomId, room);
        }
        // Back in the same seat with the token from before.
        const returning = typeof msg.token === 'string' ? [...room.players.values()].find((p) => p.token === msg.token) : null;
        if (returning) {
          me = returning;
          clearTimeout(me.dropTimer);
          me.socket = socket;
          me.goneAt = null;
        } else {
          if (present(room).length >= MAX_PLAYERS) {
            send(socket, { t: 'error', message: 'The room is full.' });
            room = null;
            return socket.close();
          }
          me = { id: newId(), name: String(msg.name ?? 'Player').slice(0, 24), token: newId() + newId(), socket, joinedAt: now, goneAt: null };
          room.players.set(me.id, me);
        }
        const currentHost = room.hostId ? room.players.get(room.hostId) : null;
        if (!currentHost || currentHost.goneAt) room.hostId = me.id;
        send(socket, { t: 'welcome', room: room.id, you: { id: me.id, name: me.name, token: me.token }, host: room.hostId, players: roster(room), returning: Boolean(returning) });
        toRoom(room, { t: returning ? 'back' : 'joined', player: { id: me.id, name: me.name, joinedAt: me.joinedAt } }, me.id);
        return;
      }

      if (!room || !me) return send(socket, { t: 'error', message: 'Join a room first.' });
      const host = room.players.get(room.hostId);
      if (msg.t === 'to-host') {
        // From a player to the authority.
        if (host && host.id !== me.id) send(host.socket, { t: 'from', from: me.id, data: msg.data });
        return;
      }
      if (me.id !== room.hostId) return send(socket, { t: 'error', message: 'Only the host sends to everyone.' });
      if (msg.t === 'broadcast') return toRoom(room, { t: 'from', from: me.id, data: msg.data }, me.id);
      if (msg.t === 'to' && typeof msg.id === 'string') {
        const target = room.players.get(msg.id);
        if (target) send(target.socket, { t: 'from', from: me.id, data: msg.data });
      }
    });

    socket.on('close', () => {
      if (!room || !me || me.socket !== socket) return;
      // Keep the seat a while: a dropped connection usually comes straight back.
      me.goneAt = Date.now();
      toRoom(room, { t: 'away', id: me.id });
      if (room.hostId === me.id) pickHost(room);
      const leaving = me;
      const theRoom = room;
      leaving.dropTimer = setTimeout(() => {
        if (leaving.goneAt) dropSeat(theRoom, leaving);
      }, SEAT_GRACE_MS);
    });
  });

}

export function startRoomServer({ port = PORT, log = true } = {}) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url === '/health') return res.end('ok');
    if (req.url === '/rooms') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(listing()));
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ server, maxPayload: MAX_BYTES });
  serveRooms(wss);

  return new Promise((resolve) => {
    server.listen(port, () => {
      if (log) console.log(`[rooms] listening on ${port}`);
      resolve({
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => server.close(() => done()));
          }),
      });
    });
  });
}

/**
 * The same rooms inside an existing HTTP server, on one path: WebSocket
 * upgrades to `path` join rooms, GET `path`/rooms lists them. Returns a
 * request handler for that GET (call it first; it answers false for anything
 * else) and a close().
 */
export function attachRooms(httpServer, { path = '/net' } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES });
  serveRooms(wss);
  const onUpgrade = (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== path && pathname !== `${path}/`) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  httpServer.on('upgrade', onUpgrade);
  return {
    handle(req, res) {
      const pathname = (req.url ?? '').split('?')[0];
      if (pathname !== `${path}/rooms` && pathname !== `${path}/health`) return false;
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (pathname.endsWith('/health')) res.end('ok');
      else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(listing()));
      }
      return true;
    },
    close() {
      httpServer.off('upgrade', onUpgrade);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) void startRoomServer();
