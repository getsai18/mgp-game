import Phaser from 'phaser';
import { GAME_WIDTH } from '../level.js';
import { WEAPONS, EXPLOSION, randomWeaponType } from '../weapons.js';
import { socket, session } from '../net.js';

const FIRST_SPAWN_MS = 1000;
const SPAWN_EVERY_MS = 3500;
const MAX_ITEMS = 3;
const PICKUP_RANGE = 30;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Armas en el suelo, armas en la mano, disparos y explosiones.
// Red: el host decide las apariciones; cada cliente simula los disparos de ambos
// y aplica empujes de explosiones solo a SU jugador.
export default class WeaponSystem {
  constructor(scene, platforms, player) {
    this.scene = scene;
    this.player = player;
    this.remote = null; // ver setRemote()
    this.remoteOverlap = null;
    this.canDealDamage = () => true; // la escena lo sustituye (no hay daño entre rondas)

    // Armas en el suelo: caen y se apoyan en las plataformas.
    this.items = new Map(); // id -> sprite (con .weaponId, .weaponType, .platformIndex)
    this.itemGroup = scene.physics.add.group({ bounceY: 0.3, collideWorldBounds: true });
    scene.physics.add.collider(this.itemGroup, platforms);

    // Proyectiles: sin gravedad, chocan con las plataformas por cualquier lado (overlap ignora el one-way).
    this.bullets = scene.physics.add.group({ allowGravity: false });
    scene.physics.add.overlap(this.bullets, platforms, (b) => this.bulletHitWall(b));
    // Balas del rival que nos alcanzan en NUESTRA pantalla: solo efecto visual.
    // El daño real llega por 'player_hit' desde quien disparó (él tiene la autoridad).
    scene.physics.add.overlap(this.bullets, player, (a, b) => this.bulletHitLocal(a.def ? a : b));

    this.local = null; // { id, type, ammo, nextShotAt }
    this.localAimDown = false;
    this.spawnSeq = 0;
    this.nextSpawnAt = scene.time.now + FIRST_SPAWN_MS;

    this.localKick = 0; // retroceso visual del arma en la mano (px)
    this.remoteKick = 0;
    this.lastHitStopAt = 0;

    this.localHeld = scene.add.image(0, 0, 'pistol').setVisible(false).setDepth(5);
    this.remoteHeld = scene.add.image(0, 0, 'pistol').setVisible(false).setDepth(5);

    this.createEffects();
    this.createHud();
    this.bindNet();
  }

  // ---------------------------------------------------------------- efectos
  createEffects() {
    const s = this.scene;
    this.sparks = s.add.particles(0, 0, 'pixel', {
      speed: { min: 80, max: 260 }, lifespan: 220, scale: { start: 1, end: 0 },
      tint: [0xffffff, 0xffee88, 0xffaa33], emitting: false,
    }).setDepth(6);
    this.flash = s.add.particles(0, 0, 'puff', {
      speed: { min: 20, max: 80 }, lifespan: 90, scale: { start: 1.6, end: 0.2 },
      tint: [0xffffcc, 0xffcc33], emitting: false,
    }).setDepth(6);
    this.smoke = s.add.particles(0, 0, 'puff', {
      speed: { min: 5, max: 25 }, lifespan: 450, scale: { start: 0.9, end: 2.2 },
      alpha: { start: 0.5, end: 0 }, tint: 0x888899, emitting: false,
    }).setDepth(4);
    this.fire = s.add.particles(0, 0, 'puff', {
      speed: { min: 60, max: 340 }, lifespan: { min: 250, max: 600 },
      scale: { start: 2.5, end: 0 }, tint: [0xffffcc, 0xffcc33, 0xff6a00, 0xd92d00], emitting: false,
    }).setDepth(7);
    this.blood = s.add.particles(0, 0, 'pixel', {
      speed: { min: 60, max: 300 }, gravityY: 900, lifespan: { min: 300, max: 700 },
      scale: { start: 1.4, end: 0.4 }, tint: [0xff2244, 0xcc1133, 0x880022], emitting: false,
    }).setDepth(6);
    this.spawnGlow = s.add.particles(0, 0, 'pixel', {
      speed: { min: 40, max: 140 }, lifespan: 400, scale: { start: 1.2, end: 0 },
      tint: [0xffffff, 0x9fe8ff], emitting: false,
    }).setDepth(6);
  }

