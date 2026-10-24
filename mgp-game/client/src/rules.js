// Reglas de la partida compartidas por cliente y servidor (el servidor arbitra con ellas).
export const WINS_TO_MATCH = 5;
export const DRAW_WINDOW_MS = 250; // dos muertes dentro de esta ventana = empate
// Entre rondas: cartel (~1 s) -> repetición de la jugada (~2.7 s a x0.6) -> siguiente ronda.
// Fin de partida: igual y luego el cartel de campeón.
export const BANNER_MS = 950;
export const REPLAY_AT_MS = 1000;
export const REPLAY_FROM_AGO_MS = 2300; // tramo grabado: de 2.3 s antes a 0.7 s antes del inicio de la repetición
export const REPLAY_TO_AGO_MS = 700;
export const REPLAY_SPEED = 0.6;
export const REPLAY_END_MS = REPLAY_AT_MS + (REPLAY_FROM_AGO_MS - REPLAY_TO_AGO_MS) / REPLAY_SPEED;
export const NEXT_ROUND_MS = Math.round(REPLAY_END_MS + 350);
export const NEXT_MATCH_MS = Math.round(REPLAY_END_MS + 3600);
