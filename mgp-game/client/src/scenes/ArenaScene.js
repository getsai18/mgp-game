import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../level.js';
import { MAPS } from '../maps.js';
import { drawMapTiles, drawMapBackground } from '../mapTiles.js';
import { socket, session, leaveRoom } from '../net.js';
import Player, { PLAYER_COLORS } from '../entities/Player.js';
import RemotePlayer, { packState } from '../entities/RemotePlayer.js';
import WeaponSystem from '../systems/WeaponSystem.js';
import RoundManager from '../systems/RoundManager.js';
import Juice, { bake } from '../systems/Juice.js';
import Controls from '../systems/Controls.js';
import Banter from '../systems/Banter.js';
import Replay from '../systems/Replay.js';
import Stats from '../systems/Stats.js';
import BotBrain, { createBot, BOT_NAME } from '../systems/Bot.js';
import { MAX_HP, weaponName } from '../weapons.js';
import { play, startMusic, toggleMute } from '../audio.js';

const PLACES = { water: 'AL AGUA', void: 'AL VACÍO', spikes: 'A LOS PINCHOS', hit: '' };
const SEND_INTERVAL_MS = 50; // 20 Hz
const IDLE_RESEND_MS = 250; // si nada cambia, reenviar solo cada 250 ms

export default class ArenaScene extends Phaser.Scene {
  constructor() {
    super('Arena');
  }

  // mode: 'online' (conecta y espera rival practicando) | 'offline' (práctica sin conexión) | 'bot' (VS BOT sin conexión)
  init(data) {
    this.mode = data?.mode ?? 'online';
  }

  create() {
    // La escena se reutiliza al volver del menú: limpiar referencias de la partida anterior.
    this.leaving = false;
    this.mapIndex = -1;
    this.mapBg = null;
    this.mapLayer = null;
    this.botBrain = null;
    session.opponentName = this.mode === 'bot' ? BOT_NAME : null;
    if (this.mode === 'online' && !socket.connected) socket.connect();
    this.cameras.main.fadeIn(250, 0, 0, 0);

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
    this.banter = new Banter(this);
    this.replay = new Replay(this);
    this.stats = new Stats(this);
    this.events.once('shutdown', () => this.replay.stop());
    this.lastHitOnMe = null; // { w, at }: para saber quién nos mandó al agua / vacío
    this.lastHitOnRemote = null;
    this.round = new RoundManager(this);
    this.weapons.canDealDamage = () => this.round.canDealDamage();
    this.weapons.onDealtHit = (w) => (this.lastHitOnRemote = { w, at: this.time.now });
    if (this.mode === 'bot') this.round.startMatch(); // el bot ya existe: arrancar la partida
    this.hpBars = this.add.graphics().setDepth(20);
    const nameStyle = { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 };
    this.nameTags = [this.add.text(0, 0, '', nameStyle).setOrigin(0.5, 1).setDepth(20), this.add.text(0, 0, '', nameStyle).setOrigin(0.5, 1).setDepth(20)];
  }

  update(time, delta) {
    const input = this.readInput();
    this.juice.update();
    this.player.update(input, time, delta);
    const rx = this.remote?.x;
    const ry = this.remote?.y;
    if (this.botBrain) this.botBrain.update(time, delta);
    else this.remote?.update(delta);
    this.weapons.update(input, time);
    this.banter.tryTaunt(input, time);
    this.banter.update(time);
    this.sendState(time);
    this.drawHpBars();
    if (this.round.phase !== 'solo') {
      const w = this.weapons;
      this.replay.record([this.player, this.remote, w.localHeld, w.remoteHeld, ...w.bullets.getChildren(), ...w.thrown.getChildren()]);
    }

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
    this.replay?.stop();
    this.lastHitOnMe = null;
    this.lastHitOnRemote = null;
    if (mapIndex !== this.mapIndex) this.buildMap(mapIndex);
    this.player.spawnPoint = this.map.spawns[session.playerIndex];
    this.player.respawn();
    if (this.botBrain) {
      this.remote.spawnPoint = this.map.spawns[1 - session.playerIndex];
      this.remote.respawn();
      this.remote.weapon = null;
    }
    this.stats?.hidePanel();
    this.weapons.resetRound();
    this.juice.casings.clear(true, true);
  }

