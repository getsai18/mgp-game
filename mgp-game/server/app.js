// Servidor del juego: HTTP (build del cliente + API de pruebas) y WebSockets (socket.io).
// La lógica de la partida con autoridad del servidor está en game.js; los esquemas Zod en schemas.js.
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import GameRoom from './game.js';
import Telemetry from './telemetry.js';
import {
  parse, moveSchema, shootSchema, spawnSchema, pickupSchema, throwSchema, hitSchema,
  infoSchema, tauntSchema, pingSchema, roomSchema, readySchema, seedSchema,
} from './schemas.js';

const EVENTS_PER_SECOND = 200; // tope de mensajes por cliente (anti-spam)

function hashPassword(password) {
  if (!password) return null;
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(password, salt, 32) };
}

function checkPassword(stored, password) {
  if (!stored) return true;
  const hash = scryptSync(password ?? '', stored.salt, 32);
  return timingSafeEqual(hash, stored.hash);
}

export function createGameServer({ telemetry = new Telemetry(), distDir } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 1e4, // los eventos son diminutos; cortamos payloads abusivos
    cors: { origin: '*' },
  });
  const rooms = new Map(); // id -> GameRoom
  const privateByCode = new Map(); // código -> GameRoom
  let nextRoomId = 1;

  // ------------------------------------------------------------- HTTP
  // Tiempo de respuesta en la cabecera X-Response-Time (solo API: los estáticos van en streaming
  // y ya han enviado las cabeceras cuando terminan).
  app.use('/api', (req, res, next) => {
    const t0 = process.hrtime.bigint();
    const end = res.end;
    res.end = function (...args) {
      if (!res.headersSent) res.setHeader('X-Response-Time', `${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2)}ms`);
      return end.apply(this, args);
    };
    next();
  });
  app.use('/api/test', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  const live = () => ({
    rooms: rooms.size,
    players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0),
    playing: [...rooms.values()].filter((r) => r.phase !== 'waiting').length,
    rejectedActions: [...rooms.values()].reduce((n, r) => n + r.violations, 0),
  });

  app.get('/health', (_req, res) => res.send('ok'));
  app.get('/api/test/health', (_req, res) => res.json({ status: 'ok', uptimeS: Math.round(process.uptime()), live: live() }));
  app.get('/api/test/ping', (_req, res) => res.json({ pong: true, serverTime: Date.now() }));
  app.get('/api/test/telemetry', (_req, res) => res.json(telemetry.summary(live())));
  app.get('/api/test/rooms', (_req, res) => res.json([...rooms.values()].map((r) => ({
    id: r.id, private: r.isPrivate, code: r.isPrivate ? r.code : null, phase: r.phase, round: r.round, map: r.map.name, score: r.score, players: r.players.length,
  }))));
  app.post('/api/test/seed', (req, res) => {
    const body = seedSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Payload inválido: { count: 100..1000, seed?, reset? } o { matches: [100..1000 partidas] }', issues: body.error.issues });
    }
    const t0 = performance.now();
    if (body.data.reset) telemetry.reset();
    let inserted;
    if ('count' in body.data) inserted = telemetry.seed(body.data.count, body.data.seed);
    else {
      body.data.matches.forEach((m) => telemetry.record(m));
      inserted = body.data.matches.length;
    }
    const insertMs = performance.now() - t0;
    const q0 = performance.now();
    const summary = telemetry.summary(live());
    res.status(201).json({ inserted, totalMatches: summary.matches, insertMs: +insertMs.toFixed(2), queryMs: +(performance.now() - q0).toFixed(3) });
  });

  if (distDir) app.use(express.static(distDir));

  // ------------------------------------------------------------- salas
  function createRoom(opts = {}) {
    const id = `room-${nextRoomId++}`;
    const room = new GameRoom({
      id,
      telemetry,
      ...opts,
      send: (socketId, evt, data) => io.to(socketId).emit(evt, data),
      broadcast: (evt, data) => io.to(id).emit(evt, data),
    });
    rooms.set(id, room);
    if (room.isPrivate) privateByCode.set(room.code, room);
    return room;
  }

  function deleteRoom(room) {
    room.stopMatch();
    rooms.delete(room.id);
    if (room.isPrivate) privateByCode.delete(room.code);
  }

  function join(socket, room) {
    const p = room.addPlayer(socket.id, socket.data.name);
    if (!p) return false;
    socket.data.room = room;
    socket.join(room.id);
    socket.emit('joined', { roomId: room.id, playerIndex: p.index, isHost: room.hostId === socket.id, code: room.code, private: room.isPrivate });
    console.log(`[${room.id}] ${socket.id} entró como jugador ${p.index + 1} (${room.players.length}/2)`);
    io.to(room.id).emit('room:state', room.lobbyState());
    // Partida rápida: empieza al llenarse. Sala privada: cuando los dos marcan "Listo".
    if (!room.isPrivate && room.full) startMatch(room);
    return true;
  }

  function startMatch(room) {
    room.startMatch();
    io.to(room.id).emit('match_start', { seed: room.mapSeed });
  }

  function leave(socket) {
    const room = socket.data.room;
    if (!room) return;
    socket.data.room = null;
    socket.leave(room.id);
    room.removePlayer(socket.id);
    console.log(`[${room.id}] ${socket.id} salió`);
    if (room.players.length === 0) return deleteRoom(room);
    // El que queda pasa a ser host y espera a un nuevo rival.
    io.to(room.hostId).emit('opponent_left', { isHost: true });
    io.to(room.id).emit('room:state', room.lobbyState());
  }

  // ------------------------------------------------------------- sockets
  io.on('connection', (socket) => {
    socket.data = { room: null, name: 'Soldado', budget: EVENTS_PER_SECOND, budgetAt: Date.now() };

    // Anti-spam: presupuesto de mensajes por segundo.
    socket.use((_packet, next) => {
      const d = socket.data;
      const now = Date.now();
      if (now - d.budgetAt >= 1000) {
        d.budget = EVENTS_PER_SECOND;
        d.budgetAt = now;
      }
      if (d.budget-- > 0) next();
    });

    // Latencia: el cliente manda ping { t } cada 2 s y mide el pong; con `rtt` informa la última medida.
    socket.on('ping', (data) => {
      const d = parse(pingSchema, data);
      if (!d) return;
      socket.emit('pong', { t: d.t, serverTime: Date.now() });
      if (d.rtt !== undefined) telemetry.recordLatency(d.rtt);
    });

    // --- Lobby ---
    socket.on('quick_join', (data) => {
      const info = parse(infoSchema, data);
      if (info) socket.data.name = info.name;
      leave(socket);
      const open = [...rooms.values()].find((r) => !r.isPrivate && r.players.length === 1);
      join(socket, open ?? createRoom());
    });

    socket.on('room:create', (data, ack = () => {}) => {
      const d = roomSchema.safeParse(data);
      if (!d.success) return ack({ ok: false, error: d.error.issues[0].message });
      if (privateByCode.has(d.data.code)) return ack({ ok: false, error: 'Esa sala ya existe' });
      socket.data.name = d.data.name || 'Soldado';
      leave(socket);
      const room = createRoom({ isPrivate: true, code: d.data.code, passwordHash: hashPassword(d.data.password) });
      join(socket, room);
      ack({ ok: true, code: room.code, protected: !!room.passwordHash });
    });

    socket.on('room:join', (data, ack = () => {}) => {
      const d = roomSchema.safeParse(data);
      if (!d.success) return ack({ ok: false, error: d.error.issues[0].message });
      const room = privateByCode.get(d.data.code);
      if (!room) return ack({ ok: false, error: 'La sala no existe' });
      if (room.full) return ack({ ok: false, error: 'La sala está llena' });
      if (!checkPassword(room.passwordHash, d.data.password)) return ack({ ok: false, error: 'Contraseña incorrecta' });
      socket.data.name = d.data.name || 'Soldado';
      leave(socket);
      join(socket, room);
      ack({ ok: true, code: room.code });
    });

    socket.on('room:ready', (data) => {
      const d = parse(readySchema, data);
      const room = socket.data.room;
      if (!d || !room || room.phase !== 'waiting') return;
      const start = room.setReady(socket.id, d.ready);
      io.to(room.id).emit('room:state', room.lobbyState());
      if (start) startMatch(room);
    });

    socket.on('room:leave', () => leave(socket));

    // --- Partida: todo se valida (esquema + reglas de la sala) antes de reenviarse ---
    const onGame = (evt, schema, handler) => socket.on(evt, (data) => {
      const room = socket.data.room;
      const d = parse(schema, data);
      if (room && d) handler(room, d);
    });

    onGame('player_move', moveSchema, (room, d) => {
      const verdict = room.onMove(socket.id, d);
      if (verdict === 'ok') socket.volatile.to(room.id).emit('player_move', d);
      // Dentro o a través de una pared: el servidor devuelve al jugador a su última posición válida.
      else if (verdict === 'correct') {
        const { x, y } = room.player(socket.id).pos;
        socket.emit('player_correct', { x, y });
      }
    });
    onGame('weapon_spawn', spawnSchema, (room, d) => {
      if (room.onSpawn(socket.id, d)) socket.to(room.id).emit('weapon_spawn', d);
      else socket.emit('weapon_spawn_denied', { id: d.id }); // el host la quita: no existe para el servidor
    });
    onGame('weapon_pickup', pickupSchema, (room, d) => {
      if (room.onPickup(socket.id, d)) socket.to(room.id).emit('weapon_pickup', d);
      else socket.emit('weapon_denied', d); // otro la recogió antes o no existe
    });
    onGame('player_shoot', shootSchema, (room, d) => {
      if (room.onShoot(socket.id, d)) socket.to(room.id).emit('player_shoot', d);
    });
    onGame('weapon_throw', throwSchema, (room, d) => {
      if (room.onThrow(socket.id, d)) socket.to(room.id).emit('weapon_throw', d);
    });
    onGame('player_hit', hitSchema, (room, d) => {
      const res = room.onHit(socket.id, d);
      if (res) io.to(res.victim.id).emit('player_hit', res.hit);
    });
    onGame('player_info', infoSchema, (room, d) => {
      const p = room.player(socket.id);
      if (p) p.name = d.name;
      socket.data.name = d.name;
      socket.to(room.id).emit('player_info', d);
    });
    onGame('player_taunt', tauntSchema, (room, d) => socket.to(room.id).emit('player_taunt', d));

    socket.on('disconnect', () => leave(socket));
  });

  return {
    app, httpServer, io, rooms, telemetry,
    listen(port = 0) {
      return new Promise((resolve) => httpServer.listen(port, () => resolve(httpServer.address().port)));
    },
    close() {
      for (const room of rooms.values()) room.stopMatch();
      io.close();
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export const DEFAULT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
