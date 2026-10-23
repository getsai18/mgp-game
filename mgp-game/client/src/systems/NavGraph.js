import { TILE } from '../level.js';
import { MOVE } from '../entities/Player.js';

// Grafo de navegación de un mapa para el bot (se calcula una vez por mapa y se guarda en caché).
//  - Nodo: casilla donde cabe un jugador de pie (3 casillas libres) sobre suelo, sin pinchos
//    y por encima de la zona de muerte.
//  - Tramo: nodos contiguos en la misma fila (se camina libremente por él).
//  - Aristas entre tramos: 'walk' (salir caminando por un borde y caer), 'jump' (saltar) y
//    'drop' (S+salto para atravesar un tablón). Cada arista se valida SIMULANDO el movimiento
//    con la misma física que el jugador (cuerpo completo, techos, pinchos, zona de muerte):
//    solo se guarda si el bot aterriza de verdad en el tramo destino.
//  - goalX: punto (px) al que el bot dirige el control aéreo durante el movimiento.
const GRAVITY = 1400; // gravedad del mundo (main.js)
const DT = 1 / 60;
const HALF_W = 7; // cuerpo del jugador: 14 x 36, pies en y + 20
const BODY_H = 36;
export const JUMP_HOLD_MS = 420; // el bot mantiene el salto este tiempo: salto completo
const MAX_SIM_STEPS = 240;
const LAUNCH_JITTER = [0, -4, 4]; // el bot no despega exactamente en el centro de la casilla
const MAX_JUMP_TRIES = 12;

const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// Dirección (-1/0/1) para llegar a goalX sin pasarse: frena cuando la distancia de frenado alcanza al objetivo.
export function steerDir(x, vx, goalX, decel, tol = 3) {
  const dx = goalX - x;
  if (Math.abs(dx) <= tol) return Math.abs(vx) > 40 ? -Math.sign(vx) : 0;
  if (Math.sign(vx) === Math.sign(dx) && (vx * vx) / (2 * decel) >= Math.abs(dx)) return -Math.sign(vx);
  return Math.sign(dx);
}

const cache = new WeakMap();

export default class NavGraph {
  static for(map) {
    let nav = cache.get(map);
    if (!nav) cache.set(map, (nav = new NavGraph(map)));
    return nav;
  }

  constructor(map) {
    this.rows = map.rows;
    this.H = map.rows.length;
    this.W = map.rows[0].length;
    this.deathY = map.deathY;
    this.deathRow = Math.floor(map.deathY / TILE);
    this.build();
  }

  at(r, c) {
    return r >= 0 && r < this.H && c >= 0 && c < this.W ? this.rows[r][c] : r < 0 ? '.' : 'X';
  }
  solid(r, c) {
    const t = this.at(r, c);
    return t === '#' || t === '%';
  }
  surface(r, c) {
    const t = this.at(r, c);
    return t === '#' || t === '%' || t === '-';
  }
  isNode(r, c) {
    if (r + 1 >= this.deathRow || !this.surface(r + 1, c)) return false;
    for (let k = 0; k < 3; k++) if (this.solid(r - k, c) || this.at(r - k, c) === '^') return false;
    return true;
  }

  build() {
    this.segs = [];
    this.segAt = new Map(); // "r,c" -> índice de tramo
    for (let r = 0; r < this.H; r++) {
      for (let c = 0; c < this.W; c++) {
        if (!this.isNode(r, c)) continue;
        let c2 = c;
        while (c2 + 1 < this.W && this.isNode(r, c2 + 1)) c2++;
        const i = this.segs.length;
        this.segs.push({ i, r, c0: c, c1: c2, oneWay: this.at(r + 1, c) === '-' && this.at(r + 1, c2) === '-', edges: [] });
        for (let k = c; k <= c2; k++) this.segAt.set(`${r},${k}`, i);
        c = c2;
      }
    }
    for (const a of this.segs) {
      this.addWalkEdges(a);
      this.addDropEdge(a);
    }
    for (const a of this.segs) for (const b of this.segs) if (a !== b) this.addJumpEdge(a, b);
    this.markTraps();
  }