  // Efecto según dónde murió: agua -> salpicadura; vacío -> nada (ya salió de pantalla); resto -> sangre.
  deathEffect(x, y, local) {
    const { deathY, theme } = this.map;
    if (theme.death === 'water' && y > deathY - 40) {
      this.waterSplash.explode(45, x, deathY);
      play('splash', x);
    } else if (y < GAME_HEIGHT - 10) {
      this.weapons.blood.explode(45, x, y);
      play('death', x);
    } else {
      play('fall', x, 0.7);
    }
    this.cameras.main.shake(local ? 250 : 180, local ? 0.016 : 0.01);
    this.replay?.event('death', x, y);
    if (!local) this.feedRemoteDeath(x, y);
    // Kill-cam una vez por ronda: la primera muerte (la que decide). No depende de la fase porque
    // en el host la muerte del rival se ve ~150 ms tarde (interpolación) y el veredicto puede llegar antes.
    if (this.round && this.round.phase !== 'solo' && !this.killCamPlayed) {
      this.killCamPlayed = true;
      this.juice.killCam(x, Phaser.Math.Clamp(y, 60, Math.min(deathY, GAME_HEIGHT) - 50));
    }
  }

  // Impacto sobre nuestro jugador: confirmado por el rival (red) o causado por el bot (local).
  receiveHit(d) {
    if (!d || !this.round.canDealDamage() || !this.player.alive) return;
    const dmg = Phaser.Math.Clamp(Math.round(d.d) || 0, 0, MAX_HP);
    const kx = Phaser.Math.Clamp(Number(d.kx) || 0, -800, 800);
    const ky = Phaser.Math.Clamp(Number(d.ky) || 0, -800, 800);
    if (dmg === 0) return;
    this.lastHitOnMe = { w: d.w, at: this.time.now };
    this.stats?.hit('rival');
    this.juice.hurtFlash();
    play('hit', this.player.x);
    this.weapons.blood.explode(10, this.player.x, this.player.y);
    if (!this.player.hurt(dmg, kx, ky)) {
      this.cameras.main.shake(90, 0.008);
      this.juice.hitStop(60);
    }
  }

  // Nuestro impacto sobre el bot (en modo VS BOT no hay red).
  botTakeHit(d) {
    const bot = this.remote;
    if (!bot?.alive) return;
    this.weapons.blood.explode(10, bot.x, bot.y);
    bot.hurt(d.d, d.kx, d.ky);
  }

  // --- Registro de muertes (cada cliente lo arma con lo que sabe; no viaja por red) ---
  feedLocalDeath(cause) {
    const me = session.name.toUpperCase();
    const rival = (session.opponentName || 'RIVAL').toUpperCase();
    const hit = this.recentHit(this.lastHitOnMe);
    const rivalColor = `#${PLAYER_COLORS[1 - session.playerIndex].toString(16)}`;
    if (cause === 'hit' && hit) return this.banter.feed(`${rival} ✹ ${me}  [${weaponName(hit.w)}]`, rivalColor);
    const place = PLACES[cause] ?? '';
    if (hit) this.banter.feed(`${rival} MANDÓ A ${me} ${place}`, rivalColor);
    else this.banter.feed(`${me} CAYÓ ${place}`, '#cccccc');
  }

  feedRemoteDeath(x, y) {
    const me = session.name.toUpperCase();
    const rival = (session.opponentName || 'RIVAL').toUpperCase();
    const { deathY, theme, spikes } = this.map;
    let cause = 'hit';
    if (theme.death === 'water' && y > deathY - 40) cause = 'water';
    else if (y > GAME_HEIGHT - 10) cause = 'void';
    else if (spikes.some((s) => x > s.x - 10 && x < s.x + s.w + 10 && Math.abs(y + 20 - s.y) < 30)) cause = 'spikes';
    const hit = this.recentHit(this.lastHitOnRemote);
    const myColor = `#${PLAYER_COLORS[session.playerIndex].toString(16)}`;
    this.stats.death('rival', cause !== 'hit');
    if (cause === 'hit' && hit) return this.banter.feed(`${me} ✹ ${rival}  [${weaponName(hit.w)}]`, myColor);
    if (hit) this.banter.feed(`${me} MANDÓ A ${rival} ${PLACES[cause] ?? ''}`, myColor);
    else this.banter.feed(`${rival} CAYÓ ${PLACES[cause] ?? ''}`, '#cccccc');
  }

