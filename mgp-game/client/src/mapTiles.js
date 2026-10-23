import Phaser from 'phaser';
import { TILE, GAME_WIDTH, GAME_HEIGHT } from './level.js';

// Dibujo de los mapas por código (sin assets). Cada tema tiene su paleta y su forma de pintar
// bloques, plataformas finas, decorados y fondo. La escena hornea el resultado en texturas
// una sola vez por mapa, así que el detalle no cuesta rendimiento.

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
    wall: 0xe9d3a6, wallDark: 0xd2b98a, spike: 0xd0d6dc, spikeDark: 0x7a8088,
  },
  temple: {
    base: 0x7a7258, dark: 0x534d3a, light: 0x9c9474, cap: 0x4f8f3a, capLight: 0x74b84f,
    special: 0x8a7a50, specialLight: 0xb09c66, specialDark: 0x5e5236, gold: 0xd4a83a,
    plank: 0x8a5a2a, plankDark: 0x5e3c1a, rope: 0x3f7a2e, pillar: 0x948c6c, pillarLight: 0xb0a888, pillarDark: 0x6a6450,
    vine: 0x3f8a34, leaf: 0x5cb848,
  },
};

export function drawMapTiles(scene, map) {
  const g = scene.make.graphics({ add: false });
  const { rows } = map;
  const style = map.theme.style;
  const P = PALETTES[style];
  const H = rows.length;
  const W = rows[0].length;
  const at = (r, c) => (r >= 0 && r < H && c >= 0 && c < W ? rows[r][c] : '.');
  const solid = (r, c) => at(r, c) === '#' || at(r, c) === '%';
  const rnd = new Phaser.Math.RandomDataGenerator([map.name]); // determinista: igual en ambos clientes

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
    drawClock(g, map);
  }
  for (const d of map.decor) if (d.type === '|') drawPillar(g, d, P, style, at);

  // 2) Árboles (detrás de los bloques sobre los que se apoyan).
  for (const d of map.decor) if (d.type === 'T') drawPine(g, d.c * TILE + TILE / 2, (d.r + 1) * TILE);

  // 3) Bloques sólidos.
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!solid(r, c)) continue;
      const ctx = { g, P, rnd, x: c * TILE, y: r * TILE, r, c, top: !solid(r - 1, c), bottom: !solid(r + 1, c), left: !solid(r, c - 1), right: !solid(r, c + 1) };
      if (at(r, c) === '%') SPECIAL[style](ctx);
      else BLOCK[style](ctx);
    }
  }

  // 4) Plataformas finas, pinchos, lianas y antorchas.
  for (const o of map.oneWays) PLANK[style](g, o, P);
  for (const s of map.spikes) drawSpikes(g, s, P);
  for (const d of map.decor) {
    if (d.type === 'v') drawVine(g, d, P, rnd, at);
    if (d.type === 'i') drawTorch(g, d);
  }
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
      if (rnd.frac() < 0.5) g.fillStyle(0xd8f0ff).fillTriangle(x + 4, y + TILE, x + 8, y + TILE, x + 6, y + TILE + rnd.between(3, 6));
    }
    if (top) {
      g.fillStyle(P.cap).fillRect(x - (left ? 1 : 0), y - 2, TILE + (left ? 1 : 0) + (right ? 1 : 0), 6);
      g.fillStyle(P.capShade).fillRect(x, y + 4, TILE, 1);
      if (rnd.frac() < 0.5) g.fillStyle(P.cap).fillRect(x + rnd.between(2, 11), y + 4, 3, 2); // nieve que gotea
    }
  },
  // Viga metálica con remaches y borde rojo arriba.
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
      g.fillStyle(P.dark).fillRect(x, y + TILE - 3, TILE, 3);
      g.lineStyle(1, P.dark, 0.7).lineBetween(x, y + TILE, x + TILE / 2, y + TILE + 3).lineBetween(x + TILE / 2, y + TILE + 3, x + TILE, y + TILE);
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
};

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
};

function brackets(g, o, color) {
  g.fillStyle(color);
  for (const bx of [o.x + 3, o.x + o.w - 6]) g.fillTriangle(bx, o.y + 6, bx + 3, o.y + 6, bx + 1, o.y + 11);
}

