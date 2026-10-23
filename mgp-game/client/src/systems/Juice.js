import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../level.js';

const MAX_CASINGS = 40;
const TRAIL_MIN_SPEED = 380;
const TRAIL_EVERY_MS = 35;

// Phaser (WebGL) re-tesela un Graphics en cada frame: lo estático se dibuja una vez en un RenderTexture.
export function bake(scene, graphics) {
  const rt = scene.add.renderTexture(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0);
  rt.draw(graphics);
  graphics.destroy();
  return rt;
}

// Efectos de "juice": hit-stop, cámara lenta, kill-cam, casquillos, ondas expansivas, estelas.
// Todo es local y cosmético: nunca afecta a lo que se envía por red.
export default class Juice {
  constructor(scene, platforms) {
    this.scene = scene;
    const cam = scene.cameras.main;
    cam.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Cámara de interfaz: el zoom/shake de la principal no mueve el HUD.
    // Todo objeto nuevo la ignora salvo que se marque con ui().
    this.uiCam = scene.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT).setName('ui');
    for (const obj of scene.children.list) this.uiCam.ignore(obj);
    scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (obj) => !obj.isUI && this.uiCam.ignore(obj));

    this.hitStopUntil = 0;
    this.slowUntil = 0;
    this.killCamBusy = false;
    this.trailTimers = new Map();

    // Casquillos con física: rebotan en las plataformas.
    this.casings = scene.physics.add.group({ bounceY: 0.45, dragX: 120, collideWorldBounds: true });
    scene.physics.add.collider(this.casings, platforms);

    this.smokeLinger = scene.add.particles(0, 0, 'puff', {
      speedX: { min: -25, max: 25 }, speedY: { min: -60, max: -15 }, lifespan: { min: 900, max: 1600 },
      scale: { start: 1.6, end: 4 }, alpha: { start: 0.35, end: 0 }, tint: [0x555566, 0x444455, 0x333344],
      emitting: false,
    }).setDepth(4);
    this.tracer = scene.add.particles(0, 0, 'pixel', {
      lifespan: 110, scale: { start: 0.7, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: 0xffdd66, emitting: false,
    }).setDepth(4);

    this.vignette = this.ui(this.makeVignette());
  }

  ui(obj) {
    obj.isUI = true;
    obj.cameraFilter &= ~this.uiCam.id;
    this.scene.cameras.main.ignore(obj);
    return obj;
  }

  makeVignette() {
    const g = this.scene.make.graphics({ add: false });
    for (let i = 0; i < 6; i++) {
      g.lineStyle(10, 0xff0022, 0.5 - i * 0.08);
      g.strokeRect(i * 10 + 5, i * 10 + 5, GAME_WIDTH - i * 20 - 10, GAME_HEIGHT - i * 20 - 10);
    }
    return bake(this.scene, g).setDepth(150).setAlpha(0);
  }

  // ----------------------------------------------------------------- tiempo
  hitStop(ms) {
    const world = this.scene.physics.world;
    this.hitStopUntil = Math.max(this.hitStopUntil, performance.now() + ms);
    if (!world.isPaused) world.pause();
  }

  slowMo(ms, speed) {
    this.scene.physics.world.timeScale = 1 / speed; // Arcade: timeScale > 1 = más lento
    this.slowUntil = performance.now() + ms;
  }

  update() {
    const now = performance.now();
    const world = this.scene.physics.world;
    if (world.isPaused && now >= this.hitStopUntil) world.resume();
    if (this.slowUntil && now >= this.slowUntil) {
      world.timeScale = 1;
      this.slowUntil = 0;
    }
  }

  // Muerte que decide la ronda: congelado, cámara lenta, zoom al punto y vuelta.
  killCam(x, y) {
    if (this.killCamBusy) return;
    this.killCamBusy = true;
    const cam = this.scene.cameras.main;
    this.hitStop(90);
    this.slowMo(650, 0.3);
    cam.flash(90, 255, 255, 255);
    cam.pan(x, y, 180, 'Quad.easeOut');
    cam.zoomTo(1.3, 180, 'Quad.easeOut');
    this.scene.time.delayedCall(750, () => {
      cam.pan(GAME_WIDTH / 2, GAME_HEIGHT / 2, 400, 'Quad.easeInOut');
      cam.zoomTo(1, 400, 'Quad.easeInOut');
      this.scene.time.delayedCall(400, () => (this.killCamBusy = false));
    });
  }

  hurtFlash() {
    this.scene.tweens.killTweensOf(this.vignette);
    this.vignette.setAlpha(1);
    this.scene.tweens.add({ targets: this.vignette, alpha: 0, duration: 350, ease: 'Quad.easeIn' });
  }

  // ---------------------------------------------------------------- efectos
  casing(x, y, dir, shotgun) {
    const c = this.casings.create(x, y, shotgun ? 'shell' : 'casing');
    c.setVelocity(-dir * Phaser.Math.Between(60, 160), Phaser.Math.Between(-320, -200));
    c.setAngularVelocity(Phaser.Math.Between(-900, 900)).setDepth(4);
    this.scene.tweens.add({ targets: c, alpha: 0, delay: 1400, duration: 300, onComplete: () => c.destroy() });
    const all = this.casings.getChildren();
    if (all.length > MAX_CASINGS) all[0].destroy();
  }

  shockwave(x, y, radius) {
    const s = this.scene;
    const ring = s.add.graphics().setDepth(8);
    const state = { r: 8, a: 1 };
    s.tweens.add({
      targets: state, r: radius * 1.2, a: 0, duration: 320, ease: 'Quad.easeOut',
      onUpdate: () => ring.clear().lineStyle(4, 0xffeecc, state.a).strokeCircle(x, y, state.r),
      onComplete: () => ring.destroy(),
    });
    const flash = s.add.image(x, y, 'puff').setScale(radius / 3).setTint(0xffffcc).setDepth(8)
      .setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: flash, alpha: 0, scale: radius / 2, duration: 140, onComplete: () => flash.destroy() });
    this.smokeLinger.explode(10, x, y);
  }

  // Estela de "fantasmas" cuando algo sale volando rápido.
  trail(sprite, speed) {
    if (!sprite?.visible || speed < TRAIL_MIN_SPEED) return;
    const now = performance.now();
    if (now - (this.trailTimers.get(sprite) ?? 0) < TRAIL_EVERY_MS) return;
    this.trailTimers.set(sprite, now);
    const ghost = this.scene.add.image(sprite.x, sprite.y, sprite.texture.key)
      .setFlipX(sprite.flipX).setAngle(sprite.angle).setTint(sprite.color ?? 0xffffff).setAlpha(0.45).setDepth(sprite.depth - 1);
    this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 200, onComplete: () => ghost.destroy() });
  }
}
