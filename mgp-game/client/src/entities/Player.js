import Phaser from 'phaser';
import { MAX_HP } from '../weapons.js';
import { PLAYER_COLORS, SKIN_W, skinKey } from '../skins.js';
import { play } from '../audio.js';

// Tuning del movimiento. Gravedad base del mundo: 1400. (El grafo del bot lo usa para simular saltos.)
export const MOVE = {
  maxSpeed: 280,
  groundAccel: 2600,
  airAccel: 1600,
  groundDrag: 2200,
  airDrag: 500,
  jumpVelocity: 620, // ~137 px de altura: alcanza la plataforma central alta
  jumpCut: 0.45, // al soltar el salto antes de la cima
  fallGravity: 700, // gravedad extra al caer: salto menos "flotante"
  fastFallGravity: 2200,
  fastFallSpeed: 650,
  maxFall: 950,
  coyoteMs: 90,
  jumpBufferMs: 110,
  dropThroughMs: 250,
  impulseLockMs: 300, // tras un retroceso/explosión no se aplica la caída rápida
  // Pared: empujando contra ella en el aire se resbala despacio; con salto se rebota hacia fuera.
  wallSlideSpeed: 130,
  wallJumpVx: 330,
  wallJumpVy: 560,
  wallCoyoteMs: 100, // se puede saltar un poco después de soltarse de la pared
  wallJumpLockMs: 160, // tras rebotar, sin control horizontal (si no, se vuelve a pegar)
};

export { PLAYER_COLORS };

function approach(value, target, step) {
  return value < target ? Math.min(value + step, target) : Math.max(value - step, target);
}

export default class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, skin) {
    super(scene, x, y, skinKey(skin, 'idle', false));
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.skin = skin; // índice de jugador: decide el color de la banda
    this.color = PLAYER_COLORS[skin]; // barras de vida, estelas, textos
    this.pose = 'idle';
    this.armed = false; // con arma cambia la pose de las manos (lo actualiza WeaponSystem)
    this.body.setSize(14, 36).setOffset((SKIN_W - 14) / 2, 4);
    // Velocidad X máxima alta a propósito: el retroceso de las armas (Fase 3) la necesita.
    this.body.setMaxVelocity(1400, MOVE.maxFall);
    this.setCollideWorldBounds(true);

    this.spawnPoint = { x, y };
    this.alive = true;
    this.hp = MAX_HP;
    this.lastGroundedAt = 0;
    this.jumpRequestedAt = -Infinity;
    this.dropUntil = 0;
    this.impulseUntil = 0;
    this.jumping = false;
    this.wasOnGround = false;
    this.runFrameTimer = 0;
    this.lastWallAt = -Infinity;
    this.lastWallDir = 0;
    this.wallJumpUntil = 0;
    this.wallDustAt = 0;
    this.onDeath = null; // callback (player) para la escena

