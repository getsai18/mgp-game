// Generador procedural de mapas: misma semilla = mismo mapa (en los dos clientes y en el servidor).
// Produce el mismo ASCII que los mapas hechos a mano (maps.js) y lo convierte con parse(), así que
// se dibuja, se ilumina y se juega igual. Reglas:
//   - simétrico (se genera la mitad izquierda y se refleja: duelo justo);
//   - suelo de bloques con huecos (se cae al agua / vacío) y 3-4 niveles de plataformas encima,
//     separados 4-6 filas (el salto llega a ~8);
//   - aparición en los niveles bajos, puntos de arma repartidos, pinchos y decorado del tema.
// Cada candidato se valida con el grafo del bot (systems/NavGraph.js), que SIMULA los saltos con la
// física del jugador: desde la aparición se llega al rival y a todas las armas, sin zonas trampa.
// Si no sale jugable se prueba con la siguiente semilla derivada.
import { MAPS, parse } from './maps.js';
import NavGraph from './systems/NavGraph.js';

const W = 90;
const H = 51;
const HALF = W / 2;
const MAX_TRIES = 80;
// Campos del tema ligados a la distribución de un mapa concreto (barandillas, letrero, suelo de UTEZ).
const LAYOUT_ONLY = ['railRows', 'sign', 'groundRow'];
// Decorado sin colisión que se puede poner en cualquier sitio ('|' y 'b' dependen de la estructura).
const FREE_DECOR = 'Tviopxkn';

// PRNG mulberry32: rápido y determinista (Math.random no se puede sembrar).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mixSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

// Mitad izquierda (columnas 0-44) como matriz de caracteres.
function layout(rnd, theme, decor) {
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const g = Array.from({ length: H }, () => Array(HALF).fill('.'));
  const free = (r, c) => r >= 0 && r < H && c >= 0 && c < HALF && g[r][c] === '.';
  const surfaces = []; // { r, c0, c1, solid }

  // --- Suelo: tramos de bloque (2 filas) separados por huecos; el último puede unirse al centro.
  const water = theme.death === 'water';
  const G = water ? int(41, 44) : int(40, 45); // en mapas de agua el suelo queda por encima de deathY (fila 47)
  const centerPit = rnd() < 0.35;
  for (let c = int(0, 4); c < HALF;) {
    let end = Math.min(HALF - 1, c + int(7, 16) - 1);
    if (centerPit && end > HALF - 3) end = HALF - int(2, 3) - 1;
    if (end - c >= 3) {
      for (let k = c; k <= end; k++) {
        g[G][k] = rnd() < 0.12 ? '%' : '#';
        g[G + 1][k] = '#';
      }
      surfaces.push({ r: G, c0: c, c1: end, solid: true });
    }
    c = end + 1 + int(3, 5);
    if (end >= HALF - 1) break;
  }

  // --- Niveles de plataformas.
  let row = G;
  const tiers = int(3, 4);
  for (let t = 0; t < tiers; t++) {
    const gap = int(4, 6);
    row -= gap;
    if (row < 12) break;
    const placed = [];
    const fits = (c0, c1) => placed.every(([a, b]) => c1 < a - 3 || c0 > b + 3);
    // Plataforma central (se une con su reflejo) en la mitad de los niveles.
    if (rnd() < 0.45) {
      const len = int(3, 8);
      placed.push([HALF - len, HALF - 1]);
    }
    for (let n = int(1, 3), tries = 0; n > 0 && tries < 20; tries++) {
      const len = int(4, 11);
      const c0 = int(1, HALF - len - 1);
      if (!fits(c0, c0 + len - 1)) continue;
      placed.push([c0, c0 + len - 1]);
      n--;
    }
    for (const [c0, c1] of placed) {
      // Bloque sólido (2 filas) solo si queda hueco para estar de pie debajo; si no, tablón atravesable.
      const solid = gap >= 5 && rnd() < 0.35;
      for (let k = c0; k <= c1; k++) {
        if (solid) {
          g[row][k] = rnd() < 0.15 ? '%' : '#';
          g[row + 1][k] = '#';
        } else g[row][k] = '-';
      }
      surfaces.push({ r: row, c0, c1, solid });
    }
  }

  // Casilla de pie sobre una superficie: 3 libres encima (cabe el jugador).
  const standable = (s, c) => c >= s.c0 && c <= s.c1 && free(s.r - 1, c) && free(s.r - 2, c) && free(s.r - 3, c);
  const pickCell = (list, cMin, cMax) => {
    for (let tries = 0; tries < 30; tries++) {
      const s = list[Math.floor(rnd() * list.length)];
      if (!s) return null;
      const lo = Math.max(s.c0 + 1, cMin);
      const hi = Math.min(s.c1 - 1, cMax);
      if (lo > hi) continue;
      const c = int(lo, hi);
      if (standable(s, c)) return { s, c };
    }
    return null;
  };

  // --- Aparición (A): en los niveles bajos, lejos del centro.
  const low = surfaces.filter((s) => s.r >= G - 11);
  const spawn = pickCell(low, 2, 28);
  if (!spawn) return null;
  g[spawn.s.r - 1][spawn.c] = 'A';

  // --- Armas: 2-3 por mitad en superficies distintas (y una en el centro si hay plataforma central).
  const others = surfaces.filter((s) => s !== spawn.s);
  for (let n = int(2, 3), tries = 0; n > 0 && tries < 40; tries++) {
    const cell = pickCell(others, 1, HALF - 2);
    if (!cell || Math.abs(cell.c - spawn.c) < 4 || g[cell.s.r - 1].slice(Math.max(0, cell.c - 3), cell.c + 4).includes('w')) continue;
    g[cell.s.r - 1][cell.c] = 'w';
    n--;
  }
  const center = surfaces.find((s) => s.c1 === HALF - 1 && standable(s, HALF - 1));
  if (center) g[center.r - 1][HALF - 1] = 'c';

  // --- Pinchos: a veces, sobre un tramo de suelo sin aparición ni armas.
  if (rnd() < 0.5) {
    const s = surfaces.find((x) => x.solid && x.r === G && x !== spawn.s && x.c1 - x.c0 >= 8);
    if (s) {
      const c0 = int(s.c0 + 2, s.c1 - 5);
      for (let k = c0; k < c0 + int(2, 4); k++) if (free(G - 1, k)) g[G - 1][k] = '^';
    }
  }

  // --- Decorado y lámparas del tema sobre los bloques.
  for (const s of surfaces.filter((x) => x.solid)) {
    for (let c = s.c0; c <= s.c1; c++) {
      if (!free(s.r - 1, c)) continue;
      const roll = rnd();
      if (roll < 0.03) g[s.r - 1][c] = 'i';
      else if (roll < 0.12 && decor.length) g[s.r - 1][c] = decor[Math.floor(rnd() * decor.length)];
    }
  }
  return g;
}