  createHud() {
    const style = { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' };
    this.hud = this.scene.juice.ui(this.scene.add.text(10, 482, '', style).setDepth(100));
    this.prompt = this.scene.add
      .text(0, 0, 'E', { ...style, fontSize: '12px', backgroundColor: '#000000aa', padding: { x: 3, y: 1 } })
      .setOrigin(0.5, 1).setDepth(100).setVisible(false);
  }

  // -------------------------------------------------------------------- red
  bindNet() {
    const handlers = {
      weapon_spawn: (d) => this.onRemoteSpawn(d),
      weapon_pickup: (d) => this.onRemotePickup(d),
      player_shoot: (d) => this.onRemoteShoot(d),
      joined: () => {
        // (Re)conexión: sala nueva, empezamos limpios.
        this.clearItems();
        this.local = null;
      },
    };
    for (const [evt, fn] of Object.entries(handlers)) socket.on(evt, fn);
    this.scene.events.once('shutdown', () => Object.entries(handlers).forEach(([evt, fn]) => socket.off(evt, fn)));
  }

  onRemoteSpawn(d) {
    if (!d || typeof d.id !== 'string' || !WEAPONS[d.t] || !isNum(d.x) || !isNum(d.y)) return;
    this.spawnItem(d);
  }

  onRemotePickup(d) {
    if (!d || typeof d.id !== 'string') return;
    this.removeItem(d.id, false);
    // Ambos la recogimos a la vez: gana el host.
    if (this.local?.id === d.id && !session.isHost) this.local = null;
  }

  onRemoteShoot(d) {
    if (!d || !WEAPONS[d.w] || !isNum(d.x) || !isNum(d.y) || !Array.isArray(d.a)) return;
    if (d.a.length > WEAPONS[d.w].pellets || !d.a.every(isNum)) return;
    this.spawnShot(d, 'remote');
    this.remoteKick = 6;
  }

  // ------------------------------------------------------------- apariciones
  hostSpawnTick(time) {
    if (!session.isHost || time < this.nextSpawnAt) return;
    this.nextSpawnAt = time + SPAWN_EVERY_MS;
    if (this.items.size >= MAX_ITEMS) return;

    // Puntos de aparición del mapa actual (w / c en el ASCII); como mucho un arma por punto.
    const points = this.scene.map.weaponSpawns;
    const occupied = new Set([...this.items.values()].map((i) => i.platformIndex));
    const free = points.map((_, i) => i).filter((i) => !occupied.has(i));
    if (free.length === 0) return;

    const pi = Phaser.Utils.Array.GetRandom(free);
    const data = {
      id: `${(socket.id ?? 'solo').slice(0, 4)}-${++this.spawnSeq}`,
      t: randomWeaponType(),
      x: points[pi].x,
      y: points[pi].y - 30, // aparece un poco arriba y cae sobre la superficie
      p: pi,
    };
    this.spawnItem(data);
    if (session.opponent) socket.emit('weapon_spawn', data);
  }

  spawnItem({ id, t, x, y, p }) {
    if (this.items.has(id)) return;
    const item = this.itemGroup.create(x, y, WEAPONS[t].key);
    item.weaponId = id;
    item.weaponType = t;
    item.platformIndex = isNum(p) ? p : -1;
    item.setDepth(3);
    this.items.set(id, item);

    this.spawnGlow.explode(14, x, y);
    item.setScale(0);
    this.scene.tweens.add({ targets: item, scale: 1, duration: 200, ease: 'Back.Out' });
  }

  removeItem(id, withPuff = true) {
    const item = this.items.get(id);
    if (!item) return;
    if (withPuff) this.smoke.explode(4, item.x, item.y);
    this.items.delete(id);
    item.destroy();
  }

  clearItems() {
    for (const id of [...this.items.keys()]) this.removeItem(id, false);
  }

  nearestItem(range) {
    let best = null;
    let bestDist = range;
    for (const item of this.items.values()) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, item.x, item.y);
      if (d < bestDist) {
        best = item;
        bestDist = d;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ jugador local
  // Manos vacías: se recoge al pasar. Con arma: E la cambia por la del suelo.
  handlePickup(input) {
    if (!this.player.alive) return this.prompt.setVisible(false);
    const item = this.nearestItem(PICKUP_RANGE);
    this.prompt.setVisible(!!item && !!this.local);
    if (item) this.prompt.setPosition(item.x, item.y - 8);
    if (!item || (this.local && !input.pickupPressed)) return;

    if (this.local) this.discardLocal();
    this.local = { id: item.weaponId, type: item.weaponType, ammo: WEAPONS[item.weaponType].ammo, nextShotAt: 0 };
    this.removeItem(item.weaponId, false);
    this.spawnGlow.explode(8, this.player.x, this.player.y);
    if (session.opponent) socket.emit('weapon_pickup', { id: this.local.id });
  }

  handleFire(input, time) {
    this.localAimDown = input.down;
    const w = this.local;
    if (!w || !this.player.alive || !input.fireHeld || time < w.nextShotAt) return;

    const def = WEAPONS[w.type];
    w.nextShotAt = time + def.cooldown;
    w.ammo--;

    const aimDown = input.down;
    const dir = this.player.flipX ? -1 : 1;
    const muzzle = aimDown
      ? { x: this.player.x + dir * 3, y: this.player.y + 22 }
      : { x: this.player.x + dir * 20, y: this.player.y + 3 };
    const base = aimDown ? 90 : dir > 0 ? 0 : 180;
    const angles = Array.from({ length: def.pellets }, () =>
      Math.round(base + Phaser.Math.FloatBetween(-def.spread, def.spread)),
    );

    const shot = { w: w.type, x: Math.round(muzzle.x), y: Math.round(muzzle.y), a: angles };
    this.spawnShot(shot, 'local');
    if (session.opponent) socket.emit('player_shoot', shot);
    this.localKick = 6;

    // Retroceso: impulso opuesto a la dirección de disparo.
    if (aimDown) this.player.applyImpulse(0, -def.recoilDown);
    else this.player.applyImpulse(-dir * def.recoil, this.player.isOnGround() ? -def.recoilHop : 0);

    if (w.ammo <= 0) this.scene.time.delayedCall(120, () => this.local === w && this.discardLocal());
  }

  discardLocal() {
    if (this.localHeld.visible) this.smoke.explode(5, this.localHeld.x, this.localHeld.y);
    this.local = null;
  }

  onLocalDeath() {
    this.local = null;
  }

  setRemote(remote) {
    this.remoteOverlap?.destroy();
    this.remoteOverlap = null;
    this.remote = remote;
    if (remote) {
      this.remoteOverlap = this.scene.physics.add.overlap(this.bullets, remote, (a, b) => this.bulletHitRemote(a.def ? a : b));
    }
  }

  // Inicio de ronda: mapa limpio. El host vuelve a generar armas desde cero.
  resetRound() {
    this.clearItems();
    this.bullets.clear(true, true);
    this.local = null;
    this.nextSpawnAt = this.scene.time.now + FIRST_SPAWN_MS;
  }

  // ----------------------------------------------------------------- disparos
  spawnShot({ w, x, y, a }, owner) {
    const def = WEAPONS[w];
    const now = this.scene.time.now;
    for (const deg of a) {
      const rad = Phaser.Math.DegToRad(deg);
      const b = this.bullets.create(x, y, def.bullet);
      b.setRotation(rad).setDepth(5);
      const speed = def.pellets > 1 ? def.speed * Phaser.Math.FloatBetween(0.85, 1.1) : def.speed;
      b.setVelocity(Math.cos(rad) * speed, Math.sin(rad) * speed);
      b.def = def;
      b.owner = owner; // 'local' | 'remote' — la Fase 4 lo usa para los impactos
      b.dieAt = now + def.life * (def.pellets > 1 ? Phaser.Math.FloatBetween(0.8, 1.2) : 1);
    }
    this.flash.explode(def.pellets > 1 ? 6 : 3, x, y);
    if (!def.explosive) {
      const dir = Math.cos(Phaser.Math.DegToRad(a[0])) < -0.1 ? -1 : 1;
      this.scene.juice.casing(x - dir * 12, y - 2, dir, def.pellets > 1);
    }
    this.smoke.explode(def.pellets > 1 ? 4 : 1, x, y);
    this.scene.cameras.main.shake(def.shake[0], def.shake[1]);
  }

  bulletHitWall(b) {
    if (!b.active) return;
    if (b.def.explosive) this.explode(b.x, b.y, b.owner);
    else this.sparks.explode(5, b.x, b.y);
    b.destroy();
  }

  // Nuestra bala alcanza al rival en nuestra pantalla: somos la autoridad, enviamos el impacto.
  bulletHitRemote(b) {
    const r = this.remote;
    if (!b.active || b.owner !== 'local' || !r?.alive) return;
    if (b.def.explosive) {
      this.explode(b.x, b.y, 'local');
    } else {
      const len = Math.hypot(b.body.velocity.x, b.body.velocity.y) || 1;
      const k = b.def.knockback;
      this.sendHit(b.def.damage, (b.body.velocity.x / len) * k, (b.body.velocity.y / len) * k - 80);
      this.blood.explode(10, b.x, b.y);
      // Hit-stop una vez por disparo (no por cada perdigón).
      if (this.scene.time.now - this.lastHitStopAt > 100) {
        this.lastHitStopAt = this.scene.time.now;
        this.scene.juice.hitStop(45);
      }
    }
    b.destroy();
  }

  bulletHitLocal(b) {
    if (!b.active || b.owner !== 'remote' || !this.player.alive) return;
    if (b.def.explosive) this.explode(b.x, b.y, 'remote');
    else this.blood.explode(6, b.x, b.y);
    b.destroy();
  }

  sendHit(d, kx, ky) {
    if (!this.canDealDamage()) return;
    socket.emit('player_hit', { d, kx: Math.round(kx), ky: Math.round(ky) });
  }

  explode(x, y, owner) {
    this.fire.explode(40, x, y);
    this.smoke.explode(14, x, y);
    this.sparks.explode(20, x, y);
    this.scene.cameras.main.shake(260, 0.022);
    this.scene.juice.shockwave(x, y, EXPLOSION.radius);

    // Daño al rival solo si el cohete es nuestro (autoridad del que dispara).
    const r = this.remote;
    if (owner === 'local' && r?.alive) {
      const rd = Phaser.Math.Distance.Between(r.x, r.y, x, y);
      if (rd <= EXPLOSION.radius) this.sendHit(rd <= EXPLOSION.radius * EXPLOSION.coreRatio ? 2 : 1, 0, 0);
    }

    // Empuje (y salto con cohete) solo sobre nuestro jugador: el rival lo calcula en su cliente.
    const p = this.player;
    if (!p.alive) return;
    const dx = p.x - x;
    const dy = p.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist > EXPLOSION.radius) return;
    const force = EXPLOSION.minForce + (EXPLOSION.force - EXPLOSION.minForce) * (1 - dist / EXPLOSION.radius);
    const nx = dist > 1 ? dx / dist : 0;
    const ny = dist > 1 ? dy / dist : -1;
    p.applyImpulse(nx * force, Math.min(ny, -0.35) * force); // siempre algo hacia arriba: sale volando
  }

  // ------------------------------------------------------------------- update
  update(input, time) {
    this.player.armed = !!this.local;
    this.hostSpawnTick(time);
    this.handlePickup(input);
    this.handleFire(input, time);
    this.updateBullets(time);
    this.updateItems();
    this.localKick *= 0.75;
    this.remoteKick *= 0.75;
    this.updateHeld(this.localHeld, this.player, this.local?.type ?? 0, this.localAimDown, this.localKick);
    this.updateHeld(this.remoteHeld, this.remote, this.remote?.weaponType ?? 0, this.remote?.aimDown, this.remoteKick);
    this.updateHud();
  }

  updateBullets(time) {
    for (const b of [...this.bullets.getChildren()]) {
      if (b.def.explosive) this.smoke.emitParticleAt(b.x - Math.cos(b.rotation) * 6, b.y - Math.sin(b.rotation) * 6);
      else this.scene.juice.tracer.emitParticleAt(b.x, b.y);
      const out = b.x < -40 || b.x > GAME_WIDTH + 40 || b.y < -200 || b.y > this.scene.map.deathY;
      if (time >= b.dieAt || out) {
        if (b.def.explosive && !out) this.explode(b.x, b.y, b.owner);
        b.destroy();
      }
    }
  }

  updateItems() {
    for (const item of [...this.items.values()]) {
      if (item.y > this.scene.map.deathY) this.removeItem(item.weaponId);
    }
  }

  updateHeld(sprite, owner, type, aimDown, kick) {
    const visible = !!owner && type > 0 && owner.alive && owner.visible;
    sprite.setVisible(visible);
    if (!visible) return;
    const dir = owner.flipX ? -1 : 1;
    sprite.setTexture(WEAPONS[type].key).setFlipX(dir < 0);
    if (aimDown) sprite.setPosition(owner.x + dir * 3, owner.y + 10 - kick).setAngle(dir > 0 ? 90 : -90);
    else sprite.setPosition(owner.x + dir * (9 - kick), owner.y + 3).setAngle(-dir * kick * 3);
  }

  updateHud() {
    if (!this.local) return this.hud.setText('');
    const def = WEAPONS[this.local.type];
    this.hud.setText(`${def.name}  ${'▮'.repeat(this.local.ammo)}`);
  }
}
