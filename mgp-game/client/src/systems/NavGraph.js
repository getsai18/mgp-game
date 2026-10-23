import { TILE } from '../level.js';

// Grafo de navegación de un mapa para el bot (se calcula una vez por mapa, en el navegador).
//  - Nodo: casilla donde cabe un jugador de pie (3 casillas libres) sobre suelo, sin pinchos
//    y por encima de la zona de muerte.
//  - Tramo: nodos contiguos en la misma fila (se camina libremente por él).
//  - Aristas entre tramos: 'walk' (salir caminando por un borde y caer), 'jump' (saltar a otro tramo
//    al alcance del salto real: ~8 casillas de altura máx.) y 'drop' (S+salto para atravesar un tablón).
const MAX_UP = 7; // casillas que se pueden subir saltando (salto completo ~8.5)

export default class NavGraph {
  constructor(map) {
    this.rows = map.rows;
    this.H = map.rows.length;
    this.W = map.rows[0].length;
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
      this.addFallEdges(a);
      for (const b of this.segs) if (a !== b) this.addJumpEdge(a, b);
    }
  }

  // Cayendo en vertical por la columna c desde la fila r: ¿en qué tramo se aterriza?
  landingFrom(r, c) {
    for (let rr = r; rr < this.deathRow; rr++) {
      if (this.solid(rr, c)) return null;
      const seg = this.segAt.get(`${rr},${c}`);
      if (seg !== undefined) return seg;
      if (this.at(rr, c) === '^') return null;
    }
    return null;
  }

  addFallEdges(a) {
    for (const [edgeCol, dir] of [[a.c0 - 1, -1], [a.c1 + 1, 1]]) {
      if (edgeCol < 0 || edgeCol >= this.W) continue;
      if (this.solid(a.r, edgeCol) || this.solid(a.r - 1, edgeCol)) continue; // pared
      const to = this.landingFrom(a.r, edgeCol);
      if (to !== undefined && to !== null && to !== a.i) a.edges.push({ type: 'walk', to, launch: dir < 0 ? a.c0 : a.c1, dir, land: edgeCol });
    }
    if (a.oneWay) {
      const mid = Math.floor((a.c0 + a.c1) / 2);
      const to = this.landingFrom(a.r + 1, mid);
      if (to !== null && to !== undefined && to !== a.i) a.edges.push({ type: 'drop', to, launch: mid, dir: 0, land: mid });
    }
  }

  // ¿Libre la columna c entre las filas r1..r2 (para que no choque la cabeza al saltar)?
  clearColumn(c, rTop, rBottom) {
    for (let r = rTop; r <= rBottom; r++) if (this.solid(r, c)) return false;
    return true;
  }

  addJumpEdge(a, b) {
    const up = a.r - b.r; // > 0: b está más arriba
    if (up > MAX_UP) return;
    // Saltar a algo más bajo solo si caminando no se llega igual (evita aristas redundantes).
    if (up <= 0 && a.edges.some((e) => e.to === b.i)) return;
    const maxGap = up > 0 ? 11 - up : 11 + Math.floor(-up / 2);
    let best = null;
    for (let la = a.c0; la <= a.c1; la++) {
      // Subiendo: no se despega debajo de un bloque sólido, y hace falta hueco hasta la altura de b.
      if (up > 0 && la >= b.c0 && la <= b.c1 && !b.oneWay) continue;
      if (up > 0 && !this.clearColumn(la, b.r - 2, a.r - 3)) continue;
      for (let lb = b.c0; lb <= b.c1; lb++) {
        // Bajando: hay que aterrizar fuera del propio tramo (si no, el suelo de a lo impide).
        if (up <= 0 && lb >= a.c0 && lb <= a.c1) continue;
        const gap = Math.abs(lb - la);
        if (gap > maxGap || (best && gap >= best.gap)) continue;
        if (!this.clearColumn(lb, b.r - 2, b.r)) continue; // espacio para el cuerpo al aterrizar
        best = { gap, la, lb };
      }
    }
    if (best) a.edges.push({ type: 'jump', to: b.i, launch: best.la, land: best.lb, dir: Math.sign(best.lb - best.la) });
  }

  // Tramo bajo una posición del mundo (pies en `feetY`). Si está en el aire, el primero debajo.
  segmentAt(x, feetY) {
    const c = Math.floor(x / TILE);
    for (let r = Math.floor(feetY / TILE) - 1; r < this.deathRow; r++) {
      const seg = this.segAt.get(`${r},${c}`);
      if (seg !== undefined) return seg;
      if (this.solid(r, c)) return null;
    }
    return null;
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
