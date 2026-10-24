import Phaser from 'phaser';
import { TILE } from './level.js';

// Dibujo de los mapas por código (sin assets). Cada tema tiene su paleta y su forma de pintar
// bloques, plataformas finas, decorados y fondo. La escena hornea el resultado en texturas
// una sola vez por mapa, así que el detalle no cuesta rendimiento.
// Los textos (letreros, números de puerta, pantalla) van en `g.stamps`: bake() los dibuja encima.

const PALETTES = {
  snow: {
    base: 0x6d8294, dark: 0x4b5d6d, light: 0x93a8b8, cap: 0xf5f9ff, capShade: 0xc9dcee,
    special: 0x9fdcf2, specialLight: 0xe6f8ff, specialDark: 0x5fa8cc,
    plank: 0x9a6a3c, plankDark: 0x6a4424, pillar: 0x6a4424, pillarLight: 0x8a5c34,
  },
  factory: {
    base: 0x5b606b, dark: 0x3a3e46, light: 0x8a909b, cap: 0xb83a2e, capLight: 0xe2604f,
    special: 0x7b828b, specialLight: 0xa0a7b0, specialDark: 0x4e545c,
    plank: 0x8d949e, plankDark: 0x4e545c, pillar: 0xd9822b, pillarLight: 0xf0a050, pillarDark: 0xa85f1c,
    wall: 0xb8a684, wallDark: 0x9e8c6c, spike: 0xd0d6dc, spikeDark: 0x7a8088,
  },
  temple: {
    base: 0x7a7258, dark: 0x534d3a, light: 0x9c9474, cap: 0x4f8f3a, capLight: 0x74b84f,
    special: 0x8a7a50, specialLight: 0xb09c66, specialDark: 0x5e5236, gold: 0xd4a83a,
    plank: 0x8a5a2a, plankDark: 0x5e3c1a, rope: 0x3f7a2e, pillar: 0x948c6c, pillarLight: 0xb0a888, pillarDark: 0x6a6450,
    vine: 0x3f8a34, leaf: 0x5cb848,
  },
  vecindad: {
    base: 0xa8553a, dark: 0x7a3826, light: 0xc9714f, mortar: 0x6e4a3a,
    cap: 0xb9b2a6, capLight: 0xdcd6cc, capDark: 0x857d72,
    special: 0x8a5a2e, specialLight: 0xb07a44, specialDark: 0x5a3818, ring: 0x4a4a52,
    plank: 0x8f6236, plankDark: 0x5e3c1c, pillar: 0x8a4a34, pillarLight: 0xa8604a, pillarDark: 0x5e3022,
  },
  concierto: {
    base: 0x24242e, dark: 0x15151c, light: 0x3c3c4a, cap: 0x8a90a2, capLight: 0xc8ccd8,
    special: 0x1a1a20, specialLight: 0x3a3a46, specialDark: 0x0c0c10,
    plank: 0xb4b9c6, plankDark: 0x6c7280, pillar: 0x9aa0ad, pillarDark: 0x5a606c,
    leds: [0xff3a5c, 0x3aa8ff, 0xffd23a, 0x6cff8a],
  },
  utez: {
    base: 0xb9b3a8, dark: 0x8d877c, light: 0xd8d2c6, cap: 0xe4dfd4,
    dirt: 0x8a5a34, dirtDark: 0x6a4224, grass: 0x5cae3a, grassLight: 0x86d05a, grassDark: 0x3f8a2a,
    special: 0xb5523a, specialLight: 0xd06a4c, specialDark: 0x7e3424, mortar: 0x8a6a5a,
    plank: 0xcfc8bc, plankDark: 0x8d877c, rail: 0x5a6070, pillar: 0xbab4a8, pillarDark: 0x8d877c,
    spike: 0xd0884e, spikeDark: 0x7a4a2a,
  },
};

// Mezcla de colores: shade(c, 0.3) aclara, shade(c, -0.3) oscurece.
function mix(a, b, t) {
  const ca = Phaser.Display.Color.IntegerToColor(a);
  const cb = Phaser.Display.Color.IntegerToColor(b);
  return Phaser.Display.Color.GetColor(ca.red + (cb.red - ca.red) * t, ca.green + (cb.green - ca.green) * t, ca.blue + (cb.blue - ca.blue) * t);
}
const shade = (c, f) => (f >= 0 ? mix(c, 0xffffff, f) : mix(c, 0x000000, -f));

// Texto horneado (letreros). Se dibuja en la textura con bake() y se destruye.
function stamp(scene, g, text, x, y, style, ox = 0.5, oy = 0.5) {
  const t = scene.make.text({ x, y, text, style: { fontFamily: 'monospace', fontStyle: 'bold', ...style }, add: false });
  g.stamps.push(t.setOrigin(ox, oy));
  return t;
}

export function drawMapTiles(scene, map) {
  const g = scene.make.graphics({ add: false });
  g.stamps = [];
  const { rows } = map;
  const style = map.theme.style;
  const P = PALETTES[style];
  const H = rows.length;
  const W = rows[0].length;
  const at = (r, c) => (r >= 0 && r < H && c >= 0 && c < W ? rows[r][c] : '.');
  const solid = (r, c) => at(r, c) === '#' || at(r, c) === '%';
  const rnd = new Phaser.Math.RandomDataGenerator([map.name]); // determinista: igual en ambos clientes
  const base = { g, P, rnd, at, map, scene, style };

  // 1) Pared interior: rellena todo el rectángulo de la sala (también detrás de tablones,
  //    cajas y marcadores, para que no queden huecos), y columnas.
  const walls = map.decor.filter((d) => d.type === 'b');
  if (walls.length) {
    const r0 = Math.min(...walls.map((d) => d.r));
    const r1 = Math.max(...walls.map((d) => d.r));
    const c0 = Math.min(...walls.map((d) => d.c));
    const c1 = Math.max(...walls.map((d) => d.c));
    const inRoom = (r, c) => r >= r0 && r <= r1 && c >= c0 && c <= c1 && at(r, c) !== '#';
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (inRoom(r, c)) drawBackWall(g, { r, c }, P, inRoom);
    drawFactoryWindows(g, { r0, r1, c0, c1 });
    drawClock(g, map, r0);
  }
  for (const d of map.decor) if (d.type === '|') PILLAR[style]?.(g, d, P, at);

  // 2) Sombra proyectada de bloques y tablones sobre el fondo: separa los planos y da volumen.
  g.fillStyle(0x000000, 0.22);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (solid(r, c) && !solid(r + 1, c)) g.fillRect(c * TILE + 3, (r + 1) * TILE, TILE, 5);
  for (const o of map.oneWays) g.fillRect(o.x + 3, o.y + 6, o.w, 4);

  // 3) Árboles (detrás de los bloques sobre los que se apoyan).
  for (const d of map.decor) if (d.type === 'T') (style === 'utez' ? drawLeafyTree : drawPine)(g, d.c * TILE + TILE / 2, (d.r + 1) * TILE, rnd);

  // 4) Bloques sólidos.
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!solid(r, c)) continue;
      const ch = at(r, c);
      const same = (rr, cc) => at(rr, cc) === ch;
      const ctx = {
        ...base, x: c * TILE, y: r * TILE, r, c,
        top: !solid(r - 1, c), bottom: !solid(r + 1, c), left: !solid(r, c - 1), right: !solid(r, c + 1),
        sTop: !same(r - 1, c), sBottom: !same(r + 1, c), sLeft: !same(r, c - 1), sRight: !same(r, c + 1),
      };
      if (ch === '%') SPECIAL[style](ctx);
      else BLOCK[style](ctx);
    }
  }

  // 5) Barandillas, plataformas finas, pinchos, lianas, lámparas y utilería.
  for (const row of map.theme.railRows ?? []) drawRailings(g, row, at, W, style === 'concierto' ? 0x8a90a2 : 0x3a3a40);
  for (const o of map.oneWays) PLANK[style](g, o, P);
  for (const s of map.spikes) (style === 'utez' ? drawRebar : drawSpikes)(g, s, P);
  for (const d of map.decor) {
    const x = d.c * TILE + TILE / 2;
    const y = (d.r + 1) * TILE; // pies del objeto: borde inferior de la casilla
    if (d.type === 'v') drawVine(g, d, P, rnd, at);
    else if (d.type === 'i') LAMP[map.theme.lamp ?? 'torch'](g, x, d.r * TILE);
    else if (PROPS[d.type]) PROPS[d.type](g, x, y, rnd);
  }
  SETPIECE[style]?.(base);
  return g;
}

