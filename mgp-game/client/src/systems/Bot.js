import { TILE } from '../level.js';
import Player from '../entities/Player.js';
import NavGraph from './NavGraph.js';

// Distancia a la que el bot prefiere pelear con cada arma.
const RANGE = { 1: 260, 2: 110, 3: 300 };
const REACTION_MS = 280; // tiempo desde que te tiene a tiro hasta que dispara
const REPLAN_MS = 250;
const JUMP_HOLD_MS = 420; // salto completo para alcanzar los tramos altos

export const BOT_NAME = 'BOT';

// Justo tras despegar el bot sigue "en el suelo" un par de frames: no evaluar el aterrizaje aún.
const jumpingNow = (brain, time) => brain.pending && time - brain.pending.at < 150;

export function createBot(scene, spawn, skin) {
  const bot = new Player(scene, spawn.x, spawn.y, skin);
  bot.isBot = true;
  bot.weapon = null; // { id, type, ammo, nextShotAt }
  bot.weaponType = 0; // lo leen WeaponSystem (arma en la mano) y la repetición
  bot.aimDown = false;
  return bot;
}

// "Cerebro" del bot: cada frame genera el mismo input que daría un jugador y lo pasa a Player.update.
// Se mueve con un grafo de navegación del mapa (NavGraph): tramos de suelo unidos por caídas,
// saltos y atravesar tablones; cada ~250 ms busca la ruta (BFS) hacia su objetivo.
export default class BotBrain {
  constructor(scene, bot) {
    this.scene = scene;
    this.bot = bot;
    this.graphFor = null;
    this.edge = null;
    this.edgeFrom = null;
    this.nextPlanAt = 0;
    this.aimSince = 0;
    this.holdJumpUntil = 0;
    this.airDir = 0;
    this.pending = null; // arista de salto en curso: si se aterriza en el mismo tramo, ha fallado
    this.failures = new Map(); // arista -> { count, until }
  }

  usable(e, time) {
    const f = this.failures.get(e);
    return !f || f.count < 2 || time > f.until;
  }

  // Al aterrizar: si un salto nos dejó en el mismo tramo, contarlo como fallo (2 fallos = 6 s sin usarla).
  checkLanding(mySeg, time) {
    if (!this.pending || mySeg === null) return;
    if (mySeg === this.pending.from) {
      const f = this.failures.get(this.pending.edge) ?? { count: 0, until: 0 };
      f.count++;
      f.until = time + 6000;
      this.failures.set(this.pending.edge, f);
    } else this.failures.delete(this.pending.edge);
    this.pending = null;
  }

  graph() {
    if (this.graphFor !== this.scene.map) {
      this.nav = new NavGraph(this.scene.map);
      this.graphFor = this.scene.map;
      this.edge = null;
      this.failures.clear();
    }
    return this.nav;
  }

  solidAt(px, py) {
    const row = this.scene.map.rows[Math.floor(py / TILE)];
    const t = row ? row[Math.floor(px / TILE)] : '.';
    return t === '#' || t === '%';
  }

  lineOfSight(a, b) {
    const step = (Math.sign(b.x - a.x) * TILE) / 2;
    if (!step) return true;
    for (let x = a.x; Math.abs(x - a.x) < Math.abs(b.x - a.x); x += step) if (this.solidAt(x, a.y)) return false;
    return true;
  }

  // Objetivo: sin arma, el arma alcanzable más cercana; con arma (o si no hay), el jugador.
  pickTarget(nav, mySeg) {
    const me = this.scene.player;
    if (!this.bot.weapon) {
      let best = null;
      for (const item of this.scene.weapons.items.values()) {
        const seg = nav.segmentAt(item.x, item.body.bottom + 2);
        if (seg === null || (seg !== mySeg && !nav.nextEdge(mySeg, seg, (e) => this.usable(e, this.now)))) continue;
        const d = Math.abs(item.x - this.bot.x) + Math.abs(item.y - this.bot.y) * 1.5;
        if (!best || d < best.d) best = { x: item.x, y: item.y, seg, d };
      }
      if (best) return best;
    }
    return { x: me.x, y: me.y, seg: me.alive ? nav.segmentAt(me.x, me.body.bottom + 2) : null, isPlayer: true };
  }