// Refleja la mitad izquierda: la columna c pasa a la 89 - c; la A del reflejo es la B.
function mirror(half) {
  return half.map((row) => {
    const right = [...row].reverse().map((ch) => (ch === 'A' ? 'B' : ch === 'c' ? '.' : ch));
    return row.join('') + right.join('');
  });
}

function playable(map) {
  if (!map.spawns[0] || !map.spawns[1] || map.weaponSpawns.length < 3) return false;
  const nav = NavGraph.for(map);
  if (nav.segs.some((s) => s.trap)) return false;
  const seg = (p, feet) => nav.standingSeg(p.x, p.y + feet);
  const a = seg(map.spawns[0], 20);
  const b = seg(map.spawns[1], 20);
  if (a === null || b === null) return false;
  const reach = nav.reachable(a);
  return reach.has(b) && map.weaponSpawns.every((w) => reach.has(seg(w, 8)));
}

const cache = new Map(); // "semilla:tema" -> mapa (pocos: se descartan los más antiguos)
const CACHE_MAX = 24;

// Mapa generado con la semilla `seed` y el estilo del mapa a mano MAPS[themeIndex].
export function generateMap(seed, themeIndex = 0) {
  const key = `${seed >>> 0}:${themeIndex}`;
  if (cache.has(key)) return cache.get(key);
  const base = MAPS[themeIndex % MAPS.length];
  const theme = Object.fromEntries(Object.entries(base.theme).filter(([k]) => !LAYOUT_ONLY.includes(k)));
  const decor = [...new Set(base.rows.join(''))].filter((ch) => FREE_DECOR.includes(ch));
  let map = null;
  for (let attempt = 0; attempt < MAX_TRIES && !map; attempt++) {
    const half = layout(rng(mixSeed(seed, attempt)), theme, decor);
    if (!half) continue;
    const candidate = parse({ name: `${base.name} #${(seed % 9000) + 1000}`, theme, rows: mirror(half) });
    if (playable(candidate)) map = Object.assign(candidate, { themeIndex: base.themeIndex, generated: true, seed: seed >>> 0 });
  }
  map ??= base; // (no ha pasado nunca en las pruebas: 80 intentos fallidos seguidos)
  cache.set(key, map);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return map;
}

// Mapa de cada ronda: impares, los hechos a mano en orden; pares, uno generado con la semilla de la
// partida (la manda el servidor en 'match_start') y el estilo de otro mapa. `matchNo` cuenta las
// revanchas en la misma sala para que cada partida tenga mapas nuevos. Sin semilla, solo a mano.
export function roundMap(round, seed = null, matchNo = 0) {
  const hand = MAPS[((round - 1) >> 1) % MAPS.length];
  if (round % 2 === 1 || seed === null || seed === undefined) return hand;
  return generateMap(mixSeed(seed, matchNo, round), ((round >> 1) + 2) % MAPS.length);
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);
