// Relay ultra ligero: sin física, sin estado de juego.
// Solo empareja jugadores en salas de 2 y reenvía eventos al rival.
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = process.env.PORT || 3000;
const RELAY_EVENTS = [
  'player_shoot', 'weapon_spawn', 'weapon_pickup', 'player_hit', 'round_end',
  'player_info', 'player_taunt', 'weapon_throw',
];
// Estado de posición: si el socket está saturado se descarta (llega otro en 50 ms).
const VOLATILE_EVENTS = ['player_move'];

const app = express();
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(distDir));
app.get('/health', (_req, res) => res.send('ok'));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  maxHttpBufferSize: 1e4, // los eventos son diminutos; cortamos payloads abusivos
  cors: { origin: '*' },
});

// roomId -> [{ id, index }] (máx 2). El primero del array es el host.
const rooms = new Map();
let nextRoomId = 1;

function findOrCreateRoom() {
  for (const [id, members] of rooms) {
    if (members.length === 1) return id;
  }
  const id = `room-${nextRoomId++}`;
  rooms.set(id, []);
  return id;
}

io.on('connection', (socket) => {
  const roomId = findOrCreateRoom();
  const members = rooms.get(roomId);
  // Índice libre (0 o 1): define color y punto de aparición en el cliente.
  const playerIndex = members.some((m) => m.index === 0) ? 1 : 0;
  members.push({ id: socket.id, index: playerIndex });
  socket.join(roomId);

  const isHost = members.length === 1;
  socket.emit('joined', { roomId, playerIndex, isHost });
  console.log(`[${roomId}] ${socket.id} entró como jugador ${playerIndex + 1} (${members.length}/2)`);

  if (members.length === 2) io.to(roomId).emit('match_start');

  for (const evt of RELAY_EVENTS) {
    socket.on(evt, (data) => socket.to(roomId).emit(evt, data));
  }
  for (const evt of VOLATILE_EVENTS) {
    socket.on(evt, (data) => socket.volatile.to(roomId).emit(evt, data));
  }

  socket.on('disconnect', () => {
    const left = rooms.get(roomId).filter((m) => m.id !== socket.id);
    console.log(`[${roomId}] ${socket.id} salió`);
    if (left.length === 0) {
      rooms.delete(roomId);
      return;
    }
    rooms.set(roomId, left);
    // El que queda pasa a ser host y espera a un nuevo rival.
    io.to(left[0].id).emit('opponent_left', { isHost: true });
  });
});

httpServer.listen(PORT, () => console.log(`Relay escuchando en :${PORT}`));