// ------------------------------------------------------------------ bloques
const BLOCK = {
  // Piedra gris azulada con grietas, capa de nieve arriba y carámbanos abajo.
  snow({ g, P, rnd, x, y, top, bottom, left, right }) {
    g.fillStyle(P.base).fillRect(x, y, TILE, TILE);
    g.fillStyle(P.light, 0.5).fillRect(x + 1, y + 1, 5, 4);
    g.fillStyle(P.dark, 0.6);
    g.fillRect(x + rnd.between(3, 10), y + rnd.between(6, 12), rnd.between(3, 6), 1);
    g.fillRect(x + rnd.between(2, 12), y + rnd.between(2, 13), 1, rnd.between(2, 4));
    if (left) g.fillStyle(P.light, 0.6).fillRect(x, y, 2, TILE);
    if (right) g.fillStyle(P.dark).fillRect(x + TILE - 2, y, 2, TILE);
    if (bottom) {
      g.fillStyle(P.dark).fillRect(x, y + TILE - 2, TILE, 2);
      if (rnd.frac() < 0.5) g.fillStyle(0xd8f0ff).fillTriangle(x + 4, y + TILE, x + 8, y + TILE, x + 6, y + TILE + rnd.between(3, 7));
    }
    if (top) {
      g.fillStyle(P.cap).fillRect(x - (left ? 1 : 0), y - 3, TILE + (left ? 1 : 0) + (right ? 1 : 0), 7);
      g.fillStyle(0xffffff).fillRect(x, y - 3, TILE, 1);
      g.fillStyle(P.capShade).fillRect(x, y + 4, TILE, 1);
      if (rnd.frac() < 0.5) g.fillStyle(P.cap).fillRect(x + rnd.between(2, 11), y + 4, 3, 2); // nieve que gotea
      if (rnd.frac() < 0.25) g.fillStyle(0xffffff).fillRect(x + rnd.between(1, 13), y - 1, 1, 1); // destello
    }
  },
  // Viga metálica con remaches, borde rojo arriba y franja de peligro abajo.
  factory({ g, P, x, y, top, bottom, left, right }) {
    g.fillStyle(P.base).fillRect(x, y, TILE, TILE);
    g.fillStyle(P.dark, 0.6).fillRect(x, y + 7, TILE, 1);
    for (const [rx, ry] of [[2, 3], [12, 3], [2, 11], [12, 11]]) {
      g.fillStyle(P.dark).fillRect(x + rx, y + ry + 1, 2, 2);
      g.fillStyle(P.light).fillRect(x + rx, y + ry, 2, 2);
    }
    if (left) g.fillStyle(P.light, 0.5).fillRect(x, y, 1, TILE);
    if (right) g.fillStyle(P.dark).fillRect(x + TILE - 2, y, 2, TILE);
    if (bottom) {
      g.fillStyle(0x1e1e22).fillRect(x, y + TILE - 4, TILE, 4);
      g.fillStyle(0xf2c230);
      for (let k = 0; k < TILE; k += 8) g.fillTriangle(x + k, y + TILE, x + k + 4, y + TILE - 4, x + k + 7, y + TILE - 4).fillTriangle(x + k, y + TILE, x + k + 3, y + TILE, x + k + 7, y + TILE - 4);
    }
    if (top) {
      g.fillStyle(P.cap).fillRect(x, y, TILE, 4);
      g.fillStyle(P.capLight).fillRect(x, y, TILE, 1);
      g.fillStyle(0x000000, 0.3).fillRect(x, y + 4, TILE, 1);
    }
  },
  // Ladrillos de piedra desgastada con musgo y hierba arriba.
  temple({ g, P, rnd, x, y, r, top, bottom, left, right }) {
    g.fillStyle(P.base).fillRect(x, y, TILE, TILE);
    g.fillStyle(P.dark, 0.7);
    g.fillRect(x, y + 7, TILE, 1);
    g.fillRect(x, y + TILE - 1, TILE, 1);
    g.fillRect(x + (r % 2 ? 4 : 11), y, 1, 7);
    g.fillRect(x + (r % 2 ? 11 : 4), y + 8, 1, 7);
    g.fillStyle(P.light, 0.5).fillRect(x + 1, y + 1, 3, 2);
    if (rnd.frac() < 0.3) g.fillStyle(P.cap, 0.6).fillRect(x + rnd.between(1, 12), y + rnd.between(2, 12), 3, 2);
    if (rnd.frac() < 0.08) g.fillStyle(P.gold, 0.8).fillRect(x + 6, y + 3, 4, 2); // incrustación
    if (left) g.fillStyle(P.light, 0.5).fillRect(x, y, 2, TILE);
    if (right) g.fillStyle(P.dark).fillRect(x + TILE - 2, y, 2, TILE);
    if (bottom) g.fillStyle(P.dark).fillRect(x, y + TILE - 2, TILE, 2);
    if (top) {
      g.fillStyle(P.cap).fillRect(x, y, TILE, 4);
      g.fillStyle(P.capLight).fillRect(x, y, TILE, 1);
      for (let i = 0; i < 3; i++) g.fillStyle(P.capLight).fillRect(x + rnd.between(0, 14), y - 2, 1, 2); // hierba
      if (rnd.frac() < 0.4) g.fillStyle(P.cap).fillRect(x + rnd.between(2, 12), y + 4, 2, rnd.between(2, 5)); // musgo colgando
    }
  },
  // Ladrillo rojo con juntas, losa de concreto encima (balcones y patio de la vecindad).
  vecindad({ g, P, rnd, x, y, r, top, bottom, left, right }) {
    brick(g, P, rnd, x, y, r);
    if (rnd.frac() < 0.12) g.fillStyle(0xd8c8a8, 0.8).fillRect(x + rnd.between(0, 8), y + rnd.between(2, 9), rnd.between(5, 8), rnd.between(3, 5)); // repello
    if (left) g.fillStyle(P.light, 0.5).fillRect(x, y, 1, TILE);
    if (right) g.fillStyle(P.dark).fillRect(x + TILE - 2, y, 2, TILE);
    if (bottom) g.fillStyle(P.dark).fillRect(x, y + TILE - 2, TILE, 2);
    if (top) concreteCap(g, P, rnd, x, y, left, right);
  },
  // Escenario: chapa negra con rejilla, canto de aluminio y tira de LEDs de colores.
  concierto({ g, P, x, y, c, top, bottom, left, right }) {
    g.fillStyle(P.base).fillRect(x, y, TILE, TILE);
    g.fillStyle(P.dark);
    for (let k = 0; k < TILE; k += 4) g.fillRect(x + k, y + 5, 1, TILE - 5).fillRect(x, y + 5 + k, TILE, 1);
    if (left) g.fillStyle(P.light).fillRect(x, y, 2, TILE);
    if (right) g.fillStyle(P.dark).fillRect(x + TILE - 2, y, 2, TILE);
    if (bottom) g.fillStyle(0x000000).fillRect(x, y + TILE - 2, TILE, 2);
    if (top) {
      g.fillStyle(P.cap).fillRect(x, y, TILE, 3);
      g.fillStyle(P.capLight).fillRect(x, y, TILE, 1);
      for (let k = 0; k < 4; k++) g.fillStyle(P.leds[(c * 4 + k) % 4]).fillRect(x + k * 4 + 1, y + 4, 2, 1);
    }
  },
  // Campus: pasto con tierra en el suelo; concreto en la plaza y en el arco.
  utez({ g, P, rnd, x, y, r, top, bottom, left, right, map }) {
    if (r >= map.theme.groundRow) {
      g.fillStyle(P.dirt).fillRect(x, y, TILE, TILE);
      for (let i = 0; i < 3; i++) g.fillStyle(rnd.frac() < 0.5 ? P.dirtDark : 0xa07048).fillRect(x + rnd.between(0, 13), y + rnd.between(2, 13), rnd.between(2, 3), 2);
      if (top) {
        g.fillStyle(P.grass).fillRect(x, y - 2, TILE, 6);
        g.fillStyle(P.grassLight).fillRect(x, y - 2, TILE, 1);
        g.fillStyle(P.grassDark).fillRect(x, y + 4, TILE, 1);
        for (let i = 0; i < 4; i++) g.fillStyle(rnd.frac() < 0.5 ? P.grassLight : P.grass).fillRect(x + rnd.between(0, 15), y - rnd.between(4, 6), 1, 3);
        if (rnd.frac() < 0.12) g.fillStyle(rnd.pick([0xffe066, 0xffffff, 0xff8ab0])).fillRect(x + rnd.between(2, 13), y - 5, 2, 2); // flor
      }
      if (left) g.fillStyle(P.grassDark).fillRect(x, y, 2, 6);
      if (right) g.fillStyle(P.grassDark).fillRect(x + TILE - 2, y, 2, 6);
      return;
    }
    g.fillStyle(P.base).fillRect(x, y, TILE, TILE);
    g.fillStyle(P.dark, 0.5).fillRect(x + TILE - 1, y, 1, TILE);
    if (rnd.frac() < 0.2) g.fillStyle(P.dark, 0.35).fillRect(x + rnd.between(2, 12), y + rnd.between(4, 12), rnd.between(2, 4), 1);
    if (left) g.fillStyle(P.light).fillRect(x, y, 2, TILE);
    if (right) g.fillStyle(P.dark).fillRect(x + TILE - 2, y, 2, TILE);
    if (bottom) g.fillStyle(P.dark).fillRect(x, y + TILE - 3, TILE, 3);
    if (top) {
      g.fillStyle(P.cap).fillRect(x, y, TILE, 4);
      g.fillStyle(0xffffff, 0.7).fillRect(x, y, TILE, 1);
      g.fillStyle(P.dark, 0.6).fillRect(x, y + 4, TILE, 1);
    }
  },
};