    this.dust = scene.add.particles(0, 0, 'pixel', {
      speed: { min: 30, max: 90 },
      angle: { min: 200, max: 340 },
      lifespan: 300,
      scale: { start: 1, end: 0 },
      tint: 0xbbbbcc,
      emitting: false,
    });
  }

  isDropping() {
    return this.scene.time.now < this.dropUntil;
  }

  // input: { left, right, down, jumpHeld, jumpPressed } — desacoplado del teclado
  // para que en Fase 2 el jugador remoto pueda usar la misma clase.
  update(input, time, delta) {
    if (!this.alive) return;
    const body = this.body;
    const dt = delta / 1000;
    const onGround = body.blocked.down || body.touching.down;

    if (onGround) this.lastGroundedAt = time;
    if (onGround && !this.wasOnGround) this.land();
    this.wasOnGround = onGround;

    // --- Horizontal ---
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const vx = body.velocity.x;
    const overSpeed = Math.sign(vx) === dir && Math.abs(vx) > MOVE.maxSpeed;
    if (time < this.wallJumpUntil) {
      // Recién rebotado en una pared: conservar el impulso.
    } else if (dir !== 0 && !overSpeed) {
      body.velocity.x = approach(vx, dir * MOVE.maxSpeed, (onGround ? MOVE.groundAccel : MOVE.airAccel) * dt);
    } else {
      // Sin input (o empujado por encima del máximo): frenar con drag, conservando el impulso extra.
      body.velocity.x = approach(vx, dir * MOVE.maxSpeed * (overSpeed ? 1 : 0), (onGround ? MOVE.groundDrag : MOVE.airDrag) * dt);
    }
    if (dir !== 0 && time >= this.wallJumpUntil) this.setFlipX(dir < 0);

    // --- Pared (el bot no: su grafo de navegación no lo simula) ---
    const wallDir = onGround || this.isBot ? 0 : body.blocked.left ? -1 : body.blocked.right ? 1 : 0;
    const sliding = wallDir !== 0 && dir === wallDir && !input.down && body.velocity.y > 0;
    if (sliding) {
      this.lastWallAt = time;
      this.lastWallDir = wallDir;
    }

    // --- Salto (con coyote time y buffer) ---
    if (input.jumpPressed) this.jumpRequestedAt = time;
    const buffered = time - this.jumpRequestedAt <= MOVE.jumpBufferMs;
    const canJump = time - this.lastGroundedAt <= MOVE.coyoteMs;

    if (buffered && onGround && input.down) {
      // Abajo + salto sobre una plataforma: atravesarla.
      this.dropUntil = time + MOVE.dropThroughMs;
      this.jumpRequestedAt = -Infinity;
    } else if (buffered && canJump) {
      body.velocity.y = -MOVE.jumpVelocity;
      this.jumpRequestedAt = -Infinity;
      this.lastGroundedAt = -Infinity;
      this.jumping = true;
      this.puff(8);
      play('jump', this.x, 0.8);
      // Stretch al despegar.
      this.scene.tweens.add({ targets: this, scaleY: 1.2, scaleX: 0.85, duration: 70, yoyo: true });
    } else if (buffered && time - this.lastWallAt <= MOVE.wallCoyoteMs) {
      // Salto de pared: hacia arriba y hacia fuera, mirando al lado contrario.
      body.velocity.x = -this.lastWallDir * MOVE.wallJumpVx;
      body.velocity.y = -MOVE.wallJumpVy;
      this.setFlipX(this.lastWallDir > 0);
      this.jumpRequestedAt = -Infinity;
      this.lastWallAt = -Infinity;
      this.wallJumpUntil = time + MOVE.wallJumpLockMs;
      this.jumping = true;
      this.dust.explode(8, this.x + this.lastWallDir * 7, this.y + 6);
      play('jump', this.x, 0.8);
      this.scene.tweens.add({ targets: this, scaleX: 1.2, scaleY: 0.85, duration: 70, yoyo: true });
    }
    // Salto variable: recorta una sola vez al soltar (no afecta impulsos de retroceso).
    if (this.jumping && !input.jumpHeld && body.velocity.y < 0) {
      body.velocity.y *= MOVE.jumpCut;
      this.jumping = false;
    }
    if (body.velocity.y >= 0) this.jumping = false;

    // --- Gravedad extra al caer / caída rápida ---
    const impulsed = time < this.impulseUntil;
    if (!onGround && input.down && !impulsed) {
      body.setGravityY(MOVE.fastFallGravity);
      body.velocity.y = Math.max(body.velocity.y, MOVE.fastFallSpeed);
    } else {
      body.setGravityY(body.velocity.y > 0 ? MOVE.fallGravity : 0);
    }
    if (sliding) {
      body.setGravityY(0);
      body.velocity.y = Math.min(body.velocity.y, MOVE.wallSlideSpeed);
      if (time - this.wallDustAt > 90) {
        this.wallDustAt = time;
        this.dust.explode(1, this.x + wallDir * 7, this.y + 12);
      }
    }

    this.updatePose(onGround, dir, delta, sliding);

    const { deathY, theme } = this.scene.map;
    if (body.bottom > deathY + 6) this.die(0, 0, theme.death);
  }

  // Impulso externo (retroceso de arma, explosión). Se suma a la velocidad actual;
  // si empuja hacia arriba, cancela primero la caída para que el salto con cohete funcione.
  applyImpulse(ix, iy) {
    if (!this.alive) return;
    const v = this.body.velocity;
    v.x += ix;
    if (iy < 0 && v.y > 0) v.y = 0;
    v.y += iy;
    this.jumping = false;
    this.impulseUntil = this.scene.time.now + MOVE.impulseLockMs;
  }

  isOnGround() {
    return this.body.blocked.down || this.body.touching.down;
  }

  updatePose(onGround, dir, delta, sliding = false) {
    if (sliding) {
      this.pose = 'wall';
    } else if (!onGround) {
      this.pose = this.body.velocity.y < 0 ? 'jump' : 'fall';
    } else if (dir !== 0) {
      this.runFrameTimer += delta;
      this.pose = Math.floor(this.runFrameTimer / 110) % 2 ? 'run1' : 'run0';
    } else {
      this.runFrameTimer = 0;
      this.pose = 'idle';
    }
    this.setTexture(skinKey(this.skin, this.pose, this.armed));
  }

  land() {
    this.puff(6);
    play('land', this.x, 0.5);
    // Squash al aterrizar.
    this.scene.tweens.add({ targets: this, scaleY: 0.8, scaleX: 1.2, duration: 60, yoyo: true });
  }

  puff(count) {
    this.dust.explode(count, this.x, this.body.bottom);
  }

  // Impacto confirmado por el rival (player_hit). Devuelve true si nos mató.
  hurt(damage, kx, ky) {
    if (!this.alive) return false;
    this.hp -= damage;
    if (this.hp <= 0) {
      this.die(kx, ky);
      return true;
    }
    this.applyImpulse(kx, ky);
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => this.alive && this.clearTint());
    return false;
  }

  // Muerte dramática según la causa (la reaparición la decide la escena / ronda):
  //   'hit'    sale volando en la dirección del impacto (o hacia arriba si no hay dirección)
  //   'spikes' rebota hacia arriba girando
  //   'water'  se hunde despacio, congelado
  //   'void'   sigue cayendo fuera de pantalla
  die(kx = 0, ky = 0, cause = 'hit') {
    if (!this.alive) return;
    this.alive = false;
    this.deathCause = cause;
    this.hp = 0;
    this.body.checkCollision.none = true;
    this.setCollideWorldBounds(false);
    this.body.setGravityY(0);
    const spin = Phaser.Math.RND.sign();
    if (cause === 'water') {
      this.body.setAllowGravity(false);
      this.setVelocity(this.body.velocity.x * 0.15, 45);
      this.setAngularVelocity(spin * 60);
      this.setTint(0x9fd8ff);
    } else if (cause === 'void') {
      this.setAngularVelocity(spin * 300);
    } else {
      if (kx || ky) {
        const len = Math.hypot(kx, ky) || 1;
        this.setVelocity((kx / len) * 650, Math.min((ky / len) * 650, 0) - 450);
      } else {
        this.setVelocity(Phaser.Math.Between(-200, 200), cause === 'spikes' ? -520 : -750);
      }
      this.setAngularVelocity(spin * 900);
      this.setTint(0xff3300);
    }
    this.onDeath?.(this);
  }

  respawn() {
    this.alive = true;
    this.hp = MAX_HP;
    this.body.checkCollision.none = false;
    this.body.setAllowGravity(true);
    this.setCollideWorldBounds(true);
    this.setAngularVelocity(0).setAngle(0).setScale(1);
    this.clearTint();
    this.body.reset(this.spawnPoint.x, this.spawnPoint.y);
    this.wasOnGround = false;
    this.dropUntil = 0;
    this.jumpRequestedAt = -Infinity;
    this.lastWallAt = -Infinity;
    this.wallJumpUntil = 0;
    // Parpadeo de reaparición.
    this.scene.tweens.add({ targets: this, alpha: 0.3, duration: 80, yoyo: true, repeat: 4 });
  }
}