  recentHit(h) {
    return h && this.time.now - h.at < 2500 ? h : null;
  }

  drawHpBars() {
    // Nombres sobre las cabezas.
    [[this.player, session.name], [this.remote, session.opponentName]].forEach(([p, name], i) => {
      const tag = this.nameTags[i];
      const show = !!p && p.alive && p.visible && !!name;
      tag.setVisible(show);
      if (show) tag.setText(name).setPosition(p.x, p.y - 32).setColor(`#${p.color.toString(16)}`);
    });
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
    startMusic(index); // cada mapa transpone la música
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
      this.stats.death('me', p.deathCause !== 'hit');
      this.feedLocalDeath(p.deathCause);
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
      player_hit: (d) => this.receiveHit(d),
      player_move: (packed) => {
        if (!Array.isArray(packed) || packed.length !== 5) return;
        this.ensureRemote().pushState(packed);
      },
    };
    for (const [evt, fn] of Object.entries(handlers)) socket.on(evt, fn);
    this.events.once('shutdown', () => Object.entries(handlers).forEach(([evt, fn]) => socket.off(evt, fn)));

    if (session.opponent) this.ensureRemote();
    if (this.mode === 'bot') this.createBotOpponent();
  }

  // VS BOT: el rival es un Player con física propia controlado por BotBrain, en este navegador.
  createBotOpponent() {
    const skin = 1 - session.playerIndex;
    const bot = createBot(this, this.map.spawns[skin], skin);
    this.physics.add.collider(bot, this.platforms, null, (b, block) => !(block.oneWay && b.isDropping()));
    this.physics.add.overlap(bot, this.hazards, () => bot.die(0, 0, 'spikes'));
    bot.onDeath = (b) => {
      this.deathEffect(b.x, b.y, false);
      bot.weapon = null;
      this.round.onBotDeath();
    };
    this.remote = bot;
    this.weapons.setRemote(bot);
    this.weapons.remoteIsBot = true;
    this.botBrain = new BotBrain(this, bot);
  }

  onMatchEnd(winner) {
    this.stats.showPanel(winner, this.round.score, (i) => this.round.nameOf(i));
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
    this.controls = new Controls(this);
    // Atajos que no son de juego: M mapa (práctica), N sonido, ESC volver al menú.
    const kb = this.input.keyboard;
    kb.on('keydown-M', () => {
      if (this.round.phase !== 'solo') return;
      this.resetRound((this.mapIndex + 1) % MAPS.length);
      this.round.showBanner(this.map.name, '#ffffff', 800);
    });
    kb.on('keydown-N', () => toggleMute());
    kb.on('keydown-ESC', () => this.backToMenu());

    this.juice.ui(this.add
      .text(GAME_WIDTH - 10, 10, 'Q burla · N sonido · M mapa (práctica) · ESC menú', {
        fontFamily: 'monospace', fontSize: '11px', color: '#9a9ab8', stroke: '#000000', strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(100));
  }

  // Teclado + mando + táctil (las pruebas automáticas sustituyen este método).
  readInput() {
    return this.controls.read();
  }

  backToMenu() {
    if (this.leaving) return;
    this.leaving = true;
    leaveRoom();
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Title'));
  }

  createNetStatus() {
    const label = this.juice.ui(this.add
      .text(10, 10, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
      .setDepth(100));

    const render = () => {
      if (this.mode === 'offline') return label.setText('MODO PRÁCTICA · sin conexión');
      if (this.mode === 'bot') return label.setText('VS BOT · sin conexión');
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