function brick(g, P, rnd, x, y, r) {
  g.fillStyle(P.base).fillRect(x, y, TILE, TILE);
  for (let k = 0; k < 4; k++) {
    const yy = y + k * 4;
    if (rnd.frac() < 0.3) g.fillStyle(P.light, 0.5).fillRect(x + rnd.between(0, 2) * 6, yy, 6, 3);
    g.fillStyle(P.mortar).fillRect(x, yy + 3, TILE, 1);
    for (let bx = x + ((r * 4 + k) % 2 ? 4 : 0); bx < x + TILE; bx += 8) g.fillRect(bx, yy, 1, 3);
  }
}

function concreteCap(g, P, rnd, x, y, left, right) {
  g.fillStyle(P.cap).fillRect(x - (left ? 1 : 0), y - 2, TILE + (left ? 1 : 0) + (right ? 1 : 0), 6);
  g.fillStyle(P.capLight).fillRect(x, y - 2, TILE, 1);
  g.fillStyle(P.capDark).fillRect(x, y + 3, TILE, 1);
  if (rnd.frac() < 0.3) g.fillStyle(P.capDark).fillRect(x + rnd.between(2, 12), y - 1, 1, 3); // grieta
}

const SPECIAL = {
  // Bloque de hielo translúcido con brillos.
  snow({ g, P, x, y, top }) {
    g.fillStyle(P.special).fillRect(x, y, TILE, TILE);
    g.lineStyle(1, P.specialDark).strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    g.lineStyle(2, P.specialLight, 0.8).lineBetween(x + 3, y + 12, x + 12, y + 3);
    g.fillStyle(0xffffff, 0.8).fillRect(x + 2, y + 2, 3, 1);
    if (top) g.fillStyle(P.cap).fillRect(x, y - 1, TILE, 3);
  },
  // Caja metálica con refuerzo en X.
  factory({ g, P, x, y }) {
    g.fillStyle(P.special).fillRect(x, y, TILE, TILE);
    g.lineStyle(2, P.specialDark).strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    g.lineStyle(1, P.specialDark).lineBetween(x + 2, y + 2, x + 14, y + 14).lineBetween(x + 14, y + 2, x + 2, y + 14);
    g.fillStyle(P.specialLight).fillRect(x + 1, y + 1, TILE - 2, 1);
  },
  // Piedra tallada con un glifo dorado.
  temple({ g, P, x, y }) {
    g.fillStyle(P.special).fillRect(x, y, TILE, TILE);
    g.lineStyle(1, P.specialDark).strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
    g.lineStyle(1, P.gold).strokeCircle(x + 8, y + 8, 3);
    g.fillStyle(P.gold).fillRect(x + 7, y + 7, 2, 2);
    g.fillStyle(P.specialLight).fillRect(x + 1, y + 1, TILE - 2, 1);
  },
  // Barril de madera con aros (cobertura en mitad del patio).
  vecindad({ g, P, x, y, sTop, sBottom, sLeft, sRight }) {
    g.fillStyle(P.special).fillRect(x, y, TILE, TILE);
    for (let k = 2; k < TILE; k += 5) g.fillStyle(P.specialDark).fillRect(x + k, y, 1, TILE); // duelas
    g.fillStyle(P.specialLight).fillRect(x + (sLeft ? 3 : 1), y, 3, TILE);
    if (sLeft) g.fillStyle(P.specialDark).fillRect(x, y, 2, TILE);
    if (sRight) g.fillStyle(0x3a2410).fillRect(x + TILE - 2, y, 2, TILE);
    for (const ry of [sTop ? 3 : -1, sBottom ? TILE - 5 : -1]) if (ry >= 0) {
      g.fillStyle(P.ring).fillRect(x, y + ry, TILE, 2);
      g.fillStyle(0x8a8a96).fillRect(x, y + ry, TILE, 1);
    }
    if (sTop) g.fillStyle(0x6a4422).fillRect(x, y, TILE, 2);
  },
  // Torre de altavoces: caja negra con un cono por casilla.
  concierto({ g, P, x, y, sTop, sLeft, sRight }) {
    g.fillStyle(P.special).fillRect(x, y, TILE, TILE);
    g.fillStyle(P.specialLight).fillRect(x, y + TILE - 1, TILE, 1);
    if (sLeft) g.fillStyle(P.specialLight).fillRect(x, y, 1, TILE);
    if (sRight) g.fillStyle(P.specialDark).fillRect(x + TILE - 1, y, 1, TILE);
    g.fillStyle(0x4a4a56).fillCircle(x + 8, y + 8, 6);
    g.fillStyle(0x22222a).fillCircle(x + 8, y + 8, 5);
    g.fillStyle(0x34343e).fillCircle(x + 8, y + 8, 3);
    g.fillStyle(0x6a6a78).fillCircle(x + 8, y + 8, 1.5);
    if (sTop) {
      g.fillStyle(0x8a90a2).fillRect(x, y, TILE, 2);
      g.fillStyle(0xc8ccd8).fillRect(x, y, TILE, 1);
    }
  },
  // Muro de ladrillo rojo con remate de concreto.
  utez({ g, P, rnd, x, y, r, top, left, right }) {
    brick(g, P, rnd, x, y, r);
    if (left) g.fillStyle(P.specialLight).fillRect(x, y, 1, TILE);
    if (right) g.fillStyle(P.specialDark).fillRect(x + TILE - 2, y, 2, TILE);
    if (top) concreteCap(g, { cap: 0xd8d2c6, capLight: 0xf2eee6, capDark: 0x9a948a }, rnd, x, y, left, right);
  },
};

const PLANK = {
  // Puente de tablones con algo de nieve encima.
  snow(g, o, P) {
    g.fillStyle(P.plank).fillRect(o.x, o.y, o.w, 6);
    g.fillStyle(P.plankDark).fillRect(o.x, o.y + 5, o.w, 1);
    for (let x = o.x + 8; x < o.x + o.w; x += 8) g.fillStyle(P.plankDark).fillRect(x, o.y + 1, 1, 4);
    g.fillStyle(0xf5f9ff).fillRect(o.x, o.y - 1, o.w, 2);
    brackets(g, o, P.plankDark);
  },
  // Rejilla metálica con borde rojo.
  factory(g, o, P) {
    g.fillStyle(P.plank).fillRect(o.x, o.y, o.w, 6);
    g.fillStyle(0xb83a2e).fillRect(o.x, o.y, o.w, 2);
    for (let x = o.x + 2; x < o.x + o.w - 1; x += 4) g.fillStyle(P.plankDark).fillRect(x, o.y + 3, 2, 2);
    brackets(g, o, P.plankDark);
  },
  // Tablones atados con cuerda de liana.
  temple(g, o, P) {
    g.fillStyle(P.plank).fillRect(o.x, o.y, o.w, 6);
    for (let x = o.x + 6; x < o.x + o.w; x += 6) g.fillStyle(P.plankDark).fillRect(x, o.y, 1, 6);
    g.lineStyle(1, P.rope).lineBetween(o.x, o.y + 1, o.x + o.w, o.y + 1).lineBetween(o.x, o.y + 5, o.x + o.w, o.y + 5);
  },
  // Repisa de madera sobre escuadras (como las de las paredes de la vecindad).
  vecindad(g, o, P) {
    g.fillStyle(P.plank).fillRect(o.x, o.y, o.w, 6);
    g.fillStyle(shade(P.plank, 0.25)).fillRect(o.x, o.y, o.w, 1);
    g.fillStyle(P.plankDark).fillRect(o.x, o.y + 5, o.w, 1);
    for (let x = o.x + 11; x < o.x + o.w; x += 11) g.fillStyle(P.plankDark).fillRect(x, o.y + 1, 1, 4);
    g.lineStyle(2, P.plankDark);
    for (const bx of o.w >= 48 ? [o.x + 6, o.x + o.w - 6] : [o.x + o.w / 2]) g.lineBetween(bx, o.y + 6, bx, o.y + 14).lineBetween(bx, o.y + 13, bx + 6, o.y + 6);
  },
  // Truss de aluminio (estructura de luces).
  concierto(g, o, P) {
    g.fillStyle(P.plank).fillRect(o.x, o.y, o.w, 2);
    g.fillStyle(P.plank).fillRect(o.x, o.y + 6, o.w, 2);
    g.fillStyle(0xe8ecf4).fillRect(o.x, o.y, o.w, 1);
    g.lineStyle(1, P.plankDark);
    for (let x = o.x; x < o.x + o.w; x += 8) g.lineBetween(x, o.y + 2, x + 4, o.y + 6).lineBetween(x + 4, o.y + 6, x + 8, o.y + 2);
  },
  // Losa delgada de concreto con barandal metálico.
  utez(g, o, P) {
    g.fillStyle(P.rail);
    for (let x = o.x + 2; x < o.x + o.w; x += 8) g.fillRect(x, o.y - 10, 1, 10);
    g.fillRect(o.x, o.y - 11, o.w, 2);
    g.fillStyle(0x9aa0b0).fillRect(o.x, o.y - 11, o.w, 1);
    g.fillStyle(P.plank).fillRect(o.x, o.y, o.w, 6);
    g.fillStyle(0xf0ebe2).fillRect(o.x, o.y, o.w, 1);
    g.fillStyle(P.plankDark).fillRect(o.x, o.y + 5, o.w, 1);
  },
};

