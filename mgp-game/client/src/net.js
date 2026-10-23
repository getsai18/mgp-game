import { io } from 'socket.io-client';

// Mismo origen: en dev Vite hace proxy de /socket.io al relay, en prod lo sirve Node.
// Forzamos websocket para evitar el long-polling (menos carga en el servidor).
// No conecta al cargar: lo hace la pantalla de título al pulsar "Jugar online".
export const socket = io({ transports: ['websocket'], autoConnect: false });

// El socket conecta antes de que exista la escena, así que guardamos el estado
// de la sala aquí para no perder 'joined' si llega antes que los handlers.
export const session = { roomId: null, playerIndex: 0, isHost: true, opponent: false, name: 'Soldado', opponentName: null };

socket.on('joined', (d) => Object.assign(session, d, { opponent: false }));
socket.on('match_start', () => {
  session.opponent = true;
  socket.emit('player_info', { name: session.name });
});
socket.on('opponent_left', ({ isHost }) => Object.assign(session, { isHost, opponent: false, opponentName: null }));
socket.on('player_info', (d) => {
  if (d && typeof d.name === 'string') session.opponentName = d.name.slice(0, 12);
});

// Envía un evento al rival solo si hay conexión y rival: sin conexión socket.io guardaría
// los mensajes en un buffer y los soltaría todos de golpe al reconectar.
export function send(evt, data) {
  if (socket.connected && session.opponent) socket.emit(evt, data);
}

// Volver al menú: salir de la sala y olvidar el estado.
export function leaveRoom() {
  socket.disconnect();
  Object.assign(session, { roomId: null, playerIndex: 0, isHost: true, opponent: false, opponentName: null });
}
