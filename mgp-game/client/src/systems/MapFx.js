import Phaser from 'phaser';
import { TILE } from '../level.js';
import { isHighQuality, onQualityChange } from './Gfx.js';

// Ambiente vivo de cada mapa (todo local y cosmético, nada viaja por red):
//  - clima / partículas flotantes según theme.ambient;
//  - fuego de antorchas;
//  - extras por tema: haces de focos y fuegos artificiales (concierto), ropa tendida que ondea
//    (vecindad), humo de chimeneas (fábrica y cabañas), pájaros (campus).
// Devuelve los objetos creados para que la escena los destruya al cambiar de mapa.
export default function createMapFx(scene, map, anchors = {}) {
  const objs = [];
  const keep = (o) => (objs.push(o), o);
  const W = map.width;
  const H = map.height;

  const ambient = {
    snow: { x: { min: 0, max: W }, y: -10, speedY: { min: 25, max: 60 }, speedX: { min: -20, max: 20 }, lifespan: 18000, scale: { min: 0.4, max: 1 }, alpha: { min: 0.6, max: 1 }, tint: 0xffffff, frequency: 45 },
    dust: { x: { min: W * 0.15, max: W * 0.85 }, y: { min: 120, max: 480 }, speedX: { min: -6, max: 6 }, speedY: { min: -4, max: 4 }, lifespan: 5000, scale: 0.5, alpha: { start: 0, end: 0.5, ease: 'Sine.easeInOut' }, tint: 0xfff3d0, frequency: 150 },
    fireflies: { x: { min: 0, max: W }, y: { min: 160, max: 700 }, speedX: { min: -15, max: 15 }, speedY: { min: -12, max: 12 }, lifespan: 3500, scale: { start: 0.7, end: 0.2 }, alpha: { start: 1, end: 0 }, tint: [0xd8ff6a, 0xfff07a], frequency: 110, blendMode: 'ADD' },
    leaves: { x: { min: 0, max: W }, y: -10, speedY: { min: 30, max: 60 }, speedX: { min: 10, max: 50 }, lifespan: 16000, scale: { min: 0.6, max: 1 }, rotate: { min: 0, max: 360 }, tint: [0x8a9a3a, 0xb8902e, 0x6a8a2e], frequency: 500 },
    confetti: { x: { min: W * 0.2, max: W * 0.8 }, y: -10, speedY: { min: 40, max: 90 }, speedX: { min: -30, max: 30 }, lifespan: 12000, scale: { min: 0.4, max: 0.8 }, tint: [0xff3a6a, 0x3aa8ff, 0xffd23a, 0x6cff8a, 0xffffff], frequency: 120 },
    petals: { x: { min: 0, max: W }, y: -10, speedY: { min: 25, max: 50 }, speedX: { min: 15, max: 45 }, lifespan: 18000, scale: { min: 0.4, max: 0.8 }, tint: [0xff9ad0, 0xffffff, 0xc89aff], frequency: 260 },
  }[map.theme.ambient];
  if (ambient) keep(scene.add.particles(0, 0, 'pixel', ambient).setDepth(9));

  if (map.theme.lamp === 'torch') {
    for (const d of map.decor.filter((t) => t.type === 'i')) {
      keep(scene.add.particles(d.c * TILE + 8, d.r * TILE + 3, 'puff', {
        speedY: { min: -45, max: -20 }, speedX: { min: -8, max: 8 }, lifespan: { min: 250, max: 450 },
        scale: { start: 0.9, end: 0 }, tint: [0xffe066, 0xffa030, 0xff5a00], frequency: 40, blendMode: 'ADD',
      }).setDepth(5));
    }
  }

  EXTRAS[map.theme.style]?.(scene, map, keep, W, H, anchors);
  return objs;
}

// Humo que sube de un punto (chimenea), detrás del mapa.
function smoke(scene, keep, x, y, tint = 0x8a8494, scale = 1.4) {
  keep(scene.add.particles(x, y, 'puff', {
    speedY: { min: -40, max: -20 }, speedX: { min: 4, max: 16 }, lifespan: 3200,
    scale: { start: scale, end: scale * 4 }, alpha: { start: 0.45, end: 0 }, tint, frequency: 180,
  }).setDepth(-9.5).setScrollFactor(0.55));
}

