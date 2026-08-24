/**
 * Collab mode - live group workout rooms.
 *
 * A room is a short-lived, in-memory group session. The server does two jobs:
 *
 *  1. Relays live workout stats (reps, accuracy) so everyone sees a shared
 *     leaderboard update in real time.
 *  2. Relays WebRTC signalling so participants can connect video peer-to-peer.
 *     Video never touches this server - a mesh keeps bandwidth off the backend
 *     and works fine at the group sizes this is meant for.
 *
 * Rooms are deliberately not persisted: a workout session is ephemeral, and
 * keeping them in memory means a restart cannot leak stale rooms. The trade-off
 * is that a server restart drops active sessions, which is acceptable here.
 */

const { WebSocketServer } = require('ws');
const crypto = require('crypto');

/** Rooms with no members are swept after this long. */
const EMPTY_ROOM_TTL_MS = 60 * 1000;
/** Hard cap: this is a WebRTC mesh, which degrades badly beyond a handful. */
const MAX_PARTICIPANTS = 8;
/** A room cannot outlive this regardless of activity. */
const MAX_ROOM_AGE_MS = 4 * 60 * 60 * 1000;
/** Clients must pong within this or they are dropped. */
const HEARTBEAT_MS = 30 * 1000;

/** roomCode -> room */
const rooms = new Map();

/**
 * Room codes are short enough to read aloud but drawn from a 31-char alphabet
 * (no 0/O/1/I/L) so they survive being dictated across a gym.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

function createRoom({ hostName, activityName, targetReps }) {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const room = {
    code,
    hostName,
    activityName,
    targetReps: targetReps || 0,
    createdAt: Date.now(),
    startedAt: null,
    participants: new Map(), // peerId -> participant
  };

  rooms.set(code, room);
  return room;
}

function roomSnapshot(room) {
  return {
    code: room.code,
    activityName: room.activityName,
    targetReps: room.targetReps,
    hostName: room.hostName,
    startedAt: room.startedAt,
    participants: [...room.participants.values()].map((p) => ({
      peerId: p.peerId,
      name: p.name,
      isHost: p.isHost,
      reps: p.reps,
      accuracy: p.accuracy,
      finished: p.finished,
    })),
  };
}

function send(ws, type, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

/** Sends to everyone in the room, optionally skipping one peer. */
function broadcast(room, type, payload, exceptPeerId = null) {
  for (const p of room.participants.values()) {
    if (p.peerId === exceptPeerId) continue;
    send(p.ws, type, payload);
  }
}

function removeParticipant(room, peerId) {
  const participant = room.participants.get(peerId);
  if (!participant) return;

  room.participants.delete(peerId);
  broadcast(room, 'peer-left', { peerId });

  // Promote someone so the room is not left without a host.
  if (participant.isHost && room.participants.size > 0) {
    const next = room.participants.values().next().value;
    next.isHost = true;
    room.hostName = next.name;
    broadcast(room, 'host-changed', { peerId: next.peerId, name: next.name });
  }

  if (room.participants.size === 0) {
    room.emptySince = Date.now();
  } else {
    broadcast(room, 'room-state', { room: roomSnapshot(room) });
  }
}

