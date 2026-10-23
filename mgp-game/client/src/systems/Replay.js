import { GAME_WIDTH, GAME_HEIGHT } from '../level.js';
import { play } from '../audio.js';

const KEEP_MS = 3500;

// Repetición de la jugada que decide la ronda. Graba cada frame una "foto" mínima de lo que
// importa (jugadores, armas en mano, balas, armas lanzadas) y algunos eventos (explosiones,
// muertes). Al reproducir, oscurece el mundo y dibuja las fotos encima a cámara lenta.
// Todo local: cada cliente repite lo que vio en su pantalla, sin enviar nada por red.
export default class Replay {
  constructor(scene) {
    this.scene = scene;
    this.frames = []; // { t, s: [[texture, x, y, flipX, angle, tint, alpha, scaleX, scaleY, depth], ...] }
    this.events = []; // { t, type, x, y }
    this.playing = false;
    this.objects = [];
  }

  record(sources) {
    if (this.playing) return;
    const t = performance.now();
    const shots = [];
    for (const o of sources) {
      if (!o || !o.active || !o.visible || o.alpha === 0) continue;
      shots.push([o.texture.key, o.x, o.y, o.flipX, o.angle, o.isTinted ? o.tintTopLeft : -1, o.alpha, o.scaleX, o.scaleY, o.depth]);
    }
    this.frames.push({ t, s: shots });
    while (this.frames.length && t - this.frames[0].t > KEEP_MS) this.frames.shift();
    while (this.events.length && t - this.events[0].t > KEEP_MS) this.events.shift();
  }

  event(type, x, y) {
    if (!this.playing) this.events.push({ t: performance.now(), type, x, y });
  }

  // Reproduce el tramo [ahora - fromAgoMs, ahora - toAgoMs] a la velocidad indicada.
  play(fromAgoMs, toAgoMs, speed) {
    const now = performance.now();
    const t0 = now - fromAgoMs;
    const t1 = now - toAgoMs;
    const frames = this.frames.filter((f) => f.t >= t0 && f.t <= t1);
    if (frames.length < 2) return;
    const events = this.events.filter((e) => e.t >= t0 && e.t <= t1);
    this.stop();
    this.playing = true;

    const s = this.scene;
    const keep = (obj) => (this.objects.push(obj), obj);
    keep(s.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH * 2, GAME_HEIGHT * 2, 0x05050c, 0.8).setDepth(60));
    for (const [y, oy] of [[0, 0], [GAME_HEIGHT, 1]]) keep(s.juice.ui(s.add.rectangle(GAME_WIDTH / 2, y, GAME_WIDTH, 80, 0x000000).setOrigin(0.5, oy).setDepth(140)));
    const label = keep(s.juice.ui(s.add.text(20, 52, '● REPETICIÓN  x' + speed, {
      fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: '#ff4455', stroke: '#000', strokeThickness: 3,
    }).setDepth(141)));
    s.tweens.add({ targets: label, alpha: 0.3, duration: 400, yoyo: true, repeat: -1 });

    const pool = [];
    const start = performance.now();
    let nextEvent = 0;
    const tick = () => {
      const rt = t0 + (performance.now() - start) * speed;
      if (rt > t1) return this.stop();
      let i = 0;
      while (i + 1 < frames.length && frames[i + 1].t <= rt) i++;
      const shots = frames[i].s;
      shots.forEach((d, k) => {
        if (!pool[k]) pool[k] = keep(s.add.image(0, 0, d[0]));
        const img = pool[k].setVisible(true).setTexture(d[0]).setPosition(d[1], d[2]).setFlipX(d[3]).setAngle(d[4])
          .setAlpha(d[6]).setScale(d[7], d[8]).setDepth(61 + d[9] / 100);
        if (d[5] >= 0) img.setTint(d[5]);
        else img.clearTint();
      });
      for (let k = shots.length; k < pool.length; k++) pool[k].setVisible(false);
      while (nextEvent < events.length && events[nextEvent].t <= rt) this.replayEvent(events[nextEvent++]);
    };
    this.tick = tick;
    s.events.on('update', tick);
  }

  replayEvent({ type, x, y }) {
    const w = this.scene.weapons;
    if (type === 'explosion') {
      w.fire.explode(30, x, y);
      this.scene.juice.shockwave(x, y, 90, 70);
      play('explosion', x, 0.6);
    } else if (type === 'death') {
      w.blood.explode(30, x, y);
    }
    // Los efectos van por encima del oscurecido mientras dura la repetición.
    w.fire.setDepth(70);
    w.blood.setDepth(70);
  }

  stop() {
    if (this.tick) this.scene.events.off('update', this.tick);
    this.tick = null;
    for (const o of this.objects) o.destroy();
    this.objects = [];
    if (this.playing) {
      this.scene.weapons.fire.setDepth(7);
      this.scene.weapons.blood.setDepth(6);
    }
    this.playing = false;
  }
}