const EXTRAS = {
  snow(scene, map, keep, W, H) {
    const sea = H * 0.63;
    for (const cx of [W * 0.12, W * 0.34, W * 0.66, W * 0.88]) {
      keep(scene.add.particles(cx + 10, sea - 36, 'puff', {
        speedY: { min: -18, max: -8 }, speedX: { min: 2, max: 8 }, lifespan: 2600,
        scale: { start: 0.6, end: 2 }, alpha: { start: 0.4, end: 0 }, tint: 0xe8eef4, frequency: 260,
      }).setDepth(-9.5));
    }
  },

  factory(scene, map, keep, W, H, anchors) {
    for (const c of anchors.chimneys ?? []) smoke(scene, keep, c.x, c.y); // las chimeneas del fondo
  },

  vecindad(scene, map, keep) {
    // Ropa tendida: cuelga del tendedero y se mece con el viento.
    const x0 = 24 * TILE;
    const span = 42 * TILE;
    const clothes = [
      [0.12, 0xffffff, 14, 18], [0.2, 0x3a6ab8, 10, 22], [0.28, 0xd84a4a, 16, 14], [0.4, 0xffffff, 26, 22],
      [0.52, 0xf0f0f0, 30, 26], [0.64, 0x4a9a5a, 10, 20], [0.74, 0xffd23a, 14, 16], [0.86, 0x8a5ad8, 12, 18],
    ];
    for (const [t, color, w, h] of clothes) {
      const x = x0 + t * span;
      const y = 21 * TILE - 30 + Math.sin(t * Math.PI) * 26;
      const cloth = keep(scene.add.rectangle(x, y, w, h, color).setOrigin(0.5, 0).setDepth(-9).setStrokeStyle(1, 0x000000, 0.25));
      scene.tweens.add({ targets: cloth, angle: { from: -7, to: 7 }, duration: Phaser.Math.Between(900, 1400), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: t * 600 });
    }
  },

  concierto(scene, map, keep, W, H) {
    const keepTimer = (t) => keep({ destroy: () => t.remove() });
    const hq = isHighQuality();
    // Haces de los focos del rig: triángulos aditivos que barren el escenario.
    const colors = [0xff3a6a, 0x3aa8ff, 0xffd23a, 0x8a5aff];
    const beams = [];
    map.decor.filter((d) => d.type === 'i').forEach((d, i) => {
      const x = d.c * TILE + TILE / 2;
      const y = d.r * TILE + 12;
      const beam = keep(scene.add.graphics({ x, y }).setDepth(8.7).setBlendMode(Phaser.BlendModes.ADD));
      const len = H - y;
      beam.fillStyle(colors[i % colors.length], 0.16).fillTriangle(0, 0, -70, len, 70, len);
      beam.fillStyle(colors[i % colors.length], 0.12).fillTriangle(0, 0, -28, len, 28, len);
      beam.angle = i % 2 ? 18 : -18;
      beams.push(beam.setVisible(hq));
      scene.tweens.add({ targets: beam, angle: i % 2 ? -18 : 18, duration: 2200 + i * 260, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    });
    const off = onQualityChange(() => beams.forEach((bm) => bm.active && bm.setVisible(isHighQuality())));
    keep({ destroy: off });
    // Fuegos artificiales en el cielo cada poco.
    const burst = keep(scene.add.particles(0, 0, 'pixel', {
      speed: { min: 60, max: 210 }, lifespan: { min: 700, max: 1300 }, gravityY: 70,
      scale: { start: 1.1, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
    }).setDepth(-9).setScrollFactor(0.55));
    const fire = () => {
      if (!burst.active) return;
      burst.setParticleTint(Phaser.Utils.Array.GetRandom([0xff3a6a, 0x3aa8ff, 0xffd23a, 0x6cff8a, 0xffffff]));
      burst.explode(hq ? 46 : 20, Phaser.Math.Between(W * 0.15, W * 0.85), Phaser.Math.Between(40, 200));
    };
    keepTimer(scene.time.addEvent({ delay: 1300, loop: true, callback: fire }));
    // Llamaradas (pirotecnia) en el borde del escenario, solo decorativas.
    for (const x of [10 * TILE, 79 * TILE]) {
      const jet = keep(scene.add.particles(x, 38 * TILE, 'puff', {
        speedY: { min: -360, max: -220 }, speedX: { min: -20, max: 20 }, lifespan: 600,
        scale: { start: 2.4, end: 0 }, tint: [0xffffcc, 0xffcc33, 0xff6a00], blendMode: 'ADD', emitting: false,
      }).setDepth(5));
      keepTimer(scene.time.addEvent({ delay: 5200, loop: true, startAt: x > W / 2 ? 2600 : 0, callback: () => jet.active && jet.explode(40) }));
    }
  },

  utez(scene, map, keep, W) {
    const keepTimer = (t) => keep({ destroy: () => t.remove() });
    // Parvada que cruza el cielo de vez en cuando.
    const bird = () => {
      const g = scene.add.graphics().setDepth(-9).setScrollFactor(0.55);
      birds.add(g);
      g.once('destroy', () => birds.delete(g));
      g.lineStyle(2, 0x2a2e36);
      for (let k = 0; k < 4; k++) {
        const bx = k * 22 + (k % 2) * 6;
        const by = (k % 2) * 10;
        g.lineBetween(bx - 6, by - 3, bx, by).lineBetween(bx, by, bx + 6, by - 3);
      }
      const y = Phaser.Math.Between(40, 160);
      g.setPosition(-100, y);
      scene.tweens.add({ targets: g, x: W + 100, y: y - 40, duration: 16000, onComplete: () => g.destroy() });
    };
    const birds = new Set(); // los que siguen volando al cambiar de mapa se destruyen con él
    keep({ destroy: () => [...birds].forEach((b) => b.destroy()) });
    bird();
    keepTimer(scene.time.addEvent({ delay: 20000, loop: true, callback: bird }));
  },
};
