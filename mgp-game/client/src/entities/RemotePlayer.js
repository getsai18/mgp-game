import Phaser from 'phaser';
import { PLAYER_COLORS, BODY_OFFSET, skinKey } from '../skins.js';
import { unpackState, interpolate } from '../netState.js';
import Cosmetics from '../systems/Cosmetics.js';

export { packState } from '../netState.js'; // (la escena lo importa de aquí)

const INTERP_DELAY_MS = 100; // 2 paquetes a 20 Hz: absorbe jitter de red
const DEATH_SPIN = 900; // grados/s mientras está muerto

// Rival controlado por red: sin física propia, solo interpola lo que recibe.
// Tiene cuerpo Arcade (sin gravedad, inmóvil) para que las balas puedan detectarlo (Fase 3).
export default class RemotePlayer extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, skin) {
    super(scene, -100, -100, skinKey(skin, 'idle', false));
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.skin = skin;
    this.color = PLAYER_COLORS[skin];
    this.body.setSize(14, 36).setOffset(BODY_OFFSET.x, BODY_OFFSET.y);
    this.setDepth(1);
    this.pose = 'idle';
    this.cosmetics = new Cosmetics(scene, this);
    this.body.setAllowGravity(false);
    this.body.moves = false;
    this.setVisible(false); // hasta recibir el primer estado

    this.buffer = []; // [{ t, x, y, vx, vy, flip, alive, pose }] ordenado por t
    this.alive = true;
    this.weaponType = 0; // lo lee WeaponSystem para dibujar el arma en la mano
    this.aimDown = false;
    this.hp = 0;
    this.onDeath = null; // callback (remote) para efectos en la escena
  }

  pushState(packed) {
    const state = unpackState(packed);
    state.t = performance.now();
    this.buffer.push(state);
    if (this.buffer.length > 30) this.buffer.shift();
  }

  update(delta) {
    const buf = this.buffer;
    if (buf.length === 0) return;
    const renderT = performance.now() - INTERP_DELAY_MS;

    // Descartar estados que ya quedaron atrás (dejando uno anterior a renderT).
    while (buf.length > 2 && buf[1].t <= renderT) buf.shift();

    // Interpolación entre los dos estados que rodean renderT (o extrapolación corta): netState.js.
    const { x, y, ref } = interpolate(buf[0], buf[1], renderT);

    this.setPosition(x, y);
    this.pose = ref.pose;
    this.setTexture(skinKey(this.skin, ref.pose, ref.weaponType > 0));
    this.setFlipX(ref.flip);
    this.weaponType = ref.weaponType;
    this.aimDown = ref.aimDown;
    this.hp = ref.hp;
    this.setVisible(true);
    this.applyAlive(ref.alive, delta);
  }

  applyAlive(alive, delta) {
    if (alive !== this.alive) {
      this.alive = alive;
      if (alive) {
        this.setAngle(0).clearTint();
        this.scene.tweens.add({ targets: this, alpha: 0.3, duration: 80, yoyo: true, repeat: 4 });
      } else {
        this.setTint(0xff3300);
        this.onDeath?.(this);
      }
    }
    if (!alive) this.angle += (DEATH_SPIN * delta) / 1000;
  }
}
