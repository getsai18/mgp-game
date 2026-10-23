import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, TILE } from '../level.js';
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
    this.dark = s.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, ambient)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(DEPTH_DARK).setVisible(this.enabled);
    objects.push(this.dark);

    this.torches = map.decor.filter((d) => d.type === 'i').map((d) => {
      const x = d.c * TILE + TILE / 2;
      const y = d.r * TILE + 2;
      const img = this.light(x, y, 110, 0xff9a40, 0.9);
      objects.push(img);
      return { img, base: 110 / LIGHT_TEX_R, seed: Math.random() * 100 };
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
      const f = Math.sin(time * 0.011 + t.seed) * 0.05 + Math.sin(time * 0.029 + t.seed * 2) * 0.04;
      t.img.setScale(t.base * (1 + f)).setAlpha(0.8 + f * 1.5);
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