  // Trampa: tramo desde el que no se puede volver al resto del mapa (p. ej. un foso con techo).
  // El bot no entra en ellos a por armas, solo persiguiendo al jugador.
  markTraps() {
    const reach = this.segs.map((s) => {
      const seen = new Set([s.i]);
      const queue = [s.i];
      while (queue.length) for (const e of this.segs[queue.shift()].edges) if (!seen.has(e.to)) seen.add(e.to), queue.push(e.to);
      return seen.size;
    });
    const most = Math.max(...reach);
    this.segs.forEach((s, i) => (s.trap = reach[i] < most));
  }

  // Columna de aterrizaje preferida en b: la más cercana a `col`, sin pegarse a los bordes del tramo.
  goalCol(b, col) {
    const lo = b.c1 - b.c0 >= 2 ? b.c0 + 1 : b.c0;
    const hi = b.c1 - b.c0 >= 2 ? b.c1 - 1 : b.c1;
    return Math.min(Math.max(col, lo), hi);
  }

  hasEdgeTo(a, to) {
    return a.edges.some((e) => e.to === to);
  }

  // Salir caminando por cada borde, con el control aéreo apuntando a cada tramo de abajo.
  addWalkEdges(a) {
    for (const dir of [-1, 1]) {
      const edgeCol = dir < 0 ? a.c0 - 1 : a.c1 + 1;
      if (edgeCol < 0 || edgeCol >= this.W || this.solid(a.r, edgeCol) || this.solid(a.r - 1, edgeCol)) continue;
      // Punto donde el cuerpo ya no pisa el borde (con margen: el "squash" al aterrizar lo ensancha).
      // Si no cabe antes del límite del mundo, por ese lado no se puede salir.
      const startX = dir < 0 ? a.c0 * TILE - HALF_W - 2 : (a.c1 + 1) * TILE + HALF_W + 2;
      if (startX < HALF_W + 2 || startX > this.W * TILE - HALF_W - 2) continue;
      const feet = (a.r + 1) * TILE;
      const targets = this.segs.filter((b) => b.r > a.r).sort((p, q) => this.colDist(p, edgeCol) - this.colDist(q, edgeCol));
      for (const b of targets) {
        if (this.hasEdgeTo(a, b.i)) continue;
        const goalX = this.goalCol(b, edgeCol) * TILE + TILE / 2;
        // A toda velocidad y a media velocidad (si arranca pegado al borde): ambos deben llegar.
        const ok = [MOVE.maxSpeed, MOVE.maxSpeed / 2].every((v) => this.simulate({ x: startX, feet, vx: dir * v, vy: 0 }, goalX) === b.i);
        if (ok) a.edges.push({ type: 'walk', to: b.i, launch: dir < 0 ? a.c0 : a.c1, dir, goalX });
      }
    }
  }

  // Atravesar un tablón (S+salto) desde el centro del tramo.
  addDropEdge(a) {
    if (!a.oneWay) return;
    const mid = Math.floor((a.c0 + a.c1) / 2);
    const x = mid * TILE + TILE / 2;
    const targets = this.segs.filter((b) => b.r > a.r).sort((p, q) => this.colDist(p, mid) - this.colDist(q, mid));
    for (const b of targets) {
      if (this.hasEdgeTo(a, b.i)) continue;
      const goalX = this.goalCol(b, mid) * TILE + TILE / 2;
      if (this.simulate({ x, feet: (a.r + 1) * TILE, vx: 0, vy: 0, dropMs: MOVE.dropThroughMs }, goalX) === b.i) {
        a.edges.push({ type: 'drop', to: b.i, launch: mid, dir: 0, goalX });
        return; // una sola caída por tablón: la más directa
      }
    }
  }

  colDist(seg, col) {
    return col < seg.c0 ? seg.c0 - col : col > seg.c1 ? col - seg.c1 : 0;
  }

