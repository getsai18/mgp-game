import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../level.js';
import { MAPS } from '../maps.js';
import { drawMapTiles, drawMapBackground } from '../mapTiles.js';
import { socket, session } from '../net.js';
import Player, { PLAYER_COLORS } from '../entities/Player.js';
import RemotePlayer, { packState } from '../entities/RemotePlayer.js';
import WeaponSystem from '../systems/WeaponSystem.js';
import RoundManager from '../systems/RoundManager.js';
import Juice, { bake } from '../systems/Juice.js';
import { MAX_HP } from '../weapons.js';

const SEND_INTERVAL_MS = 50; // 20 Hz
const IDLE_RESEND_MS = 250; // si nada cambia, reenviar solo cada 250 ms

export default class ArenaScene extends Phaser.Scene {
  constructor() {
    super('Arena');
  }

  create() {
    // Sin suelo ni techo en los límites del mundo: se cae al agua / al vacío y se puede volar hacia arriba.
    this.physics.world.setBoundsCollision(true, true, false, false);

    this.platforms = this.physics.add.staticGroup();
    this.hazards = this.physics.add.staticGroup(); // pinchos
    this.mapObjects = []; // decorado vivo del mapa actual (agua, partículas): se destruye al cambiar
    this.juice = new Juice(this, this.platforms);
    this.createSplashes();
    this.buildMap(0);
    this.createLocalPlayer();
    this.weapons = new WeaponSystem(this, this.platforms, this.player);
    this.createInput();
    this.createNetStatus();
    this.createNetSync();
    this.round = new RoundManager(this);
    this.weapons.canDealDamage = () => this.round.canDealDamage();
    this.hpBars = this.add.graphics().setDepth(20);
  }

  update(time, delta) {
    const input = this.readInput();
    this.juice.update();
    // Práctica: M cambia de mapa para poder verlos todos.
    if (Phaser.Input.Keyboard.JustDown(this.keys.map) && this.round.phase === 'solo') {
      this.resetRound((this.mapIndex + 1) % MAPS.length);
      this.round.showBanner(this.map.name, '#ffffff', 800);
    }
    this.player.update(input, time, delta);
    const rx = this.remote?.x;
    const ry = this.remote?.y;
    this.remote?.update(delta);
    this.weapons.update(input, time);
    this.sendState(time);
    this.drawHpBars();

    // Estelas al salir volando (retroceso, explosión, muerte), no al saltar o caer normal.
    const p = this.player;
    if (!p.alive || time < p.impulseUntil) this.juice.trail(p, p.body.velocity.length());
    if (this.remote && rx !== undefined && delta > 0) {
      const r = this.remote;
      const vx = (Math.abs(r.x - rx) * 1000) / delta;
      const v = (Math.hypot(r.x - rx, r.y - ry) * 1000) / delta;
      if (v < 2000 && (!r.alive || vx > 450)) this.juice.trail(r, v); // < 2000: ignora teletransportes
    }
  }

  // Inicio de ronda (lo llama RoundManager): todos a su sitio, mapa limpio.
  resetRound(mapIndex = this.mapIndex) {
    this.killCamPlayed = false;
    if (mapIndex !== this.mapIndex) this.buildMap(mapIndex);
    this.player.spawnPoint = this.map.spawns[session.playerIndex];
    this.player.respawn();
    this.weapons.resetRound();
    this.juice.casings.clear(true, true);
  }

  // Efecto según dónde murió: agua -> salpicadura; vacío -> nada (ya salió de pantalla); resto -> sangre.
  deathEffect(x, y, local) {
    const { deathY, theme } = this.map;
    if (theme.death === 'water' && y > deathY - 40) {
      this.waterSplash.explode(45, x, deathY);
    } else if (y < GAME_HEIGHT - 10) {
      this.weapons.blood.explode(45, x, y);
    }
    this.cameras.main.shake(local ? 250 : 180, local ? 0.016 : 0.01);
    // Kill-cam una vez por ronda: la primera muerte (la que decide). No depende de la fase porque
    // en el host la muerte del rival se ve ~150 ms tarde (interpolación) y el veredicto puede llegar antes.
    if (this.round && this.round.phase !== 'solo' && !this.killCamPlayed) {
      this.killCamPlayed = true;
      this.juice.killCam(x, Phaser.Math.Clamp(y, 60, Math.min(deathY, GAME_HEIGHT) - 50));
    }
  }