// --------------------------------------------------------------- decorados
function drawBackWall(g, { r, c }, P, inRoom) {
  const x = c * TILE;
  const y = r * TILE;
  g.fillStyle(P.wall).fillRect(x, y, TILE, TILE);
  if (c % 6 === 0) g.fillStyle(P.wallDark).fillRect(x, y, 1, TILE); // juntas de paneles
  if (!inRoom(r + 1, c)) g.fillStyle(P.wallDark).fillRect(x, y + TILE - 4, TILE, 4); // zócalo
  if (!inRoom(r - 1, c)) g.fillStyle(0x000000, 0.15).fillRect(x, y, TILE, 3); // sombra del techo
}

function drawPillar(g, { r, c }, P, style, at) {
  const cx = c * TILE + TILE / 2;
  const y = r * TILE;
  if (style === 'snow') {
    g.fillStyle(P.pillar).fillRect(cx - 2, y, 4, TILE);
    g.fillStyle(P.pillarLight).fillRect(cx - 2, y, 1, TILE);
  } else if (style === 'factory') {
    g.fillStyle(P.pillar).fillRect(cx - 4, y, 8, TILE);
    g.fillStyle(P.pillarLight).fillRect(cx - 4, y, 2, TILE);
    g.fillStyle(P.pillarDark).fillRect(cx + 2, y, 2, TILE);
    if (at(r - 1, c) !== '|') g.fillStyle(P.pillarDark).fillRect(cx - 6, y, 12, 3); // capitel
    g.fillStyle(P.pillarDark).fillRect(cx - 1, y + 7, 2, 2); // perno
  } else {
    g.fillStyle(P.pillar).fillRect(cx - 5, y, 10, TILE);
    g.fillStyle(P.pillarDark).fillRect(cx - 2, y, 1, TILE).fillRect(cx + 2, y, 1, TILE); // estrías
    g.fillStyle(P.pillarLight).fillRect(cx - 5, y, 2, TILE);
    if (at(r - 1, c) !== '|') g.fillStyle(P.pillarDark).fillRect(cx - 7, y, 14, 3);
  }
}

function drawClock(g, map) {
  const top = Math.min(...map.decor.filter((d) => d.type === 'b').map((d) => d.r));
  const x = GAME_WIDTH / 2;
  const y = top * TILE + 28;
  g.fillStyle(0x333333).fillCircle(x, y, 10);
  g.fillStyle(0xf4f4f4).fillCircle(x, y, 8);
  g.lineStyle(2, 0x222222).lineBetween(x, y, x, y - 6).lineBetween(x, y, x + 4, y + 2);
}

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

function drawTorch(g, { r, c }) {
  const x = c * TILE + TILE / 2;
  const y = r * TILE;
  g.fillStyle(0x5a3a1a).fillRect(x - 1, y + 6, 3, 10);
  g.fillStyle(0x7a5a2a).fillRect(x - 3, y + 4, 7, 3);
}

function drawSpikes(g, s, P) {
  g.fillStyle(P.spikeDark).fillRect(s.x, s.y + s.h - 2, s.w, 2);
  for (let x = s.x; x < s.x + s.w; x += 5) {
    g.fillStyle(P.spike).fillTriangle(x, s.y + s.h - 2, x + 5, s.y + s.h - 2, x + 2.5, s.y - 1);
    g.fillStyle(0xffffff, 0.7).fillRect(x + 2, s.y + 1, 1, 3);
  }
}

// ------------------------------------------------------------------ fondos
export function drawMapBackground(scene, map) {
  const g = scene.make.graphics({ add: false });
  const rnd = new Phaser.Math.RandomDataGenerator([`${map.name}-bg`]);
  BACKGROUND[map.theme.style](g, rnd);
  return g;
}

function mountains(g, rnd, color, baseY, minH, maxH, capColor) {
  for (let x = -60; x < GAME_WIDTH + 60; x += rnd.between(70, 130)) {
    const w = rnd.between(140, 240);
    const h = rnd.between(minH, maxH);
    g.fillStyle(color).fillTriangle(x, baseY, x + w, baseY, x + w / 2, baseY - h);
    if (capColor) g.fillStyle(capColor).fillTriangle(x + w / 2 - w * 0.12, baseY - h * 0.76, x + w / 2 + w * 0.12, baseY - h * 0.76, x + w / 2, baseY - h);
  }
}

