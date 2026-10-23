import Phaser from 'phaser';
import { GAME_WIDTH } from '../level.js';
import { WEAPONS, EXPLOSION, THROW, THROWN_WEAPON, randomWeaponType } from '../weapons.js';
import { socket, session, send } from '../net.js';
import { play } from '../audio.js';
import { isTouch } from '../touch.js';

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
    this.onDealtHit = null; // (arma) -> la escena lo usa para el registro de muertes
    // Modo bot: el rival es un jugador simulado en este navegador. Sus balas nos dañan aquí mismo
    // y las nuestras le dañan directamente (no hay nadie al otro lado de la red).
    this.remoteIsBot = false;
    this.thrownRemoteOverlap = null;

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

    // Armas lanzadas: rebotan en las plataformas y golpean mientras van rápido.
    this.thrown = scene.physics.add.group({ bounceX: 0.5, bounceY: 0.4, dragX: 60, collideWorldBounds: true });
    scene.physics.add.collider(this.thrown, platforms);
    scene.physics.add.overlap(this.thrown, player, (a, b) => this.thrownHitLocal(a.thrownType ? a : b));

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
    // En táctil la esquina inferior izquierda la ocupa la cruceta: arma y munición abajo al centro.
    const hud = isTouch ? this.scene.add.text(GAME_WIDTH / 2, 528, '', { ...style, fontSize: '16px', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1)
      : this.scene.add.text(10, 482, '', style);
    this.hud = this.scene.juice.ui(hud.setDepth(100));
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
      weapon_throw: (d) => this.onRemoteThrow(d),
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
    play('pickup', this.remote?.x, 0.4);
    // Ambos la recogimos a la vez: gana el host.
    if (this.local?.id === d.id && !session.isHost) this.local = null;
  }

  onRemoteShoot(d) {
    if (!d || !WEAPONS[d.w] || !isNum(d.x) || !isNum(d.y) || !Array.isArray(d.a)) return;
    if (d.a.length > WEAPONS[d.w].pellets || !d.a.every(isNum)) return;
    this.spawnShot(d, 'remote');
    this.scene.stats?.shot('rival');
    this.remoteKick = 6;
  }

  onRemoteThrow(d) {
    if (!d || !WEAPONS[d.w] || ![d.x, d.y, d.vx, d.vy].every(isNum)) return;
    this.spawnThrown(d, 'remote');
    play('throw', d.x, 0.7);
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
    send('weapon_spawn', data);
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
    play('spawn', x, 0.6);
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
    // Con arma y nada cerca: E la lanza (estilo Duck Game).
    if (!item && this.local && input.pickupPressed) return this.throwLocal();
    if (!item || (this.local && !input.pickupPressed)) return;

    if (this.local) this.discardLocal();
    this.local = { id: item.weaponId, type: item.weaponType, ammo: WEAPONS[item.weaponType].ammo, nextShotAt: 0 };
    this.removeItem(item.weaponId, false);
    this.spawnGlow.explode(8, this.player.x, this.player.y);
    play('pickup', this.player.x);
    send('weapon_pickup', { id: this.local.id });
  }

  handleFire(input, time) {
    this.localAimDown = input.down;
    const w = this.local;
    if (!w || !this.player.alive || !input.fireHeld || time < w.nextShotAt) return;
    const shot = this.fireWeapon(this.player, w, input.down, time, 'local');
    send('player_shoot', shot);
    this.localKick = 6;
    this.scene.stats?.shot('me');
    if (w.ammo <= 0) this.scene.time.delayedCall(120, () => this.local === w && this.discardLocal());
  }

  // Dispara el arma `w` de `shooter` (jugador local o bot): balas, retroceso y munición.
  fireWeapon(shooter, w, aimDown, time, owner) {
    const def = WEAPONS[w.type];
    w.nextShotAt = time + def.cooldown;
    w.ammo--;
    const dir = shooter.flipX ? -1 : 1;
    const muzzle = aimDown ? { x: shooter.x + dir * 3, y: shooter.y + 22 } : { x: shooter.x + dir * 20, y: shooter.y + 3 };
    const base = aimDown ? 90 : dir > 0 ? 0 : 180;
    const angles = Array.from({ length: def.pellets }, () => Math.round(base + Phaser.Math.FloatBetween(-def.spread, def.spread)));
    const shot = { w: w.type, x: Math.round(muzzle.x), y: Math.round(muzzle.y), a: angles };
    this.spawnShot(shot, owner);
    // Retroceso: impulso opuesto a la dirección de disparo.
    if (aimDown) shooter.applyImpulse(0, -def.recoilDown);
    else shooter.applyImpulse(-dir * def.recoil, shooter.isOnGround() ? -def.recoilHop : 0);
    return shot;
  }

  // --- Bot (modo VS BOT) ---
  botFire(bot, time) {
    const w = bot.weapon;
    if (!w || !bot.alive || time < w.nextShotAt) return;
    this.fireWeapon(bot, w, false, time, 'remote');
    this.remoteKick = 6;
    this.scene.stats?.shot('rival');
    if (w.ammo <= 0) {
      bot.weapon = null;
      play('empty', bot.x, 0.6);
    }
  }

  botTryPickup(bot) {
    if (bot.weapon || !bot.alive) return;
    for (const item of this.items.values()) {
      if (Phaser.Math.Distance.Between(bot.x, bot.y, item.x, item.y) < PICKUP_RANGE) {
        bot.weapon = { id: item.weaponId, type: item.weaponType, ammo: WEAPONS[item.weaponType].ammo, nextShotAt: 0 };
        this.removeItem(item.weaponId, false);
        play('pickup', bot.x, 0.5);
        return;
      }
    }
  }

  throwLocal() {
    const dir = this.player.flipX ? -1 : 1;
    const data = {
      w: this.local.type,
      x: Math.round(this.player.x + dir * 12),
      y: Math.round(this.player.y),
      vx: Math.round(dir * THROW.speed + this.player.body.velocity.x * 0.4),
      vy: -THROW.lift,
    };
    this.local = null;
    this.spawnThrown(data, 'local');
    send('weapon_throw', data);
    play('throw', data.x);
  }

  spawnThrown({ w, x, y, vx, vy }, owner) {
    const t = this.thrown.create(x, y, WEAPONS[w].key).setDepth(5);
    t.setVelocity(vx, vy).setAngularVelocity(Math.sign(vx || 1) * 900);
    t.thrownType = w;
    t.owner = owner;
    t.harmful = true;
    t.dieAt = this.scene.time.now + THROW.lifeMs;
  }

  // Nuestra arma lanzada alcanza al rival: somos la autoridad, enviamos el golpe.
  thrownHitRemote(t) {
    if (!t.harmful || t.owner !== 'local' || !this.remote?.alive) return;
    t.harmful = false;
    const dir = Math.sign(t.body.velocity.x) || 1;
    this.sendHit(THROW.damage, dir * THROW.knockback, -160, THROWN_WEAPON);
    this.blood.explode(8, t.x, t.y);
    play('bonk', t.x);
    t.setVelocity(-t.body.velocity.x * 0.3, -180);
  }

  thrownHitLocal(t) {
    if (!t.harmful || t.owner !== 'remote' || !this.player.alive) return;
    t.harmful = false; // solo efecto: el daño lo confirma quien la lanzó
    play('bonk', t.x);
    t.setVelocity(-t.body.velocity.x * 0.3, -180);
  }

  discardLocal() {
    if (this.localHeld.visible) this.smoke.explode(5, this.localHeld.x, this.localHeld.y);
    play('empty', this.player.x);
    this.local = null;
  }

  onLocalDeath() {
    this.local = null;
  }

  setRemote(remote) {
    this.remoteOverlap?.destroy();
    this.thrownRemoteOverlap?.destroy();
    this.remoteOverlap = null;
    this.thrownRemoteOverlap = null;
    this.remote = remote;
    if (remote) {
      this.remoteOverlap = this.scene.physics.add.overlap(this.bullets, remote, (a, b) => this.bulletHitRemote(a.def ? a : b));
      this.thrownRemoteOverlap = this.scene.physics.add.overlap(this.thrown, remote, (a, b) => this.thrownHitRemote(a.thrownType ? a : b));
    }
  }

  // Inicio de ronda: mapa limpio. El host vuelve a generar armas desde cero.
  resetRound() {
    this.clearItems();
    this.bullets.clear(true, true);
    this.thrown.clear(true, true);
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
      b.weaponType = w;
      b.owner = owner; // 'local' | 'remote' — la Fase 4 lo usa para los impactos
      b.dieAt = now + def.life * (def.pellets > 1 ? Phaser.Math.FloatBetween(0.8, 1.2) : 1);
    }
    this.flash.explode(def.pellets > 1 ? 6 : 3, x, y);
    play(def.key, x, owner === 'remote' ? 0.75 : 1);
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
      this.sendHit(b.def.damage, (b.body.velocity.x / len) * k, (b.body.velocity.y / len) * k - 80, b.weaponType);
      this.blood.explode(10, b.x, b.y);
      play('hit', b.x);
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
    else if (this.remoteIsBot && this.canDealDamage()) {
      // Bala del bot: aquí sí hace daño (no hay otro cliente que lo confirme).
      const len = Math.hypot(b.body.velocity.x, b.body.velocity.y) || 1;
      const k = b.def.knockback;
      this.scene.receiveHit({ d: b.def.damage, kx: (b.body.velocity.x / len) * k, ky: (b.body.velocity.y / len) * k - 80, w: b.weaponType });
    } else this.blood.explode(6, b.x, b.y);
    b.destroy();
  }

  sendHit(d, kx, ky, w) {
    if (!this.canDealDamage()) return;
    this.onDealtHit?.(w);
    this.scene.stats?.hit('me');
    const hit = { d, kx: Math.round(kx), ky: Math.round(ky), w };
    if (this.remoteIsBot) this.scene.botTakeHit(hit);
    else send('player_hit', hit);
  }

  explode(x, y, owner) {
    this.fire.explode(40, x, y);
    this.smoke.explode(14, x, y);
    this.sparks.explode(20, x, y);
    this.scene.cameras.main.shake(260, 0.022);
    this.scene.juice.shockwave(x, y, EXPLOSION.radius);
    this.scene.replay?.event('explosion', x, y);
    play('explosion', x);

    // Daño al rival solo si el cohete es nuestro (autoridad del que dispara).
    const r = this.remote;
    if (owner === 'local' && r?.alive) {
      const rd = Phaser.Math.Distance.Between(r.x, r.y, x, y);
      if (rd <= EXPLOSION.radius) {
        if (this.remoteIsBot) r.applyImpulse(...this.blastImpulse(r, x, y, rd)); // el bot tiene física propia
        this.sendHit(rd <= EXPLOSION.radius * EXPLOSION.coreRatio ? 2 : 1, 0, 0, 3);
      }
    }
    // Cohete del bot: daña al jugador local aquí mismo.
    if (owner === 'remote' && this.remoteIsBot && this.player.alive && this.canDealDamage()) {
      const pd = Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y);
      if (pd <= EXPLOSION.radius) this.scene.receiveHit({ d: pd <= EXPLOSION.radius * EXPLOSION.coreRatio ? 2 : 1, kx: 0, ky: 0, w: 3 });
    }

    // Empuje (y salto con cohete) solo sobre nuestro jugador: el rival lo calcula en su cliente.
    const p = this.player;
    if (!p.alive) return;
    const dist = Phaser.Math.Distance.Between(p.x, p.y, x, y);
    if (dist <= EXPLOSION.radius) p.applyImpulse(...this.blastImpulse(p, x, y, dist));
  }

  blastImpulse(target, x, y, dist) {
    const force = EXPLOSION.minForce + (EXPLOSION.force - EXPLOSION.minForce) * (1 - dist / EXPLOSION.radius);
    const nx = dist > 1 ? (target.x - x) / dist : 0;
    const ny = dist > 1 ? (target.y - y) / dist : -1;
    return [nx * force, Math.min(ny, -0.35) * force]; // siempre algo hacia arriba: sale volando
  }

  // ------------------------------------------------------------------- update
  update(input, time) {
    this.player.armed = !!this.local;
    this.hostSpawnTick(time);
    this.handlePickup(input);
    this.handleFire(input, time);
    this.updateBullets(time);
    this.updateThrown(time);
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

  updateThrown(time) {
    for (const t of [...this.thrown.getChildren()]) {
      if (t.harmful && t.body.velocity.length() < THROW.harmfulSpeed) t.harmful = false;
      if (time >= t.dieAt || t.y > this.scene.map.deathY) {
        this.smoke.explode(4, t.x, t.y);
        t.destroy();
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