/** Periodic sweep of empty and expired rooms. */
function sweepRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const expired = now - room.createdAt > MAX_ROOM_AGE_MS;
    const emptyTooLong =
      room.participants.size === 0 &&
      room.emptySince &&
      now - room.emptySince > EMPTY_ROOM_TTL_MS;

    if (expired || emptyTooLong) {
      broadcast(room, 'room-closed', { reason: expired ? 'expired' : 'empty' });
      for (const p of room.participants.values()) p.ws.close();
      rooms.delete(code);
    }
  }
}

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(ws, 'error', { message: 'Malformed message' });
  }

  const { type } = msg;

  // ---- join ----
  if (type === 'join') {
    const room = rooms.get((msg.code || '').toUpperCase());
    if (!room) return send(ws, 'error', { message: 'Room not found', fatal: true });

    if (room.participants.size >= MAX_PARTICIPANTS) {
      return send(ws, 'error', { message: 'Room is full', fatal: true });
    }

    const peerId = crypto.randomUUID();
    const participant = {
      peerId,
      ws,
      name: (msg.name || 'Athlete').slice(0, 32),
      isHost: room.participants.size === 0,
      reps: 0,
      accuracy: 0,
      finished: false,
    };

    room.participants.set(peerId, participant);
    room.emptySince = null;

    ws.peerId = peerId;
    ws.roomCode = room.code;

    // The joiner learns who is already here; existing peers learn about them.
    send(ws, 'joined', { peerId, room: roomSnapshot(room) });
    broadcast(room, 'peer-joined', { peerId, name: participant.name }, peerId);
    broadcast(room, 'room-state', { room: roomSnapshot(room) });
    return;
  }

  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const self = room.participants.get(ws.peerId);
  if (!self) return;

  switch (type) {
    // ---- live stats ----
    case 'stats': {
      // Clamped: a client could otherwise post an arbitrary score to the board.
      self.reps = Math.max(0, Math.min(10000, Number(msg.reps) || 0));
      self.accuracy = Math.max(0, Math.min(100, Number(msg.accuracy) || 0));
      broadcast(room, 'peer-stats', {
        peerId: self.peerId,
        reps: self.reps,
        accuracy: self.accuracy,
      });
      break;
    }

    case 'finished': {
      self.finished = true;
      broadcast(room, 'peer-finished', { peerId: self.peerId, reps: self.reps });
      if ([...room.participants.values()].every((p) => p.finished)) {
        broadcast(room, 'session-complete', { room: roomSnapshot(room) });
      }
      break;
    }

    // ---- host controls ----
    case 'start': {
      if (!self.isHost) return;
      room.startedAt = Date.now() + 3000; // 3s countdown so everyone starts together
      for (const p of room.participants.values()) {
        p.reps = 0;
        p.accuracy = 0;
        p.finished = false;
      }
      broadcast(room, 'session-start', { startsAt: room.startedAt });
      break;
    }

    // ---- WebRTC signalling (relayed verbatim, never inspected) ----
    case 'signal': {
      const target = room.participants.get(msg.targetPeerId);
      if (!target) return;
      send(target.ws, 'signal', {
        fromPeerId: self.peerId,
        signal: msg.signal,
      });
      break;
    }

    case 'leave': {
      removeParticipant(room, self.peerId);
      ws.close();
      break;
    }

    default:
      break;
  }
}

/**
 * Attaches the collab WebSocket server and REST routes to an existing HTTP
 * server, so it shares a port with the API rather than needing another one.
 */
function attachCollab(httpServer, app) {
  const wss = new WebSocketServer({ server: httpServer, path: '/collab' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      try {
        handleMessage(ws, raw.toString());
      } catch (err) {
        console.error('Collab message error:', err);
      }
    });

    ws.on('close', () => {
      const room = rooms.get(ws.roomCode);
      if (room) removeParticipant(room, ws.peerId);
    });

    ws.on('error', () => ws.close());
  });

  // Drop half-open connections: without this, a peer that loses signal lingers
  // in the participant list forever.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    sweepRooms();
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));

  // --- REST: create and look up rooms ---
  app.post('/api/collab/rooms', (req, res) => {
    const { hostName, activityName, targetReps } = req.body || {};
    if (!activityName) {
      return res.status(400).json({ success: false, error: 'activityName is required' });
    }
    const room = createRoom({
      hostName: (hostName || 'Athlete').slice(0, 32),
      activityName,
      targetReps,
    });
    res.status(201).json({ success: true, code: room.code, room: roomSnapshot(room) });
  });

  app.get('/api/collab/rooms/:code', (req, res) => {
    const room = rooms.get((req.params.code || '').toUpperCase());
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    res.json({ success: true, room: roomSnapshot(room) });
  });

  console.log('Collab WebSocket server listening on /collab');
  return wss;
}

module.exports = { attachCollab };