function brackets(g, o, color) {
  g.fillStyle(color);
  for (const bx of [o.x + 3, o.x + o.w - 6]) g.fillTriangle(bx, o.y + 6, bx + 3, o.y + 6, bx + 1, o.y + 11);
}

// Barandilla sobre los tramos de bloque con la cara de arriba libre en la fila `row`.
function drawRailings(g, row, at, W, color) {
  const isTop = (c) => (at(row, c) === '#' || at(row, c) === '%') && at(row - 1, c) !== '#' && at(row - 1, c) !== '%';
  for (let c = 0; c < W; c++) {
    if (!isTop(c)) continue;
    let c2 = c;
    while (c2 + 1 < W && isTop(c2 + 1)) c2++;
    const x0 = c * TILE + 2;
    const x1 = (c2 + 1) * TILE - 2;
    const y = row * TILE - 3;
    g.fillStyle(color);
    for (let x = x0; x <= x1; x += 6) g.fillRect(x, y - 11, 1, 11);
    g.fillRect(x0, y - 12, x1 - x0 + 1, 2);
    g.fillStyle(shade(color, 0.4)).fillRect(x0, y - 12, x1 - x0 + 1, 1);
    c = c2;
  }
}

// --------------------------------------------------------------- decorados
function drawBackWall(g, { r, c }, P, inRoom) {
  const x = c * TILE;
  const y = r * TILE;
  g.fillStyle(P.wall).fillRect(x, y, TILE, TILE);
  if (c % 6 === 0) g.fillStyle(P.wallDark).fillRect(x, y, 1, TILE); // juntas de paneles
  if (r % 5 === 0) g.fillStyle(P.wallDark, 0.5).fillRect(x, y, TILE, 1);
  if (!inRoom(r + 1, c)) g.fillStyle(P.wallDark).fillRect(x, y + TILE - 4, TILE, 4); // zócalo
  if (!inRoom(r - 1, c)) g.fillStyle(0x000000, 0.15).fillRect(x, y, TILE, 3); // sombra del techo
}

// Ventanales altos de la nave con haces de luz, tuberías y un letrero.
function drawFactoryWindows(g, { r0, r1, c0, c1 }) {
  const top = (r0 + 1) * TILE;
  for (let x = c0 * TILE + 40; x < (c1 + 1) * TILE - 60; x += 110) {
    g.fillStyle(0x2a2e38).fillRect(x, top, 44, 56);
    g.fillStyle(0x9fc8e0).fillRect(x + 3, top + 3, 38, 50);
    g.fillStyle(0xd8eef8).fillRect(x + 3, top + 3, 38, 12);
    g.fillStyle(0x2a2e38).fillRect(x + 21, top, 2, 56).fillRect(x, top + 27, 44, 2);
    g.fillStyle(0xfff6d8, 0.13).fillTriangle(x + 3, top + 53, x + 41, top + 53, x + 90, (r1 - 2) * TILE).fillTriangle(x + 3, top + 53, x + 40, (r1 - 2) * TILE, x + 90, (r1 - 2) * TILE);
  }
  // Tuberías horizontales con bridas.
  const py = (r0 + 6) * TILE;
  g.fillStyle(0x6a707c).fillRect(c0 * TILE, py, (c1 - c0 + 1) * TILE, 6);
  g.fillStyle(0x8a909c).fillRect(c0 * TILE, py, (c1 - c0 + 1) * TILE, 2);
  for (let x = c0 * TILE + 20; x < (c1 + 1) * TILE; x += 70) g.fillStyle(0x4a505c).fillRect(x, py - 1, 4, 8);
  // Franja de peligro sobre el zócalo.
  const sy = (r1 - 1) * TILE + 4;
  for (let x = c0 * TILE; x < (c1 + 1) * TILE; x += 12) {
    g.fillStyle(0xf2c230).fillRect(x, sy, 6, 5);
    g.fillStyle(0x24242a).fillRect(x + 6, sy, 6, 5);
  }
}

function drawClock(g, map, top) {
  const x = map.width / 2;
  const y = (top + 3) * TILE + 6;
  g.fillStyle(0x333333).fillCircle(x, y, 13);
  g.fillStyle(0xf4f4f4).fillCircle(x, y, 10);
  g.lineStyle(2, 0x222222).lineBetween(x, y, x, y - 8).lineBetween(x, y, x + 5, y + 2);
}

const PILLAR = {
  snow(g, { r, c }, P) {
    const cx = c * TILE + TILE / 2;
    g.fillStyle(P.pillar).fillRect(cx - 3, r * TILE, 6, TILE);
    g.fillStyle(P.pillarLight).fillRect(cx - 3, r * TILE, 2, TILE);
  },
  factory(g, { r, c }, P, at) {
    const cx = c * TILE + TILE / 2;
    const y = r * TILE;
    g.fillStyle(P.pillar).fillRect(cx - 4, y, 8, TILE);
    g.fillStyle(P.pillarLight).fillRect(cx - 4, y, 2, TILE);
    g.fillStyle(P.pillarDark).fillRect(cx + 2, y, 2, TILE);
    if (at(r - 1, c) !== '|') g.fillStyle(P.pillarDark).fillRect(cx - 6, y, 12, 3); // capitel
    g.fillStyle(P.pillarDark).fillRect(cx - 1, y + 7, 2, 2); // perno
  },
  temple(g, { r, c }, P, at) {
    const cx = c * TILE + TILE / 2;
    const y = r * TILE;
    g.fillStyle(P.pillar).fillRect(cx - 5, y, 10, TILE);
    g.fillStyle(P.pillarDark).fillRect(cx - 2, y, 1, TILE).fillRect(cx + 2, y, 1, TILE); // estrías
    g.fillStyle(P.pillarLight).fillRect(cx - 5, y, 2, TILE);
    if (at(r - 1, c) !== '|') g.fillStyle(P.pillarDark).fillRect(cx - 7, y, 14, 3);
  },
  // Pilar de ladrillo bajo el patio (se hunde en la alcantarilla).
  vecindad(g, { r, c }, P) {
    const x = c * TILE + 2;
    g.fillStyle(P.pillar).fillRect(x, r * TILE, 12, TILE);
    g.fillStyle(P.pillarDark).fillRect(x, r * TILE + 7, 12, 1).fillRect(x + 10, r * TILE, 2, TILE);
    g.fillStyle(P.pillarLight).fillRect(x, r * TILE, 2, TILE);
  },
  // Torre de truss.
  concierto(g, { r, c }, P) {
    const x = c * TILE + 3;
    const y = r * TILE;
    g.fillStyle(P.pillar).fillRect(x, y, 2, TILE).fillRect(x + 8, y, 2, TILE);
    g.lineStyle(1, P.pillarDark).lineBetween(x + 2, y, x + 8, y + 8).lineBetween(x + 8, y + 8, x + 2, y + 16);
  },
  // Columna de concreto.
  utez(g, { r, c }, P) {
    const x = c * TILE + 3;
    g.fillStyle(P.pillar).fillRect(x, r * TILE, 10, TILE);
    g.fillStyle(0xd8d2c6).fillRect(x, r * TILE, 2, TILE);
    g.fillStyle(P.pillarDark).fillRect(x + 8, r * TILE, 2, TILE);
  },
};

function drawPine(g, x, baseY) {
  g.fillStyle(0x5a3a22).fillRect(x - 3, baseY - 16, 6, 16);
  const tiers = [[44, 52], [34, 40], [24, 28], [14, 16]];
  tiers.forEach(([w, h], i) => {
    const ty = baseY - 14 - i * 16;
    g.fillStyle(0x24553a).fillTriangle(x - w / 2, ty, x + w / 2, ty, x, ty - h / 2 - 6);
    g.fillStyle(0x2f6b4a).fillTriangle(x - w / 2 + 3, ty - 2, x + 2, ty - 2, x, ty - h / 2 - 4);
    g.fillStyle(0xf5f9ff).fillTriangle(x - w / 4, ty - h / 4, x + w / 4, ty - h / 4, x, ty - h / 2 - 6); // nieve
  });
}

function drawLeafyTree(g, x, baseY, rnd) {
  g.fillStyle(0x6a4a2e).fillRect(x - 3, baseY - 30, 7, 30);
  g.fillStyle(0x4a321e).fillRect(x + 2, baseY - 30, 2, 30);
  const blobs = [[0, -48, 22], [-16, -40, 15], [16, -40, 15], [-8, -60, 14], [10, -58, 14]];
  for (const [dx, dy, rr] of blobs) g.fillStyle(0x3f8a34).fillCircle(x + dx, baseY + dy, rr);
  for (const [dx, dy, rr] of blobs) g.fillStyle(0x5cae44).fillCircle(x + dx - 3, baseY + dy - 4, rr * 0.6);
  for (let i = 0; i < 8; i++) g.fillStyle(0x86d05a).fillRect(x + rnd.between(-22, 18), baseY - rnd.between(40, 70), 2, 2);
}