const BACKGROUND = {
  // Atardecer cálido, montañas nevadas y mar congelado con témpanos.
  snow(g, rnd) {
    g.fillGradientStyle(0xf1b48a, 0xf1b48a, 0xf8e2c4, 0xf8e2c4, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fillStyle(0xfff3d6, 0.9).fillCircle(770, 120, 34);
    for (let i = 0; i < 6; i++) g.fillStyle(0xffffff, 0.5).fillEllipse(rnd.between(0, GAME_WIDTH), rnd.between(40, 200), rnd.between(60, 140), rnd.between(14, 26));
    mountains(g, rnd, 0xc7d3e0, 360, 120, 220, 0xffffff);
    mountains(g, rnd, 0xa9bccf, 370, 60, 130, 0xf0f6ff);
    g.fillStyle(0xb5d3e6).fillRect(0, 360, GAME_WIDTH, GAME_HEIGHT - 360);
    for (let i = 0; i < 18; i++) g.fillStyle(0xd8ecf7).fillRect(rnd.between(0, GAME_WIDTH), rnd.between(370, 520), rnd.between(30, 90), 2);
    for (let i = 0; i < 10; i++) g.fillStyle(0xf4fbff).fillEllipse(rnd.between(0, GAME_WIDTH), rnd.between(380, 500), rnd.between(24, 60), rnd.between(6, 12));
  },
  // Selva oscura con capas de follaje.
  factory(g, rnd) {
    g.fillGradientStyle(0x2a4a33, 0x2a4a33, 0x0d1d14, 0x0d1d14, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    for (let x = -30; x < GAME_WIDTH + 30; x += rnd.between(40, 70)) g.fillStyle(0x1f4029).fillCircle(x, rnd.between(170, 240), rnd.between(50, 80));
    g.fillStyle(0x1f4029).fillRect(0, 220, GAME_WIDTH, GAME_HEIGHT - 220);
    for (let x = -20; x < GAME_WIDTH + 20; x += rnd.between(60, 110)) {
      g.fillStyle(0x15291b).fillRect(x, 260, rnd.between(8, 14), GAME_HEIGHT - 260);
      g.fillStyle(0x2a5734).fillCircle(x + 5, rnd.between(260, 320), rnd.between(40, 60));
    }
    for (let x = -20; x < GAME_WIDTH + 20; x += rnd.between(30, 50)) g.fillStyle(0x2f6b35).fillCircle(x, GAME_HEIGHT + 6, rnd.between(26, 44));
    for (let i = 0; i < 14; i++) {
      const vx = rnd.between(0, GAME_WIDTH);
      g.fillStyle(0x163020).fillRect(vx, 0, 2, rnd.between(40, 140)); // lianas lejanas
    }
  },
  // Crepúsculo con luna y estrellas, zigurat lejano, copas de árboles y niebla abajo.
  temple(g, rnd) {
    g.fillGradientStyle(0x1b1d3a, 0x1b1d3a, 0x5a3d4a, 0x5a3d4a, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    for (let i = 0; i < 40; i++) g.fillStyle(0xffffff, rnd.realInRange(0.3, 0.9)).fillRect(rnd.between(0, GAME_WIDTH), rnd.between(0, 260), 1, 1);
    g.fillStyle(0xf0e6c8, 0.9).fillCircle(170, 90, 24);
    g.fillStyle(0x1b1d3a, 0.9).fillCircle(180, 84, 20);
    for (const [cx, base, steps] of [[140, 400, 5], [830, 390, 4]]) {
      for (let s = 0; s < steps; s++) g.fillStyle(0x2b2840).fillRect(cx - (steps - s) * 22, base - (s + 1) * 26, (steps - s) * 44, 26);
    }
    for (let x = -30; x < GAME_WIDTH + 30; x += rnd.between(35, 60)) g.fillStyle(0x172420).fillCircle(x, rnd.between(380, 430), rnd.between(40, 70));
    g.fillStyle(0x172420).fillRect(0, 420, GAME_WIDTH, GAME_HEIGHT - 420);
    g.fillGradientStyle(0xd8d0e8, 0xd8d0e8, 0xd8d0e8, 0xd8d0e8, 0, 0, 0.35, 0.35).fillRect(0, 440, GAME_WIDTH, GAME_HEIGHT - 440); // niebla
  },
};