  addJumpEdge(a, b) {
    if (this.hasEdgeTo(a, b.i)) return; // caminando o cayendo ya se llega
    const up = a.r - b.r; // > 0: b está más arriba
    if (up > 9) return;
    const reach = up > 0 ? 12 : 14 + Math.floor(-up / 2);
    if (Math.max(b.c0 - a.c1, a.c0 - b.c1) > reach) return;
    const pairs = [];
    for (let la = a.c0; la <= a.c1; la++) {
      // Subiendo: no se despega debajo de un bloque sólido.
      if (up > 0 && la >= b.c0 && la <= b.c1 && !b.oneWay) continue;
      for (let lb = b.c0; lb <= b.c1; lb++) {
        // Bajando: hay que aterrizar fuera del propio tramo (si no, el suelo de a lo impide).
        if (up <= 0 && lb >= a.c0 && lb <= a.c1) continue;
        const edgePenalty = lb === b.c0 || lb === b.c1 ? 2 : 0; // mejor no aterrizar en el borde
        pairs.push({ la, lb, cost: Math.abs(lb - la) + edgePenalty });
      }
    }
    pairs.sort((p, q) => p.cost - q.cost);
    const feet = (a.r + 1) * TILE;
    for (const { la, lb } of pairs.slice(0, MAX_JUMP_TRIES)) {
      const goalX = lb * TILE + TILE / 2;
      const ok = LAUNCH_JITTER.every((dx) =>
        this.simulate({ x: la * TILE + TILE / 2 + dx, feet, vx: 0, vy: -MOVE.jumpVelocity, holdMs: JUMP_HOLD_MS }, goalX) === b.i);
      if (ok) {
        a.edges.push({ type: 'jump', to: b.i, launch: la, land: lb, dir: Math.sign(lb - la), goalX });
        return;
      }
    }
  }