  update(time, delta) {
    const bot = this.bot;
    const me = this.scene.player;
    const weapons = this.scene.weapons;
    const input = { left: false, right: false, down: false, jumpHeld: false, jumpPressed: false };
    let face = 0;
    let fire = false;

    if (bot.alive && this.scene.round.phase === 'playing') {
      weapons.botTryPickup(bot);
      const nav = this.graph();
      const onGround = bot.isOnGround();
      const mySeg = onGround ? nav.segmentAt(bot.x, bot.body.bottom + 2) : null;
      let dir = 0;
      let jump = false;

      if (onGround) {
        this.now = time;
        if (!jumpingNow(this, time)) this.checkLanding(mySeg, time);
        const target = this.pickTarget(nav, mySeg);
        if (time >= this.nextPlanAt || mySeg !== this.edgeFrom) {
          this.edge = target.seg !== null ? nav.nextEdge(mySeg, target.seg, (e) => this.usable(e, time)) : null;
          this.edgeFrom = mySeg;
          this.nextPlanAt = time + REPLAN_MS;
        }
        const e = this.edge;
        if (e && mySeg !== null) {
          // Seguir la ruta: ir al punto de despegue y ejecutar el movimiento.
          const launchX = e.launch * TILE + TILE / 2;
          if (Math.abs(bot.x - launchX) > 6 && !(e.type === 'walk' && Math.sign(bot.x - launchX) === e.dir)) {
            dir = Math.sign(launchX - bot.x);
          } else if (e.type === 'walk') {
            dir = e.dir;
          } else if (e.type === 'drop') {
            input.down = true;
            jump = true;
          } else {
            jump = true;
            this.airDir = e.land * TILE + TILE / 2;
            this.pending = { edge: e, from: mySeg, at: time };
          }
        } else if (target.isPlayer && bot.weapon && me.alive) {
          // Mismo tramo (o sin ruta) que el jugador: mantener la distancia ideal.
          const dx = me.x - bot.x;
          const want = RANGE[bot.weapon.type];
          if (Math.abs(dx) > want) dir = Math.sign(dx);
          else if (Math.abs(dx) < want * 0.45) dir = -Math.sign(dx);
        } else if (Math.abs(target.x - bot.x) > 6) {
          dir = Math.sign(target.x - bot.x);
        }
        // Esquivar: si el jugador va armado y está a su altura, saltito aleatorio.
        if (weapons.local && Math.abs(me.y - bot.y) < 24 && Math.random() < 0.01) jump = true;
      } else if (this.airDir) {
        // En el aire: dirigir el salto hacia el punto de aterrizaje.
        if (Math.abs(this.airDir - bot.x) > 8) dir = Math.sign(this.airDir - bot.x);
      }

      // Apuntar y disparar: a su altura, con línea de visión y tras un tiempo de reacción.
      if (bot.weapon && me.alive) {
        const range = bot.weapon.type === 2 ? 190 : 620;
        const steady = onGround || Math.abs(me.y - bot.y) < 10; // en el aire las balas salen desviadas
        const aligned = steady && Math.abs(me.y - bot.y) < 22 && Math.abs(me.x - bot.x) < range && this.lineOfSight(bot, me);
        if (aligned) {
          face = Math.sign(me.x - bot.x) || 1;
          if (!this.aimSince) this.aimSince = time;
          if (time - this.aimSince > REACTION_MS) fire = true;
          // A tiro y a distancia de su arma: quedarse quieto para girarse y disparar.
          if (Math.abs(me.x - bot.x) <= RANGE[bot.weapon.type] * 1.2) dir = 0;
        } else this.aimSince = 0;
      }

      input.left = dir < 0;
      input.right = dir > 0;
      if (jump) {
        input.jumpPressed = true;
        this.holdJumpUntil = time + JUMP_HOLD_MS;
      }
      input.jumpHeld = time < this.holdJumpUntil;
      if (onGround && !jump) this.airDir = 0;
    }

    bot.update(input, time, delta);
    if (face && !input.left && !input.right) bot.setFlipX(face < 0); // girarse sin moverse
    if (fire && face === (bot.flipX ? -1 : 1)) weapons.botFire(bot, time);
    bot.weaponType = bot.weapon?.type ?? 0;
    bot.armed = !!bot.weapon;
  }
}