function drawVine(g, { r, c }, P, rnd, at) {
  const x = c * TILE + TILE / 2;
  let len = rnd.between(3, 6) * TILE;
  for (let k = 1; k * TILE < len; k++) if (at(r + k, c) === '#' || at(r + k, c) === '-') len = k * TILE;
  const y0 = r * TILE;
  for (let y = 0; y < len; y += 2) {
    const wx = x + Math.round(Math.sin((y0 + y) / 6) * 2);
    g.fillStyle(P.vine).fillRect(wx, y0 + y, 2, 2);
    if (y % 8 === 0) g.fillStyle(P.leaf).fillRect(wx + (y % 16 ? 2 : -3), y0 + y, 3, 2);
  }
}

// Lámparas ('i'): (x, y) = centro de la casilla arriba. La luz la pone systems/Lights.js.
const LAMP = {
  torch(g, x, y) {
    g.fillStyle(0x5a3a1a).fillRect(x - 1, y + 6, 3, 10);
    g.fillStyle(0x7a5a2a).fillRect(x - 3, y + 4, 7, 3);
  },
  // Farol de hierro sobre poste.
  lantern(g, x, y) {
    g.fillStyle(0x2a2a30).fillRect(x - 1, y - 12, 3, 28);
    g.fillStyle(0x2a2a30).fillRect(x - 5, y - 20, 11, 9);
    g.fillStyle(0xffd27a).fillRect(x - 3, y - 18, 7, 5);
    g.fillStyle(0x2a2a30).fillTriangle(x - 6, y - 20, x + 6, y - 20, x, y - 25);
    g.fillStyle(0xf5f9ff).fillRect(x - 5, y - 23, 10, 2);
  },
  // Baliza de aviso ámbar en su soporte.
  beacon(g, x, y) {
    g.fillStyle(0x3a3e46).fillRect(x - 5, y + 10, 10, 4);
    g.fillStyle(0xf0a020).fillRect(x - 3, y + 4, 6, 6);
    g.fillStyle(0xffe0a0).fillRect(x - 2, y + 5, 2, 2);
  },
  // Aplique de pared con foco.
  wall(g, x, y) {
    g.fillStyle(0x2a2a30).fillRect(x - 1, y + 2, 2, 6).fillRect(x - 1, y + 2, 6, 2);
    g.fillStyle(0xfff0c0).fillCircle(x + 5, y + 8, 3);
    g.fillStyle(0x2a2a30).fillRect(x + 1, y + 4, 8, 2);
  },
  // Foco de escenario colgado del truss, apuntando abajo.
  spot(g, x, y) {
    g.fillStyle(0x6c7280).fillRect(x - 1, y - 4, 2, 5);
    g.fillStyle(0x1a1a20).fillRect(x - 5, y, 10, 9);
    g.fillStyle(0x3a3a46).fillRect(x - 5, y, 2, 9);
    g.fillStyle(0xfff6e0).fillRect(x - 4, y + 9, 8, 2);
  },
  // Farola de calle.
  street(g, x, y) {
    g.fillStyle(0x3a3e48).fillRect(x - 1, y - 30, 3, 46);
    g.fillStyle(0x3a3e48).fillRect(x - 1, y - 30, 12, 2);
    g.fillStyle(0x3a3e48).fillRect(x + 6, y - 30, 8, 4);
    g.fillStyle(0xfff6c8).fillRect(x + 7, y - 26, 6, 2);
    g.fillStyle(0x2a2e36).fillRect(x - 3, y + 13, 7, 3);
  },
};

// Utilería sin colisión, apoyada en el borde inferior de su casilla.
const PROPS = {
  o(g, x, y) { // barril
    g.fillStyle(0x7a4a24).fillRect(x - 7, y - 20, 14, 20);
    g.fillStyle(0x9a6434).fillRect(x - 5, y - 20, 3, 20);
    g.fillStyle(0x4a4a52).fillRect(x - 7, y - 17, 14, 2).fillRect(x - 7, y - 6, 14, 2);
    g.fillStyle(0x5a3418).fillRect(x - 7, y - 21, 14, 2);
  },
  x(g, x, y) { // caja de madera
    g.fillStyle(0xa8743c).fillRect(x - 8, y - 16, 16, 16);
    g.lineStyle(2, 0x6a4420).strokeRect(x - 7, y - 15, 14, 14).lineBetween(x - 6, y - 14, x + 6, y - 2);
    g.fillStyle(0xc8945a).fillRect(x - 7, y - 15, 14, 1);
  },
  p(g, x, y, rnd) { // maceta con flores
    g.fillStyle(0xb85a34).fillRect(x - 5, y - 8, 10, 8);
    g.fillStyle(0xd8774a).fillRect(x - 6, y - 9, 12, 2);
    g.fillStyle(0x3f8a34).fillCircle(x - 3, y - 12, 4).fillCircle(x + 3, y - 12, 4).fillCircle(x, y - 15, 4);
    const fl = rnd.pick([0xff4a6a, 0xffd23a, 0xff8ad0, 0xffffff]);
    for (const [dx, dy] of [[-4, -15], [3, -17], [0, -12], [4, -11]]) g.fillStyle(fl).fillRect(x + dx, y + dy, 2, 2);
  },
  k(g, x, y) { // bote de basura metálico
    g.fillStyle(0x7a8088).fillRect(x - 6, y - 16, 12, 16);
    g.fillStyle(0x9aa0a8).fillRect(x - 4, y - 16, 2, 16).fillRect(x + 1, y - 16, 1, 16);
    g.fillStyle(0x5a6068).fillRect(x - 7, y - 18, 14, 3);
    g.fillStyle(0x3a3e44).fillRect(x - 2, y - 20, 4, 2);
  },
  n(g, x, y) { // banca de madera
    g.fillStyle(0x3a3e48).fillRect(x - 14, y - 8, 2, 8).fillRect(x + 12, y - 8, 2, 8);
    g.fillStyle(0x9a6434).fillRect(x - 16, y - 10, 32, 3).fillRect(x - 16, y - 17, 32, 3);
    g.fillStyle(0xc08450).fillRect(x - 16, y - 10, 32, 1).fillRect(x - 16, y - 17, 32, 1);
    g.fillStyle(0x3a3e48).fillRect(x - 14, y - 17, 2, 8).fillRect(x + 12, y - 17, 2, 8);
  },
};

function drawSpikes(g, s, P) {
  g.fillStyle(P.spikeDark ?? 0x7a8088).fillRect(s.x, s.y + s.h - 2, s.w, 2);
  for (let x = s.x; x < s.x + s.w; x += 5) {
    g.fillStyle(P.spike ?? 0xd0d6dc).fillTriangle(x, s.y + s.h - 2, x + 5, s.y + s.h - 2, x + 2.5, s.y - 1);
    g.fillStyle(0xffffff, 0.7).fillRect(x + 2, s.y + 1, 1, 3);
  }
}

// Varillas oxidadas que asoman del fondo de la zanja.
function drawRebar(g, s, P) {
  g.fillStyle(0x6a6460).fillRect(s.x, s.y + s.h - 3, s.w, 3);
  for (let x = s.x + 2; x < s.x + s.w; x += 6) {
    const h = 9 + ((x * 7) % 5);
    g.fillStyle(P.spike).fillRect(x, s.y + s.h - h, 2, h);
    g.fillStyle(P.spikeDark).fillRect(x + 1, s.y + s.h - h, 1, h);
    g.fillStyle(0xd8a070).fillRect(x, s.y + s.h - h, 2, 1);
  }
}

// ------------------------------------------------------- piezas de cada mapa
const SETPIECE = {
  // Letrero de la entrada sobre la viga del arco.
  utez({ g, scene, map }) {
    const beam = map.theme.sign; // { r, c0, c1 }
    if (!beam) return; // (los mapas generados con este estilo no llevan letrero)
    const x0 = beam.c0 * TILE + 10;
    const x1 = (beam.c1 + 1) * TILE - 10;
    const y = beam.r * TILE + 9;
    g.fillStyle(0x2a2e36).fillRect(x0, y, x1 - x0, 26);
    g.fillStyle(0xf4f0e6).fillRect(x0 + 2, y + 2, x1 - x0 - 4, 22);
    g.fillStyle(0xc8c2b6).fillRect(x0 + 2, y + 21, x1 - x0 - 4, 3);
    stamp(scene, g, 'UNIVERSIDAD TECNOLÓGICA EMILIANO ZAPATA', (x0 + x1) / 2, y + 12, { fontSize: '15px', color: '#22262e' });
  },
};

// ------------------------------------------------------------------ fondos
// Dos capas: `far` (cielo y lejanías, con paralaje) y `near` (lo que rodea la arena).
export function drawMapBackground(scene, map) {
  const far = scene.make.graphics({ add: false });
  const near = scene.make.graphics({ add: false });
  far.stamps = [];
  near.stamps = [];
  const rnd = new Phaser.Math.RandomDataGenerator([`${map.name}-bg`]);
  const anchors = {}; // puntos del fondo que animan los efectos del mapa (systems/MapFx.js)
  BACKGROUND[map.theme.style]({ far, near, rnd, W: map.width, H: map.height, scene, map, anchors });
  return { far, near, anchors };
}

