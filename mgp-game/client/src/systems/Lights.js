import Phaser from 'phaser';
import { TILE } from '../level.js';
import { isHighQuality, onQualityChange } from './Gfx.js';

// Iluminación barata (sin Light2D ni mapas de normales):
//  - una capa de "oscuridad" que multiplica el mundo por el color ambiente del mapa;
//  - luces aditivas encima: antorchas que parpadean, fogonazos, explosiones y cohetes.
// Todo local y cosmético. Con calidad baja no se dibuja nada.
const DEPTH_DARK = 8.5; // por encima de mapa, jugadores y armas; por debajo de partículas de ambiente
const DEPTH_LIGHT = 8.6;
const LIGHT_TEX_R = 64; // radio de la textura 'light' (BootScene)

// Textura de luz: círculo blanco con caída suave hacia el borde.
export function generateLightTexture(scene) {
  const g = scene.make.graphics({ add: false });
  const steps = 32;
  for (let i = steps; i > 0; i--) {
    const k = i / steps;
    g.fillStyle(0xffffff, 0.045 * (1 - k) ** 0.6 + 0.004).fillCircle(LIGHT_TEX_R, LIGHT_TEX_R, LIGHT_TEX_R * k);
  }
  g.generateTexture('light', LIGHT_TEX_R * 2, LIGHT_TEX_R * 2);
  g.destroy();
  // El juego usa pixelArt (filtro NEAREST): la luz, escalada, saldría en anillos escalonados.
  scene.textures.get('light').setFilter(Phaser.Textures.FilterMode.LINEAR);
}

// Luz de cada tipo de lámpara: color (o colores alternos), radio, desplazamiento vertical y animación.
const LAMPS = {
  torch: { color: 0xff9a40, radius: 110, dy: 2, alpha: 0.9, mode: 'flicker' },
  lantern: { color: 0xffc070, radius: 120, dy: -16, alpha: 0.85, mode: 'flicker' },
  beacon: { color: 0xffa020, radius: 120, dy: 7, alpha: 0.9, mode: 'pulse' },
  wall: { color: 0xffd890, radius: 95, dy: 8, alpha: 0.8, mode: 'steady' },
  spot: { color: [0xff3a6a, 0x3aa8ff, 0xffd23a, 0x8a5aff], radius: 120, dy: 12, alpha: 0.9, mode: 'steady' },
  street: { color: 0xfff2c0, radius: 90, dy: -24, alpha: 0.6, mode: 'steady' },
};

export default class Lights {
  constructor(scene) {
    this.scene = scene;
    this.dark = null;
    this.torches = []; // { img, base }
    this.boost = 1; // intensidad de las luces en el mapa actual (en mapas claros se nota menos)
    this.enabled = isHighQuality();
    const off = onQualityChange(() => this.setEnabled(isHighQuality()));
    scene.events.once('shutdown', off);
  }

  // Imagen de luz con radio `radius` px.
  light(x, y, radius, color, alpha, depth = DEPTH_LIGHT) {
    return this.scene.add.image(x, y, 'light')
      .setScale(radius / LIGHT_TEX_R).setTint(color).setAlpha(alpha)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setVisible(this.enabled);
  }

  // Al construir un mapa. Devuelve los objetos creados para que la escena los destruya al cambiarlo.
  setMap(map) {
    const s = this.scene;
    const objects = [];
    const ambient = map.theme.ambientLight ?? 0xffffff;
    this.boost = map.theme.lightBoost ?? 1;
    // Margen alrededor del mapa: con la sacudida de cámara no debe asomar el borde de la capa.
    // Imagen (no rectángulo): en Canvas 2D las formas ignoran el MULTIPLY y taparían el mapa.
    this.dark = s.add.image(map.width / 2, map.height / 2, 'pixel').setDisplaySize(map.width + 400, map.height + 400).setTint(ambient)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(DEPTH_DARK).setVisible(this.enabled);
    objects.push(this.dark);

    // Cada tema ilumina sus lámparas ('i') a su manera (ver LAMPS).
    const lamp = LAMPS[map.theme.lamp ?? 'torch'];
    this.torches = map.decor.filter((d) => d.type === 'i').map((d, i) => {
      const x = d.c * TILE + TILE / 2;
      const y = d.r * TILE + lamp.dy;
      const color = Array.isArray(lamp.color) ? lamp.color[i % lamp.color.length] : lamp.color;
      const img = this.light(x, y, lamp.radius, color, lamp.alpha);
      objects.push(img);
      return { img, base: lamp.radius / LIGHT_TEX_R, seed: Math.random() * 100, mode: lamp.mode, alpha: lamp.alpha };
    });
    return objects;
  }

  setEnabled(on) {
    this.enabled = on;
    this.dark?.active && this.dark.setVisible(on);
    for (const t of this.torches) if (t.img.active) t.img.setVisible(on);
  }

  // Parpadeo de antorchas (dos senos desfasados: barato y sin patrón visible).
  update(time) {
    if (!this.enabled) return;
    for (const t of this.torches) {
      if (t.mode === 'pulse') {
        // Baliza giratoria: destello cada ~1.2 s.
        const k = Math.max(0, Math.sin(time * 0.0052 + t.seed)) ** 6;
        t.img.setScale(t.base * (0.7 + k * 0.5)).setAlpha(0.25 + k * 0.75);
      } else if (t.mode === 'steady') {
        t.img.setAlpha(t.alpha * (0.95 + Math.sin(time * 0.003 + t.seed) * 0.05));
      } else {
        const f = Math.sin(time * 0.011 + t.seed) * 0.05 + Math.sin(time * 0.029 + t.seed * 2) * 0.04;
        t.img.setScale(t.base * (1 + f)).setAlpha(0.8 + f * 1.5);
      }
    }
  }

  // Destello breve (fogonazo, explosión, impacto).
  flash(x, y, radius, color, ms, alpha = 1) {
    if (!this.enabled) return;
    const img = this.light(x, y, radius, color, alpha * this.boost);
    this.scene.tweens.add({ targets: img, alpha: 0, scale: img.scale * 0.6, duration: ms, ease: 'Quad.easeOut', onComplete: () => img.destroy() });
  }

  // Luz que sigue a un objeto (cohete) y se destruye con él.
  attach(target, radius, color, alpha = 0.8) {
    if (!this.enabled) return;
    const img = this.light(target.x, target.y, radius, color, alpha * this.boost);
    target.light = img;
    target.once('destroy', () => img.destroy());
  }

  follow(target) {
    target.light?.setPosition(target.x, target.y);
  }
}