  drawHpBars() {
    const g = this.hpBars.clear();
    for (const p of [this.player, this.remote]) {
      if (!p || !p.alive || !p.visible) continue;
      for (let i = 0; i < MAX_HP; i++) {
        const x = p.x - (MAX_HP * 7) / 2 + i * 7;
        g.fillStyle(0x000000, 0.6).fillRect(x - 1, p.y - 30, 7, 5);
        g.fillStyle(i < p.hp ? p.color : 0x333344).fillRect(x, p.y - 29, 5, 3);
      }
    }
  }

  // Construye (o cambia) el mapa: cuerpos físicos invisibles + gráficos horneados en una textura.
  buildMap(index) {
    const map = MAPS[index];
    this.map = map;
    this.mapIndex = index;

    this.platforms.clear(true, true);
    for (const r of map.solids) {
      this.platforms.add(this.add.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h).setVisible(false));
    }
    for (const o of map.oneWays) {
      // Plataforma de un solo sentido: se atraviesa desde abajo y por los lados (y con S+salto).
      const plank = this.add.rectangle(o.x + o.w / 2, o.y + 3, o.w, 6).setVisible(false);
      this.platforms.add(plank);
      plank.oneWay = true;
      plank.body.checkCollision.down = false;
      plank.body.checkCollision.left = false;
      plank.body.checkCollision.right = false;
    }

    this.hazards.clear(true, true);
    for (const sp of map.spikes) {
      this.hazards.add(this.add.rectangle(sp.x + sp.w / 2, sp.y + sp.h / 2, sp.w, sp.h).setVisible(false));
    }

    this.mapBg?.destroy();
    this.mapLayer?.destroy();
    this.mapBg = bake(this, drawMapBackground(this, map)).setDepth(-10);
    this.mapLayer = bake(this, drawMapTiles(this, map)).setDepth(0);

