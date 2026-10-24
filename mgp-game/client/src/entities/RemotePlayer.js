import Phaser from 'phaser';
import { PLAYER_COLORS, POSES, BODY_OFFSET, skinKey } from '../skins.js';
import Cosmetics from '../systems/Cosmetics.js';

// Formato de red de 'player_move' (array para que pese ~25 bytes):
//   [x, y, vx, vy, flags]
//   flags: bit0 = flipX, bit1 = vivo, bits2-4 = pose, bits5-7 = arma (0 = ninguna, hasta 7 tipos),
//          bit8 = apunta abajo, bits9-10 = vida
const POSE_INDEX = Object.fromEntries(POSES.map((key, i) => [key, i]));

export function packState(player, weaponType = 0, aimDown = false) {
  const flags =
    (player.flipX ? 1 : 0) |
    (player.alive ? 2 : 0) |
    ((POSE_INDEX[player.pose] ?? 0) << 2) |
    ((weaponType & 7) << 5) |
    (aimDown ? 256 : 0) |
    ((player.hp & 3) << 9);
  const { x: vx, y: vy } = player.body.velocity;
  return [Math.round(player.x), Math.round(player.y), Math.round(vx), Math.round(vy), flags];
}

function unpackState([x, y, vx, vy, flags]) {
  return {
    x, y, vx, vy,
    flip: !!(flags & 1),
    alive: !!(flags & 2),
    pose: POSES[(flags >> 2) & 7] ?? POSES[0],
    weaponType: (flags >> 5) & 7,
    aimDown: !!(flags & 256),
    hp: (flags >> 9) & 3,
  };
}

const INTERP_DELAY_MS = 100; // 2 paquetes a 20 Hz: absorbe jitter de red
const MAX_EXTRAPOLATE_MS = 120; // si se corta el flujo, seguir con la última velocidad un poco
const SNAP_DISTANCE = 150; // saltos mayores (reaparición) no se interpolan
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

    const [a, b] = buf;
    let x, y, ref;
    if (b && renderT >= a.t && renderT < b.t) {
      // Interpolación entre los dos estados que rodean renderT.
      ref = a;
      const teleport = a.alive !== b.alive || Math.hypot(b.x - a.x, b.y - a.y) > SNAP_DISTANCE;
      const k = teleport ? 0 : (renderT - a.t) / (b.t - a.t);
      x = Phaser.Math.Linear(a.x, b.x, k);
      y = Phaser.Math.Linear(a.y, b.y, k);
    } else {
      // Sin estado futuro: extrapolar un poco con la última velocidad conocida.
      ref = b && renderT >= b.t ? b : a;
      const dt = Phaser.Math.Clamp(renderT - ref.t, 0, MAX_EXTRAPOLATE_MS) / 1000;
      x = ref.x + ref.vx * dt;
      y = ref.y + ref.vy * dt;
    }

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
