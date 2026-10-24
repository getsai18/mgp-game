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
// Márgenes: `shrink` px perdona el redondeo y lo que se hunde el cuerpo al aterrizar rápido; el barrido usa un núcleo más pequeño porque la
// trayectoria real es curva (salto) y la recta entre dos paquetes puede rozar una esquina.
const SHRINK = 3;
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

// --------------------------------------------------------------- vuelo
// El servidor no simula la física, pero sí acota la altura: sin apoyo, un cuerpo solo sube lo que le da
// el último salto o impulso legal y luego tiene que caer (gravedad de client/src/main.js, caída máxima
// de client/src/movement.js). Se usa la gravedad del mundo sin la extra de caída: el límite es holgado.
const GRAVITY = 1400;
const SUPPORT_GAP = 3; // px entre el cuerpo y el suelo / la pared que cuentan como "apoyado"
// s de margen por jitter de red: los paquetes llegan con retraso variable y a veces en ráfaga (varios a
// la vez), así que el tiempo entre dos llegadas puede ser mayor o menor que el real entre los envíos.
const RISE_TIME_SLACK = 0.25;
const RISE_SLACK = 24; // px de margen (redondeo, estiramiento del sprite, coyote time)

// ¿Pisa suelo o plataforma, o está pegado a una pared (o al borde del mundo)? Desde ahí puede saltar.
export function supported(map, x, y) {
  const b = bodyRect(x, y);
  const row = map.rows[Math.floor((b.b + SUPPORT_GAP) / TILE)];
  const floor = (px) => {
    const ch = row?.[Math.floor(px / TILE)];
    return ch === '#' || ch === '%' || ch === '-';
  };
  if (floor(b.l + 1) || floor(x) || floor(b.r - 1)) return true;
  if (b.l - SUPPORT_GAP <= 0 || b.r + SUPPORT_GAP >= map.width) return true;
  return [b.t + 4, (b.t + b.b) / 2, b.b - 4].some((py) => solidAt(map, b.l - SUPPORT_GAP, py) || solidAt(map, b.r + SUPPORT_GAP, py));
}

// Altura (px) ganada a los t s de salir hacia arriba a v0 px/s, con la caída limitada a maxFall.
function heightAt(v0, t, maxFall) {
  const tc = (v0 + maxFall) / GRAVITY; // instante en que alcanza la caída máxima
  if (t <= tc) return v0 * t - (GRAVITY * t * t) / 2;
  return v0 * tc - (GRAVITY * tc * tc) / 2 - maxFall * (t - tc);
}

// Lo más alto que puede estar a los t s (± RISE_TIME_SLACK): negativo = ya tiene que haber bajado.
export function maxRise(v0, t, maxFall) {
  const lo = Math.max(0, t - RISE_TIME_SLACK);
  const apex = Math.min(Math.max(v0 / GRAVITY, lo), t + RISE_TIME_SLACK);
  return heightAt(v0, apex, maxFall);
}

// launch = { y, at, v0 }: último apoyo o impulso. ¿La posición y (a `now` ms) está más alta de lo posible?
export function flying(launch, y, now, maxFall) {
  return launch.y - y > maxRise(launch.v0, (now - launch.at) / 1000, maxFall) + RISE_SLACK;
}