    for (const obj of this.mapObjects) obj.destroy();
    this.mapObjects = [];
    this.createDeathZone(map);
    this.createAmbient(map);
  }

  // Agua helada (con oleaje y témpanos) o vacío (oscurece hacia abajo).
  createDeathZone(map) {
    const keep = (obj) => (this.mapObjects.push(obj), obj);
    if (map.theme.death === 'water') {
      const h = GAME_HEIGHT - map.deathY;
      keep(this.add.rectangle(GAME_WIDTH / 2, map.deathY + h / 2, GAME_WIDTH, h, 0x2f6d96, 0.92).setDepth(10));
      keep(this.add.rectangle(GAME_WIDTH / 2, map.deathY + 1, GAME_WIDTH, 3, 0xcfefff).setDepth(10));
      const shine = keep(this.add.rectangle(GAME_WIDTH / 2, map.deathY + 8, GAME_WIDTH, 2, 0x8fd0f5, 0.6).setDepth(10));
      this.tweens.add({ targets: shine, y: map.deathY + 14, alpha: 0.2, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      for (let i = 0; i < 6; i++) {
        const floe = keep(this.add.rectangle(Phaser.Math.Between(0, GAME_WIDTH), map.deathY + 4, Phaser.Math.Between(20, 44), 4, 0xf4fbff).setDepth(10));
        this.tweens.add({ targets: floe, x: floe.x + Phaser.Math.Between(-60, 60), duration: Phaser.Math.Between(3000, 6000), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    } else {
      const g = this.make.graphics({ add: false });
      g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.75, 0.75).fillRect(0, GAME_HEIGHT - 90, GAME_WIDTH, 90);
      keep(bake(this, g).setDepth(9));
    }
  }

  // Ambiente de cada mapa: nieve, polvo en la luz, luciérnagas y fuego de antorchas.
  createAmbient(map) {
    const keep = (obj) => (this.mapObjects.push(obj), obj);
    const ambient = {
      snow: { x: { min: 0, max: GAME_WIDTH }, y: -10, speedY: { min: 25, max: 60 }, speedX: { min: -20, max: 20 }, lifespan: 14000, scale: { min: 0.4, max: 1 }, alpha: { min: 0.6, max: 1 }, tint: 0xffffff, frequency: 70 },
      dust: { x: { min: 160, max: 800 }, y: { min: 90, max: 300 }, speedX: { min: -6, max: 6 }, speedY: { min: -4, max: 4 }, lifespan: 5000, scale: 0.5, alpha: { start: 0, end: 0.5, ease: 'Sine.easeInOut' }, tint: 0xfff3d0, frequency: 220 },
      fireflies: { x: { min: 0, max: GAME_WIDTH }, y: { min: 120, max: 470 }, speedX: { min: -15, max: 15 }, speedY: { min: -12, max: 12 }, lifespan: 3500, scale: { start: 0.7, end: 0.2 }, alpha: { start: 1, end: 0 }, tint: [0xd8ff6a, 0xfff07a], frequency: 160, blendMode: 'ADD' },
    }[map.theme.ambient];
    if (ambient) keep(this.add.particles(0, 0, 'pixel', ambient).setDepth(9));

    for (const d of map.decor.filter((t) => t.type === 'i')) {
      keep(this.add.particles(d.c * 16 + 8, d.r * 16 + 3, 'puff', {
        speedY: { min: -45, max: -20 }, speedX: { min: -8, max: 8 }, lifespan: { min: 250, max: 450 },
        scale: { start: 0.9, end: 0 }, tint: [0xffe066, 0xffa030, 0xff5a00], frequency: 40, blendMode: 'ADD',
      }).setDepth(5));
    }
  }

  createSplashes() {
    this.waterSplash = this.add.particles(0, 0, 'pixel', {
      speed: { min: 120, max: 380 }, angle: { min: 220, max: 320 }, gravityY: 900, lifespan: 800,
      scale: { start: 1.8, end: 0 }, tint: [0xffffff, 0xcfefff, 0x8fd0f5], emitting: false,
    }).setDepth(12);
  }

  createLocalPlayer() {
    const idx = session.playerIndex;
    const spawn = this.map.spawns[idx];
    this.player = new Player(this, spawn.x, spawn.y, idx);
    // Con S+salto solo se atraviesan las plataformas finas, nunca los bloques sólidos.
    this.physics.add.collider(this.player, this.platforms, null, (p, block) => !(block.oneWay && p.isDropping()));
    this.physics.add.overlap(this.player, this.hazards, () => this.player.die(0, 0, 'spikes'));

    this.player.onDeath = (p) => {
      this.weapons.onLocalDeath();
      this.deathEffect(p.x, p.y, true);
      this.round.onLocalDeath();
    };

    // Si 'joined' llega después de crear la escena, recolocar con el índice correcto.
    const onJoined = () => {
      const i = session.playerIndex;
      this.player.spawnPoint = this.map.spawns[i];
      this.player.skin = i;
      this.player.color = PLAYER_COLORS[i];
      if (this.player.alive) this.player.respawn();
      this.removeRemote(); // (re)conexión: sala nueva, rival nuevo
    };
    socket.on('joined', onJoined);
    this.events.once('shutdown', () => socket.off('joined', onJoined));
  }

  // --- Red: estado propio -> rival, estado del rival -> RemotePlayer ---
  createNetSync() {
    this.remote = null;
    this.lastSent = null;
    this.lastSentAt = 0;

    const handlers = {
      match_start: () => this.ensureRemote(),
      opponent_left: () => this.removeRemote(),
      // El rival nos confirma un impacto (él es la autoridad sobre sus balas).
      player_hit: (d) => {
        if (!d || !this.round.canDealDamage() || !this.player.alive) return;
        const dmg = Phaser.Math.Clamp(Math.round(d.d) || 0, 0, MAX_HP);
        const kx = Phaser.Math.Clamp(Number(d.kx) || 0, -800, 800);
        const ky = Phaser.Math.Clamp(Number(d.ky) || 0, -800, 800);
        if (dmg === 0) return;
        this.weapons.blood.explode(10, this.player.x, this.player.y);
        this.juice.hurtFlash();
        if (!this.player.hurt(dmg, kx, ky)) {
          this.cameras.main.shake(90, 0.008);
          this.juice.hitStop(60);
        }
      },
      player_move: (packed) => {
        if (!Array.isArray(packed) || packed.length !== 5) return;
        this.ensureRemote().pushState(packed);
      },
    };
    for (const [evt, fn] of Object.entries(handlers)) socket.on(evt, fn);
    this.events.once('shutdown', () => Object.entries(handlers).forEach(([evt, fn]) => socket.off(evt, fn)));

    if (session.opponent) this.ensureRemote();
  }

  ensureRemote() {
    if (!this.remote) {
      this.remote = new RemotePlayer(this, 1 - session.playerIndex);
      this.remote.onDeath = (r) => this.deathEffect(r.x, r.y, false);
      this.weapons.setRemote(this.remote);
      this.lastSent = null; // forzar envío inmediato para que el rival nos vea ya
    }
    return this.remote;
  }

  removeRemote() {
    this.remote?.destroy();
    this.remote = null;
    this.weapons.setRemote(null);
  }

  sendState(time) {
    // Tolerancia de medio frame: a 60 FPS el frame llega a 49.9 ms y si no lo aceptamos caemos a 15 Hz.
    if (!session.opponent || time - this.lastSentAt < SEND_INTERVAL_MS - 8) return;
    const state = packState(this.player, this.weapons.local?.type ?? 0, this.weapons.localAimDown);
    const unchanged = this.lastSent && state.every((v, i) => v === this.lastSent[i]);
    if (unchanged && time - this.lastSentAt < IDLE_RESEND_MS) return;
    socket.volatile.emit('player_move', state);
    this.lastSent = state;
    this.lastSentAt = time;
  }

  createInput() {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard.addKeys({
      left: K.A, right: K.D, up: K.W, down: K.S,
      left2: K.LEFT, right2: K.RIGHT, up2: K.UP, down2: K.DOWN,
      space: K.SPACE,
      pickup: K.E, fire: K.F, fire2: K.J, map: K.M,
    });
    this.jumpKeys = [this.keys.up, this.keys.up2, this.keys.space];

    this.juice.ui(this.add
      .text(GAME_WIDTH - 10, 10, 'A/D ←/→ mover · W/↑/Espacio saltar · S/↓ caer/apuntar abajo · F/J disparar · E cambiar arma · M mapa (práctica)', {
        fontFamily: 'monospace', fontSize: '11px', color: '#666688',
      })
      .setOrigin(1, 0)
      .setDepth(100));
  }

  readInput() {
    const k = this.keys;
    return {
      left: k.left.isDown || k.left2.isDown,
      right: k.right.isDown || k.right2.isDown,
      down: k.down.isDown || k.down2.isDown,
      jumpHeld: this.jumpKeys.some((key) => key.isDown),
      jumpPressed: this.jumpKeys.some((key) => Phaser.Input.Keyboard.JustDown(key)),
      fireHeld: k.fire.isDown || k.fire2.isDown,
      pickupPressed: Phaser.Input.Keyboard.JustDown(k.pickup),
    };
  }

  createNetStatus() {
    const label = this.juice.ui(this.add
      .text(10, 10, '', { fontFamily: 'monospace', fontSize: '14px', color: '#aaaacc' })
      .setDepth(100));

    const render = () => {
      if (!socket.connected) return label.setText(session.roomId ? 'Sin conexión con el servidor' : 'Conectando...');
      const who = `${session.roomId} · jugador ${session.playerIndex + 1}${session.isHost ? ' (host)' : ''}`;
      label.setText(`${who} · ${session.opponent ? '¡rival conectado!' : 'esperando rival...'}`);
    };

    // Los handlers de net.js ya actualizaron `session`; aquí solo repintamos.
    const events = ['connect', 'disconnect', 'connect_error', 'joined', 'match_start', 'opponent_left'];
    for (const evt of events) socket.on(evt, render);
    this.events.once('shutdown', () => events.forEach((evt) => socket.off(evt, render)));
    render();
  }
}