function mountains(g, rnd, W, color, baseY, minH, maxH, capColor) {
  for (let x = -60; x < W + 60; x += rnd.between(80, 150)) {
    const w = rnd.between(160, 280);
    const h = rnd.between(minH, maxH);
    g.fillStyle(color).fillTriangle(x, baseY, x + w, baseY, x + w / 2, baseY - h);
    g.fillStyle(0x000000, 0.06).fillTriangle(x + w / 2, baseY - h, x + w, baseY, x + w / 2, baseY);
    if (capColor) g.fillStyle(capColor).fillTriangle(x + w / 2 - w * 0.12, baseY - h * 0.76, x + w / 2 + w * 0.12, baseY - h * 0.76, x + w / 2, baseY - h);
  }
}

function clouds(g, rnd, W, yMin, yMax, n, color = 0xffffff, alpha = 0.6) {
  for (let i = 0; i < n; i++) {
    const x = rnd.between(0, W);
    const y = rnd.between(yMin, yMax);
    const w = rnd.between(70, 160);
    g.fillStyle(color, alpha).fillEllipse(x, y, w, w * 0.22);
    g.fillStyle(color, alpha).fillEllipse(x - w * 0.15, y - 6, w * 0.5, w * 0.24);
    g.fillStyle(color, alpha).fillEllipse(x + w * 0.18, y - 8, w * 0.4, w * 0.22);
  }
}

function glow(g, x, y, r, color, alpha = 0.18) {
  for (let k = 4; k > 0; k--) g.fillStyle(color, alpha / k).fillCircle(x, y, r * (1 + k * 0.5));
  g.fillStyle(color, alpha * 2).fillCircle(x, y, r);
}

// Ventanas en rejilla (edificios de fondo).
function windows(g, rnd, x, y, w, h, cell, color, lit, litChance = 0.35) {
  for (let wy = y + 6; wy < y + h - 8; wy += cell) {
    for (let wx = x + 6; wx < x + w - 8; wx += cell) g.fillStyle(rnd.frac() < litChance ? lit : color).fillRect(wx, wy, cell * 0.5, cell * 0.55);
  }
}

