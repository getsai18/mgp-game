import { io } from 'socket.io-client';

// Mismo origen: en dev Vite hace proxy de /socket.io al servidor, en prod lo sirve Node.
// Forzamos websocket para evitar el long-polling (menos carga en el servidor).
// No conecta al cargar: lo hace la pantalla de título (partida rápida) o el lobby (salas privadas).
export const socket = io({ transports: ['websocket'], autoConnect: false });

// El socket conecta antes de que exista la escena, así que guardamos el estado
// de la sala aquí para no perder 'joined' si llega antes que los handlers.
// latency: última ida y vuelta ping -> pong medida (ms).
export const session = {
  roomId: null, playerIndex: 0, isHost: true, opponent: false, name: 'Soldado', opponentName: null,
  code: null, private: false, quick: false, latency: null,
};

socket.on('joined', (d) => Object.assign(session, d, { opponent: false }));
socket.on('match_start', () => {
  session.opponent = true;
  socket.emit('player_info', { name: session.name });
});
socket.on('opponent_left', ({ isHost }) => Object.assign(session, { isHost, opponent: false, opponentName: null }));
socket.on('player_info', (d) => {
  if (d && typeof d.name === 'string') session.opponentName = d.name.slice(0, 12);
});
// Partida rápida: al (re)conectar se vuelve a pedir sala.
socket.on('connect', () => session.quick && socket.emit('quick_join', { name: session.name }));

// --- Latencia: ping cada 2 s; el servidor responde pong con el mismo t ---
const PING_EVERY_MS = 2000;
setInterval(() => {
  if (socket.connected) socket.emit('ping', { t: performance.now(), ...(session.latency !== null && { rtt: session.latency }) });
}, PING_EVERY_MS);
socket.on('pong', (d) => {
  if (typeof d?.t === 'number') session.latency = Math.round(performance.now() - d.t);
});

// Envía un evento al rival solo si hay conexión y rival: sin conexión socket.io guardaría
// los mensajes en un buffer y los soltaría todos de golpe al reconectar.
export function send(evt, data) {
  if (socket.connected && session.opponent) socket.emit(evt, data);
}

// Partida rápida: el servidor empareja con el primero que esté esperando.
export function quickMatch() {
  session.quick = true;
  if (socket.connected) socket.emit('quick_join', { name: session.name });
  else socket.connect(); // al conectar, 'connect' pide sala
}

// Salas privadas (lobby). Devuelven la respuesta del servidor: { ok, error?, code? }.
function request(evt, data) {
  session.quick = false;
  if (!socket.connected) socket.connect();
  return new Promise((resolve) => {
    socket.timeout(5000).emit(evt, data, (err, res) => resolve(err ? { ok: false, error: 'Sin respuesta del servidor' } : res));
  });
}
export const createRoom = (code, password) => request('room:create', { code, password, name: session.name });
export const joinRoom = (code, password) => request('room:join', { code, password, name: session.name });
export const setReady = (ready) => socket.emit('room:ready', { ready });

// Volver al menú: salir de la sala y olvidar el estado.
export function leaveRoom() {
  session.quick = false;
  socket.disconnect();
  Object.assign(session, { roomId: null, playerIndex: 0, isHost: true, opponent: false, opponentName: null, code: null, private: false });
}
