import { TILE } from '../client/src/level.js';
import { SKIN_H, BODY_OFFSET } from '../client/src/skins.js';

// Geometría del mapa en el servidor (sin Phaser): con ella el servidor decide por su cuenta
// colisiones con paredes, muertes por agua / vacío / pinchos y línea de visión de los disparos.
// Mismo cuerpo que el cliente (skins.js): 14x36. (x, y) es el centro del sprite con escala 1, anclado a
// los pies del cuerpo físico (lo que manda client/src/netState.js): pies = y + FEET_Y.
const BODY_W = 14;
const BODY_H = 36;
const BODY_TOP = BODY_OFFSET.y - SKIN_H / 2; // del centro del sprite al borde superior del cuerpo

export function bodyRect(x, y) {
  const t = y + BODY_TOP;
  return { l: x - BODY_W / 2, r: x + BODY_W / 2, t, b: t + BODY_H };
}

// Al saltar y aterrizar el sprite se estira y aplasta (escala 0.8-1.2) y el cuerpo físico con él (los
// pies no se mueven). Para las paredes se usa el núcleo que queda dentro del cuerpo con cualquiera de
// esas escalas, recortado `shrink` px más.
const FEET = BODY_TOP + BODY_H;
const CORE = { halfW: (BODY_W / 2) * 0.8, top: FEET - BODY_H * 0.8, bottom: FEET };
function coreRect(x, y, shrink) {
  return { l: x - CORE.halfW + shrink, r: x + CORE.halfW - shrink, t: y + CORE.top + shrink, b: y + CORE.bottom - shrink };
}

export function solidAt(map, px, py) {
  const row = map.rows[Math.floor(py / TILE)];
  const ch = row?.[Math.floor(px / TILE)];
  return ch === '#' || ch === '%';
}

// ¿El rectángulo pisa alguna casilla sólida?
export function rectInSolid(map, { l, r, t, b }) {
  for (let row = Math.floor(t / TILE); row <= Math.floor((b - 0.01) / TILE); row++) {
    for (let col = Math.floor(l / TILE); col <= Math.floor((r - 0.01) / TILE); col++) {
      if (solidAt(map, col * TILE, row * TILE)) return true;
    }
  }
  return false;
}

// Puntos cada `step` px de (x0, y0) a (x1, y1), los dos extremos incluidos.
function* along(x0, y0, x1, y1, step) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
  for (let i = 0; i <= n; i++) yield [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n];
}

// Posición imposible: el cuerpo está dentro de una pared, o la atravesó yendo rápido.
// Márgenes: `shrink` px perdona el redondeo; el barrido usa un núcleo más pequeño porque la
// trayectoria real es curva (salto) y la recta entre dos paquetes puede rozar una esquina.
const SHRINK = 1;
const SWEEP_SHRINK = 4;
const SWEEP_MIN_DIST = 40;
export function illegalMove(map, from, x, y) {
  if (rectInSolid(map, coreRect(x, y, SHRINK))) return true;
  if (!from || Math.hypot(x - from.x, y - from.y) < SWEEP_MIN_DIST) return false;
  for (const [px, py] of along(from.x, from.y, x, y, 6)) {
    if (rectInSolid(map, coreRect(px, py, SWEEP_SHRINK))) return true;
  }
  return false;
}

// Pinchos con 2 px de margen: la posición viaja redondeada a px enteros.
const SPIKE_SLACK = 2;
const overlaps = (a, s) => a.l < s.x + s.w + SPIKE_SLACK && a.r > s.x - SPIKE_SLACK && a.t < s.y + s.h + SPIKE_SLACK && a.b > s.y - SPIKE_SLACK;
// El cliente muere cuando sus pies pasan deathY + 6 (y manda ese paquete en el acto); 2 px por redondeo.
const DEATH_LINE = 6 - 2;

// Muerte por el entorno en el tramo (from -> to): 'water' | 'void' | 'spikes' | null.
// Se barre el tramo para no perder el contacto con los pinchos entre dos paquetes.
export function environmentDeath(map, from, to) {
  const start = from ?? to;
  for (const [px, py] of along(start.x, start.y, to.x, to.y, 4)) {
    const body = bodyRect(px, py);
    if (body.b > map.deathY + DEATH_LINE) return map.theme.death;
    if (map.spikes.some((s) => overlaps(body, s))) return 'spikes';
  }
  return null;
}

// ¿Hay paredes entre los dos puntos? (Las plataformas finas no tapan.)
export function lineOfSight(map, x0, y0, x1, y1) {
  for (const [px, py] of along(x0, y0, x1, y1, 4)) {
    if (solidAt(map, px, py)) return false;
  }
  return true;
}

// Distancia de (px, py) al rayo que sale de (x, y) con ángulo `deg`: { along, perp }.
export function rayDistance(x, y, deg, px, py) {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const ax = px - x;
  const ay = py - y;
  return { along: ax * dx + ay * dy, perp: Math.abs(ax * dy - ay * dx) };
}
