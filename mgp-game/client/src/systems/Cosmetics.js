import { KNOT, SKIN_H } from '../skins.js';

// Detalles visuales de un personaje (local, bot o rival) que no viajan por red:
//  - colas del pañuelo: cadena de puntos con física verlet que cuelga del nudo y ondea al moverse;
//  - sombra bajo los pies cuando está en el suelo.
// Se actualiza en 'postupdate', con la posición final del frame. Coste: 2 dibujos pequeños por personaje.
const LINKS = 6;
const LINK_LEN = 3.6;
const DAMPING = 0.86;
const GRAVITY = 0.16; // px por frame² (a 60 FPS)
const SNAP = 40; // si el nudo salta más que esto (reaparición), recolocar la cadena
const OUTLINE = 0x12101a;
const GROUNDED = new Set(['idle', 'run0', 'run1', 'run2', 'run3']);

function ensureShadowTexture(scene) {
  if (scene.textures.exists('shadow')) return;
  const g = scene.make.graphics({ add: false });
  g.fillStyle(0x000000, 0.5).fillEllipse(9, 3, 18, 6);
  g.fillStyle(0x000000, 0.4).fillEllipse(9, 3, 12, 4);
  g.generateTexture('shadow', 18, 6);
  g.destroy();
}

export default class Cosmetics {
  constructor(scene, sprite) {
    this.scene = scene;
    this.sprite = sprite;
    this.points = null; // [{ x, y, px, py }]
    this.scarf = scene.add.graphics().setDepth(sprite.depth - 0.1);
    ensureShadowTexture(scene);
    this.shadow = scene.add.image(0, 0, 'shadow').setDepth(sprite.depth - 0.2).setAlpha(0.6).setVisible(false);
    scene.events.on('postupdate', this.update, this);
    sprite.once('destroy', () => this.destroy());
  }

  update(_time, delta) {
    const s = this.sprite;
    const shown = s.active && s.visible && s.alive;
    this.scarf.clear();
    this.shadow.setVisible(shown && GROUNDED.has(s.pose));
    if (!shown) {
      this.points = null;
      return;
    }
    this.shadow.setPosition(s.x, s.y + SKIN_H / 2 - 2);

    const dir = s.flipX ? -1 : 1;
    const ax = s.x + KNOT.x * dir;
    const ay = s.y + KNOT.y;
    if (!this.points || Math.hypot(this.points[0].x - ax, this.points[0].y - ay) > SNAP) {
      this.points = Array.from({ length: LINKS }, (_, i) => {
        const x = ax - dir * i * LINK_LEN;
        return { x, y: ay + i, px: x, py: ay + i };
      });
    }

    // Integración verlet (escalada al frame real) + viento: tira hacia atrás y aletea.
    const k = Math.min(delta / 16.67, 2);
    const t = this.scene.time.now;
    const pts = this.points;
    pts[0].x = ax;
    pts[0].y = ay;
    for (let i = 1; i < LINKS; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * DAMPING;
      const vy = (p.y - p.py) * DAMPING;
      p.px = p.x;
      p.py = p.y;
      p.x += vx - dir * 0.06 * k;
      p.y += vy + (GRAVITY + Math.sin(t * 0.013 + i * 1.3) * 0.12) * k;
    }
    // Restricciones de distancia (2 pasadas bastan para tan pocos eslabones).
    for (let it = 0; it < 2; it++) {
      for (let i = 1; i < LINKS; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = LINK_LEN / d;
        b.x = a.x + dx * f;
        b.y = a.y + dy * f;
      }
    }

    // Dibujo: contorno oscuro y encima el color, afinando hacia la punta.
    const g = this.scarf;
    for (const [extra, color] of [[2, OUTLINE], [0, s.color]]) {
      for (let i = 1; i < LINKS; i++) {
        const w = Math.max(1, 3 - (i - 1) * 0.5) + extra;
        g.lineStyle(w, color).lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      }
    }
  }

  destroy() {
    this.scene.events.off('postupdate', this.update, this);
    this.scarf.destroy();
    this.shadow.destroy();
  }
}