const BACKGROUND = {
  // Atardecer cálido, montañas nevadas y mar congelado con cabañas en la orilla.
  snow({ far, near, rnd, W, H }) {
    far.fillGradientStyle(0xe9a07c, 0xe9a07c, 0xf8e2c4, 0xf8e2c4, 1).fillRect(0, 0, W, H);
    glow(far, W * 0.78, H * 0.24, 44, 0xfff3d6, 0.2);
    far.fillStyle(0xfff6e0).fillCircle(W * 0.78, H * 0.24, 40);
    clouds(far, rnd, W, 40, H * 0.35, 9, 0xffffff, 0.45);
    mountains(far, rnd, W, 0xc7d3e0, H * 0.62, 180, 330, 0xffffff);
    mountains(far, rnd, W, 0xa9bccf, H * 0.64, 90, 190, 0xf0f6ff);
    const sea = H * 0.63;
    near.fillStyle(0xb5d3e6).fillRect(0, sea, W, H - sea);
    near.fillStyle(0xd8ecf7).fillRect(0, sea, W, 3);
    for (let i = 0; i < 26; i++) near.fillStyle(0xd8ecf7).fillRect(rnd.between(0, W), rnd.between(sea + 10, H), rnd.between(30, 90), 2);
    for (let i = 0; i < 14; i++) near.fillStyle(0xf4fbff).fillEllipse(rnd.between(0, W), rnd.between(sea + 20, H - 40), rnd.between(24, 60), rnd.between(6, 12));
    // Orilla lejana: pinos pequeños y cabañas con la luz encendida.
    for (let x = 0; x < W; x += rnd.between(12, 22)) {
      const h = rnd.between(14, 30);
      near.fillStyle(0x5f7f93).fillTriangle(x - 6, sea, x + 6, sea, x, sea - h);
    }
    for (const cx of [W * 0.12, W * 0.34, W * 0.66, W * 0.88]) {
      near.fillStyle(0x6a4a34).fillRect(cx - 16, sea - 18, 32, 18);
      near.fillStyle(0xf5f9ff).fillTriangle(cx - 21, sea - 17, cx + 21, sea - 17, cx, sea - 32);
      near.fillStyle(0xffc860).fillRect(cx - 9, sea - 12, 6, 6).fillRect(cx + 4, sea - 12, 6, 6);
      glow(near, cx, sea - 9, 8, 0xffc860, 0.1);
      near.fillStyle(0x4a3424).fillRect(cx + 8, sea - 36, 4, 10);
    }
  },
  // Zona industrial al anochecer: chimeneas, depósitos y una ciudad encendida al fondo.
  factory({ far, near, rnd, W, H, anchors }) {
    anchors.chimneys = [];
    far.fillGradientStyle(0x2a2244, 0x2a2244, 0xe0784a, 0xe0784a, 1).fillRect(0, 0, W, H * 0.75);
    far.fillStyle(0x1a1626).fillRect(0, H * 0.75, W, H * 0.25);
    glow(far, W * 0.5, H * 0.66, 50, 0xffb070, 0.18);
    clouds(far, rnd, W, 60, H * 0.45, 8, 0x8a5a7a, 0.35);
    for (let x = -20; x < W; x += rnd.between(40, 80)) { // ciudad lejana
      const h = rnd.between(80, 220);
      const w = rnd.between(36, 70);
      far.fillStyle(0x2c2438).fillRect(x, H * 0.75 - h, w, h);
      windows(far, rnd, x, H * 0.75 - h, w, h, 10, 0x3a3048, 0xffc878, 0.25);
    }
    for (let x = 30; x < W; x += rnd.between(120, 220)) { // chimeneas con luz roja
      const h = rnd.between(200, 320);
      far.fillStyle(0x221c2c).fillRect(x, H * 0.75 - h, 18, h);
      far.fillStyle(0x3a3046).fillRect(x, H * 0.75 - h, 4, h);
      far.fillStyle(0xd84a3a).fillRect(x + 2, H * 0.75 - h - 3, 14, 3);
      anchors.chimneys.push({ x: x + 9, y: H * 0.75 - h - 4 });
    }
    // Cerca: depósitos, tuberías y valla.
    const ground = H * 0.82;
    for (const [x, r] of [[W * 0.06, 60], [W * 0.94, 60], [W * 0.25, 40], [W * 0.75, 40]]) {
      near.fillStyle(0x34303e).fillRect(x - r, ground - r * 2.2, r * 2, r * 2.2);
      near.fillStyle(0x34303e).fillEllipse(x, ground - r * 2.2, r * 2, r * 0.6);
      near.fillStyle(0x48445a).fillRect(x - r, ground - r * 2.2, r * 0.4, r * 2.2);
      near.fillStyle(0x24202c).fillRect(x - r, ground - r * 1.2, r * 2, 4);
    }
    near.fillStyle(0x2a2632).fillRect(0, ground, W, H - ground);
    near.fillStyle(0x3e3a4a).fillRect(0, ground - 70, W, 6);
    for (let x = 0; x < W; x += 60) near.fillStyle(0x3e3a4a).fillRect(x, ground - 70, 6, 70);
    near.lineStyle(1, 0x4a4658, 0.6);
    for (let x = 0; x < W; x += 10) near.lineBetween(x, ground - 64, x + 30, ground).lineBetween(x + 30, ground - 64, x, ground);
  },
  // Crepúsculo con luna y estrellas, zigurats lejanos, selva y niebla abajo.
  temple({ far, near, rnd, W, H }) {
    far.fillGradientStyle(0x14163a, 0x14163a, 0x6a4058, 0x6a4058, 1).fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) far.fillStyle(0xffffff, rnd.realInRange(0.3, 0.9)).fillRect(rnd.between(0, W), rnd.between(0, H * 0.5), rnd.frac() < 0.15 ? 2 : 1, 1);
    glow(far, W * 0.18, H * 0.16, 30, 0xf0e6c8, 0.15);
    far.fillStyle(0xf0e6c8).fillCircle(W * 0.18, H * 0.16, 30);
    far.fillStyle(0x14163a).fillCircle(W * 0.18 + 12, H * 0.16 - 7, 25);
    for (const [cx, base, steps] of [[W * 0.12, H * 0.7, 6], [W * 0.86, H * 0.68, 5], [W * 0.5, H * 0.6, 4]]) {
      for (let s = 0; s < steps; s++) far.fillStyle(0x2b2840).fillRect(cx - (steps - s) * 26, base - (s + 1) * 30, (steps - s) * 52, 30);
      far.fillStyle(0x3a3456).fillRect(cx - 14, base - steps * 30 - 18, 28, 18);
    }
    for (let x = -30; x < W + 30; x += rnd.between(35, 60)) near.fillStyle(0x172420).fillCircle(x, rnd.between(H * 0.74, H * 0.8), rnd.between(50, 85));
    near.fillStyle(0x172420).fillRect(0, H * 0.78, W, H * 0.22);
    for (let x = -30; x < W + 30; x += rnd.between(28, 50)) near.fillStyle(0x203a2c).fillCircle(x, rnd.between(H * 0.86, H * 0.9), rnd.between(30, 50));
    // Cascada a cada lado.
    for (const x of [W * 0.03, W * 0.97 - 26]) {
      near.fillStyle(0x6a8ab0, 0.55).fillRect(x, H * 0.28, 26, H * 0.6);
      for (let y = H * 0.28; y < H * 0.88; y += 9) near.fillStyle(0xd8ecff, 0.5).fillRect(x + rnd.between(2, 18), y, 4, 6);
    }
    near.fillGradientStyle(0xd8d0e8, 0xd8d0e8, 0xd8d0e8, 0xd8d0e8, 0, 0, 0.4, 0.4).fillRect(0, H * 0.82, W, H * 0.18); // niebla
  },
  // Patio de vecindad: cielo azul, azoteas con tinacos y dos edificios con puertas numeradas.
  vecindad({ far, near, rnd, W, H, scene }) {
    far.fillGradientStyle(0x6fb8e8, 0x6fb8e8, 0xd4ecf6, 0xd4ecf6, 1).fillRect(0, 0, W, H);
    clouds(far, rnd, W, 30, H * 0.3, 10, 0xffffff, 0.8);
    for (let x = -20; x < W; x += rnd.between(60, 110)) { // azoteas lejanas
      const h = rnd.between(140, 260);
      const w = rnd.between(70, 120);
      const top = H * 0.62 - h;
      far.fillStyle(rnd.pick([0xb8a890, 0xc4b49c, 0xa89c8c, 0xc8a888])).fillRect(x, top, w, h + H);
      windows(far, rnd, x, top, w, h, 22, 0x7a8894, 0x8aa0b0, 0.2);
      if (rnd.frac() < 0.6) { // tinaco
        far.fillStyle(0x2a2a30).fillRect(x + w * 0.3, top - 18, 18, 18);
        far.fillStyle(0x3a3a44).fillEllipse(x + w * 0.3 + 9, top - 18, 18, 6);
      }
      if (rnd.frac() < 0.5) far.fillStyle(0x4a4a52).fillRect(x + w * 0.7, top - 30, 2, 30).fillRect(x + w * 0.7 - 8, top - 26, 18, 2); // antena
    }
    // Edificios del patio (cada lado con su color) y muro del fondo.
    const T = TILE;
    near.fillStyle(0xb8ad9a).fillRect(30 * T, 26 * T, 30 * T, 14 * T);
    near.fillStyle(0xa09682).fillRect(30 * T, 26 * T, 30 * T, 3);
    near.fillStyle(0x6a5a4a).fillRect(42 * T, 30 * T, 6 * T, 10 * T); // zaguán
    near.fillStyle(0x4a3c30).fillRect(42 * T + 4, 30 * T + 4, 6 * T - 8, 10 * T - 4);
    stamp(scene, near, 'VECINDAD', 45 * T, 28 * T, { fontSize: '14px', color: '#5a4a3a' });
    const facade = (x0, x1, wall, trim, doors) => {
      near.fillStyle(wall).fillRect(x0, 22 * T, x1 - x0, 18 * T);
      near.fillStyle(trim).fillRect(x0, 22 * T, x1 - x0, 4).fillRect(x0, 34 * T, x1 - x0, 6);
      for (let i = 0; i < 6; i++) near.fillStyle(0xa8553a, 0.8).fillRect(rnd.between(x0, x1 - 30), rnd.between(23 * T, 38 * T), rnd.between(10, 24), rnd.between(6, 12)); // repello caído
      // Planta alta: ventanas con marco y planta baja / media: puertas numeradas.
      doors.forEach(([dx, num, row], i) => {
        const x = x0 + dx;
        const top = row * T;
        near.fillStyle(0x5a3a22).fillRect(x - 2, top - 2, 28, 46);
        near.fillStyle(i % 2 ? 0x7a4a2a : 0x8a5a32).fillRect(x, top, 24, 44);
        near.fillStyle(0x5a3a22).fillRect(x + 3, top + 4, 18, 14).fillRect(x + 3, top + 22, 18, 18);
        near.fillStyle(0xd8b040).fillRect(x + 19, top + 24, 2, 2);
        stamp(scene, near, num, x + 12, top + 11, { fontSize: '9px', color: '#f4e8d0' });
      });
      for (let x = x0 + 24; x < x1 - 40; x += 92) {
        near.fillStyle(0x4a3424).fillRect(x, 23 * T + 6, 34, 30);
        near.fillStyle(0x9ac4dc).fillRect(x + 3, 23 * T + 9, 28, 24);
        near.fillStyle(0xd8eef8).fillRect(x + 3, 23 * T + 9, 28, 7);
        near.fillStyle(0x4a3424).fillRect(x + 16, 23 * T + 9, 2, 24);
        near.fillStyle(0xb85a34).fillRect(x - 2, 23 * T + 36, 38, 4); // jardinera
        for (let k = 0; k < 6; k++) near.fillStyle(k % 2 ? 0xff4a6a : 0x3f8a34).fillRect(x + k * 6, 23 * T + 32, 4, 4);
      }
    };
    facade(2 * T, 30 * T, 0xc9a46a, 0x8a6a44, [[60, '71', 29], [200, '72', 29], [90, '72', 36], [270, '73', 36]]);
    facade(60 * T, 88 * T, 0xe0b04a, 0x9a7428, [[60, '14', 36], [180, '8', 29], [310, '12', 29], [220, '14', 36]]);
    // Escaleras de concreto (decorado) del patio al balcón bajo.
    for (const [x0, dir] of [[36 * T, -1], [54 * T, 1]]) {
      for (let s = 0; s < 5; s++) near.fillStyle(s % 2 ? 0x9a948a : 0xb0aaa0).fillRect(x0 + dir * s * 12 - (dir < 0 ? 12 : 0), 40 * T - (s + 1) * 16, 12, (s + 1) * 16);
      near.lineStyle(2, 0x3a3a40).lineBetween(x0, 40 * T - 18, x0 + dir * 60, 35 * T - 18);
    }
    // Lavadero de piedra junto al muro.
    near.fillStyle(0xc8c4bc).fillRect(50 * T, 36 * T, 40, 4 * T);
    near.fillStyle(0xa8a49c).fillRect(50 * T, 36 * T, 40, 4);
    near.fillStyle(0x7ab0c8).fillRect(50 * T + 4, 36 * T + 4, 32, 6);
    // Tendedero entre las azoteas (la ropa ondea: MapFx).
    near.lineStyle(1, 0x3a3a40);
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const x = 24 * T + (i / 20) * 42 * T;
      pts.push([x, 21 * T - 30 + Math.sin((i / 20) * Math.PI) * 26]);
    }
    for (let i = 0; i < pts.length - 1; i++) near.lineBetween(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    near.fillStyle(0x3a3a40).fillRect(24 * T - 2, 21 * T - 44, 3, 44).fillRect(66 * T - 1, 21 * T - 44, 3, 44);
    // Alcantarilla bajo el patio: muro de ladrillo oscuro y tubos.
    near.fillStyle(0x3a2a22).fillRect(0, 43 * T, W, H - 43 * T);
    for (let y = 43 * T; y < H; y += 6) for (let x = (y / 6) % 2 ? 0 : 6; x < W; x += 12) near.fillStyle(0x2a1e18).fillRect(x, y, 1, 6);
    for (const x of [20 * T, 69 * T]) {
      near.fillStyle(0x5a5a62).fillCircle(x, 44 * T + 6, 12);
      near.fillStyle(0x1a1a1e).fillCircle(x, 44 * T + 6, 8);
    }
  },
  // Concierto de noche: torres de reflectores, pantalla gigante y público con las manos arriba.
  concierto({ far, near, rnd, W, H, scene }) {
    far.fillGradientStyle(0x070a24, 0x070a24, 0x24164a, 0x24164a, 1).fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) far.fillStyle(0xffffff, rnd.realInRange(0.2, 0.8)).fillRect(rnd.between(0, W), rnd.between(0, H * 0.45), 1, 1);
    for (let x = -20; x < W; x += rnd.between(30, 60)) far.fillStyle(0x120c2a).fillRect(x, H * 0.7 - rnd.between(30, 110), rnd.between(30, 60), H);
    for (const x of [W * 0.06, W * 0.94]) { // torres de reflectores
      far.fillStyle(0x1e2236).fillRect(x - 14, H * 0.1, 28, H);
      far.lineStyle(2, 0x2c3250);
      for (let y = H * 0.1; y < H; y += 24) far.lineBetween(x - 14, y, x + 14, y + 24).lineBetween(x + 14, y, x - 14, y + 24);
      far.fillStyle(0x2c3250).fillRect(x - 46, H * 0.06, 92, 52);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        far.fillStyle(0xf0f6ff).fillCircle(x - 33 + i * 22, H * 0.06 + 14 + j * 24, 8);
      }
      glow(far, x, H * 0.06 + 26, 40, 0xdfe8ff, 0.12);
    }
    // Fondo del escenario: pared negra, arreglos de bocinas colgantes y pantalla LED.
    const T = TILE;
    near.fillStyle(0x101018).fillRect(6 * T, 4 * T, W - 12 * T, 34 * T);
    for (let x = 6 * T; x < W - 6 * T; x += 32) near.fillStyle(0x16161f).fillRect(x, 4 * T, 2, 34 * T);
    for (const x of [26 * T, 60 * T]) {
      for (let k = 0; k < 7; k++) {
        near.fillStyle(0x1e1e28).fillRect(x, 5 * T + k * 22, 4 * T, 20);
        near.fillStyle(0x34343e).fillRect(x + 4, 5 * T + k * 22 + 4, 4 * T - 8, 12);
      }
    }
    const sx = 32 * T;
    const sw = 26 * T;
    near.fillStyle(0x3a3a46).fillRect(sx - 6, 4 * T - 6, sw + 12, 13 * T + 12);
    near.fillGradientStyle(0x3a0614, 0x3a0614, 0x8a1020, 0x8a1020, 1).fillRect(sx, 4 * T, sw, 13 * T);
    for (let y = 4 * T; y < 17 * T; y += 3) near.fillStyle(0x000000, 0.25).fillRect(sx, y, sw, 1); // líneas de LED
    stamp(scene, near, 'ARENA', sx + sw / 2, 8 * T, { fontSize: '44px', color: '#ffd8a0', stroke: '#ff3a2a', strokeThickness: 6 });
    stamp(scene, near, 'C A O S', sx + sw / 2, 13 * T, { fontSize: '40px', color: '#ffffff', stroke: '#ff2a5a', strokeThickness: 6 });
    for (const x of [22 * T, 68 * T]) { // aros LED
      near.lineStyle(4, 0x3aa8ff).strokeCircle(x, 24 * T, 34);
      near.lineStyle(2, 0xbfe6ff).strokeCircle(x, 24 * T, 26);
      glow(near, x, 24 * T, 20, 0x3aa8ff, 0.1);
    }
    // Público y vallas.
    for (let x = 0; x < W; x += 14) {
      const y = 44 * T + rnd.between(-6, 6);
      near.fillStyle(0x0a0a14).fillCircle(x + 7, y, 7).fillRect(x, y + 4, 14, H);
      if (rnd.frac() < 0.35) near.fillRect(x + (rnd.frac() < 0.5 ? 1 : 10), y - 22, 3, 18); // brazo arriba
      if (rnd.frac() < 0.08) near.fillStyle(0xe8f4ff).fillRect(x + 4, y - 26, 4, 6); // móvil grabando
    }
    near.fillStyle(0x6a7080);
    for (let x = 0; x < W; x += 120) {
      near.fillRect(x + 4, 47 * T, 108, 3).fillRect(x + 4, 49 * T, 108, 3);
      for (let k = 0; k < 108; k += 9) near.fillRect(x + 4 + k, 47 * T, 2, 2 * T + 3);
    }
  },
  // Campus UTEZ de día: edificios, el arco de la entrada con sus columnas rojas y jardines.
  utez({ far, near, rnd, W, H, scene }) {
    far.fillGradientStyle(0x6ec0ec, 0x6ec0ec, 0xd8f0fb, 0xd8f0fb, 1).fillRect(0, 0, W, H);
    clouds(far, rnd, W, 30, H * 0.3, 11, 0xffffff, 0.85);
    for (const [x, w, h] of [[0, 300, 300], [W - 300, 300, 300], [W * 0.3, 220, 200], [W * 0.56, 240, 230]]) {
      const top = H * 0.72 - h;
      far.fillStyle(0xe6d4aa).fillRect(x, top, w, h + 200);
      far.fillStyle(0xb8603e).fillRect(x, top, w, 10);
      for (let y = top + 24; y < H * 0.72; y += 46) {
        far.fillStyle(0xb8603e).fillRect(x, y + 30, w, 5);
        for (let wx = x + 10; wx < x + w - 20; wx += 30) far.fillStyle(0x6f8fa8).fillRect(wx, y, 22, 26).fillStyle(0xa8c4d8).fillRect(wx, y, 22, 6);
      }
    }
    for (let x = 0; x < W; x += rnd.between(40, 70)) {
      far.fillStyle(0x4f9a3e).fillCircle(x, H * 0.72 - rnd.between(0, 20), rnd.between(26, 40));
      far.fillStyle(0x6fba52).fillCircle(x - 6, H * 0.72 - rnd.between(10, 28), rnd.between(12, 20));
    }
    far.fillStyle(0x9a9a9e).fillRect(0, H * 0.72, W, H);
    const T = TILE;
    // Columnas rojas del arco (cilindros) y remate superior.
    for (const x of [24 * T, 66 * T]) {
      near.fillStyle(0xb8553a).fillRect(x - 40, 2 * T, 80, 34 * T);
      near.fillStyle(0xd8714e).fillRect(x - 30, 2 * T, 14, 34 * T);
      near.fillStyle(0x8a3a24).fillRect(x + 24, 2 * T, 16, 34 * T);
      near.fillStyle(0xe88a64).fillRect(x - 26, 2 * T, 4, 34 * T);
      near.fillStyle(0xd06440).fillEllipse(x, 2 * T, 80, 18);
    }
    near.fillStyle(0xeee2c4).fillRect(18 * T, 13 * T, 54 * T, 3 * T);
    near.fillStyle(0xd6c8a6).fillRect(18 * T, 15 * T + 8, 54 * T, 8);
    // Caseta de vigilancia al centro, detrás de la plaza.
    near.fillStyle(0xeee2c4).fillRect(39 * T, 24 * T, 12 * T, 11 * T);
    near.fillStyle(0xc5603e).fillEllipse(45 * T, 24 * T, 13 * T, 3 * T);
    near.fillStyle(0x2a3440).fillRect(40 * T, 26 * T, 10 * T, 5 * T);
    near.fillStyle(0x5a7a94).fillRect(40 * T + 3, 26 * T + 3, 10 * T - 6, 5 * T - 6);
    near.fillStyle(0x9ac0d8).fillRect(40 * T + 3, 26 * T + 3, 10 * T - 6, 10);
    // Muro con el logo a la izquierda y edificio con ventanas a la derecha.
    near.fillStyle(0xeee2c4).fillRect(1 * T, 20 * T, 17 * T, 15 * T);
    near.fillStyle(0xd6c8a6).fillRect(1 * T, 20 * T, 17 * T, 6);
    stamp(scene, near, 'UTEZ', 10 * T, 26 * T, { fontSize: '42px', color: '#1f6fb8', stroke: '#ffffff', strokeThickness: 4 });
    stamp(scene, near, 'UNIVERSIDAD TECNOLÓGICA', 10 * T, 30 * T, { fontSize: '10px', color: '#2a8a6a' });
    near.fillStyle(0x2a8a6a).fillRect(3 * T, 31 * T + 4, 14 * T, 3);
    near.fillStyle(0xe6d4aa).fillRect(72 * T, 18 * T, 17 * T, 17 * T);
    near.fillStyle(0xb8603e).fillRect(72 * T, 18 * T, 17 * T, 8);
    windows(near, rnd, 72 * T, 19 * T, 17 * T, 15 * T, 30, 0x6f8fa8, 0x9ac0d8, 0.3);
    // Jardinera con flores junto a la plaza y setos abajo.
    for (const [x0, x1] of [[2 * T, 22 * T], [68 * T, 88 * T]]) {
      near.fillStyle(0xe8c840).fillRect(x0, 40 * T - 6, x1 - x0, 6);
      for (let x = x0 + 4; x < x1 - 4; x += 7) near.fillStyle(rnd.pick([0xff4a8a, 0xffe066, 0xa070ff, 0xffffff])).fillRect(x, 40 * T - 11, 3, 3).fillStyle(0x3f8a34).fillRect(x + 1, 40 * T - 8, 1, 3);
    }
    // Zanja: muro de concreto con rejillas de drenaje y un aviso pegado.
    near.fillStyle(0x7a7e86).fillRect(23 * T, 36 * T, 44 * T, H - 36 * T);
    for (let y = 36 * T; y < H; y += 16) near.fillStyle(0x6a6e76).fillRect(23 * T, y, 44 * T, 1);
    for (const x of [32 * T, 55 * T]) {
      near.fillStyle(0x2a2c30).fillRect(x, 44 * T, 3 * T, 2 * T);
      for (let k = 4; k < 3 * T; k += 6) near.fillStyle(0x6a6e76).fillRect(x + k, 44 * T, 2, 2 * T);
    }
    near.fillStyle(0xf0e8d0).fillRect(44 * T, 43 * T, 20, 24);
    near.fillStyle(0x9a8a6a).fillRect(44 * T + 3, 43 * T + 4, 14, 2).fillRect(44 * T + 3, 43 * T + 9, 10, 2);
  },
};
