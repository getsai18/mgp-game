import { io } from 'socket.io-client';

// Mismo origen: en dev Vite hace proxy de /socket.io al relay, en prod lo sirve Node.
// Forzamos websocket para evitar el long-polling (menos carga en el servidor).
export const socket = io({ transports: ['websocket'] });

// El socket conecta antes de que exista la escena, así que guardamos el estado
// de la sala aquí para no perder 'joined' si llega antes que los handlers.
export const session = { roomId: null, playerIndex: 0, isHost: true, opponent: false };

socket.on('joined', (d) => Object.assign(session, d, { opponent: false }));
socket.on('match_start', () => (session.opponent = true));
socket.on('opponent_left', ({ isHost }) => Object.assign(session, { isHost, opponent: false }));