  // ------------------------------------------------------------- simulación
  boxHits(x, feet, test) {
    const c0 = Math.floor((x - HALF_W) / TILE);
    const c1 = Math.floor((x + HALF_W - 0.01) / TILE);
    const r0 = Math.floor((feet - BODY_H) / TILE);
    const r1 = Math.floor((feet - 0.01) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (test(r, c)) return true;
    return false;
  }

  // Pinchos: solo mata la mitad inferior de la casilla (maps.js).
  touchesSpikes(x, feet) {
    return this.boxHits(x, feet, (r, c) => this.at(r, c) === '^' && feet > r * TILE + TILE / 2);
  }

  // Simula el vuelo del jugador desde `s` ({ x, feet, vx, vy, holdMs?, dropMs? }) dirigiendo el control
  // aéreo hacia goalX como hace el bot. Devuelve el tramo donde aterriza, o null si muere / no aterriza.
  simulate(s, goalX) {
    let { x, feet, vx, vy } = s;
    let holdMs = s.holdMs ?? 0;
    let dropMs = s.dropMs ?? 0;
    let jumping = vy < 0 && holdMs > 0;
    const maxX = this.W * TILE - HALF_W;
    for (let step = 0; step < MAX_SIM_STEPS; step++) {
      // Horizontal (como Player.update en el aire).
      const dir = steerDir(x, vx, goalX, MOVE.airAccel);
      const overSpeed = Math.sign(vx) === dir && Math.abs(vx) > MOVE.maxSpeed;
      if (dir !== 0 && !overSpeed) vx = approach(vx, dir * MOVE.maxSpeed, MOVE.airAccel * DT);
      else vx = approach(vx, dir * MOVE.maxSpeed * (overSpeed ? 1 : 0), MOVE.airDrag * DT);
      x += vx * DT;
      if (x < HALF_W || x > maxX) {
        x = Math.min(Math.max(x, HALF_W), maxX);
        vx = 0;
      }
      if (this.boxHits(x, feet, (r, c) => this.solid(r, c))) {
        x = vx > 0 ? Math.floor((x + HALF_W) / TILE) * TILE - HALF_W - 0.01 : (Math.floor((x - HALF_W) / TILE) + 1) * TILE + HALF_W + 0.01;
        vx = 0;
      }

      // Vertical: salto variable, gravedad extra al caer.
      holdMs -= DT * 1000;
      dropMs -= DT * 1000;
      if (jumping && holdMs <= 0 && vy < 0) {
        vy *= MOVE.jumpCut;
        jumping = false;
      }
      if (vy >= 0) jumping = false;
      vy = Math.min(vy + (GRAVITY + (vy > 0 ? MOVE.fallGravity : 0)) * DT, MOVE.maxFall);
      const prevFeet = feet;
      feet += vy * DT;
      if (vy < 0) {
        if (this.boxHits(x, feet, (r, c) => this.solid(r, c))) {
          feet = (Math.floor((feet - BODY_H) / TILE) + 1) * TILE + BODY_H; // cabezazo
          vy = 0;
        }
      } else {
        const r = this.landingRow(x, prevFeet, feet, dropMs > 0);
        if (r !== null) return this.standingSeg(x, r * TILE);
      }

      if (feet > this.deathY + 6 || this.touchesSpikes(x, feet)) return null;
    }
    return null;
  }

  // Fila de la superficie sobre la que caen los pies entre prevFeet y feet (o null).
  landingRow(x, prevFeet, feet, dropping) {
    const c0 = Math.floor((x - HALF_W) / TILE);
    const c1 = Math.floor((x + HALF_W - 0.01) / TILE);
    for (let r = Math.floor(prevFeet / TILE); r * TILE <= feet; r++) {
      if (r * TILE < prevFeet - 0.01) continue;
      for (let c = c0; c <= c1; c++) {
        if (this.solid(r, c) || (!dropping && this.at(r, c) === '-')) return r;
      }
    }
    return null;
  }

  // Tramo sobre el que se está de pie (pies en feetY sobre una superficie): prueba el centro y los dos pies.
  standingSeg(x, feetY) {
    const r = Math.round(feetY / TILE) - 1;
    for (const px of [x, x - 6, x + 6]) {
      const seg = this.segAt.get(`${r},${Math.floor(px / TILE)}`);
      if (seg !== undefined) return seg;
    }
    return null;
  }

  // De pie fuera de un tramo (en una esquina, contra la pared): centro de la columna de tramo más cercana.
  nearestSegX(x, feetY, maxCols = 3) {
    const r = Math.round(feetY / TILE) - 1;
    const c = Math.floor(x / TILE);
    for (let k = 1; k <= maxCols; k++) {
      for (const cc of [c - k, c + k]) if (this.segAt.has(`${r},${cc}`)) return cc * TILE + TILE / 2;
    }
    return null;
  }

  // Tramo bajo una posición del mundo (pies en `feetY`). Si está en el aire, el primero debajo.
  segmentAt(x, feetY) {
    const c = Math.floor(x / TILE);
    for (let r = Math.floor(feetY / TILE) - 1; r < this.deathRow; r++) {
      const seg = this.segAt.get(`${r},${c}`);
      if (seg !== undefined) return seg;
      if (this.solid(r, c) || this.at(r, c) === '^') return null;
    }
    return null;
  }

  // Tramos alcanzables desde `from` (incluido).
  reachable(from, usable = () => true) {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      for (const e of this.segs[queue.shift()].edges) {
        if (!seen.has(e.to) && usable(e)) seen.add(e.to), queue.push(e.to);
      }
    }
    return seen;
  }

  // Ruta (BFS) de tramo en tramo: devuelve la primera arista a ejecutar o null.
  // `usable(e)` permite al bot descartar aristas que le han fallado.
  nextEdge(from, to, usable = () => true) {
    if (from === null || to === null || from === to) return null;
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const s = queue.shift();
      if (s === to) break;
      for (const e of this.segs[s].edges) {
        if (prev.has(e.to) || !usable(e)) continue;
        prev.set(e.to, { s, e });
        queue.push(e.to);
      }
    }
    if (!prev.has(to)) return null;
    let step = prev.get(to);
    while (step && step.s !== from) step = prev.get(step.s);
    return step?.e ?? null;
  }
}
