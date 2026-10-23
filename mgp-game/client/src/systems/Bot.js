import { TILE } from '../level.js';
import Player, { MOVE } from '../entities/Player.js';
import { WEAPONS } from '../weapons.js';
import NavGraph, { steerDir, JUMP_HOLD_MS } from './NavGraph.js';

// Distancia a la que el bot prefiere pelear con cada arma.
const RANGE = { 1: 260, 2: 110, 3: 300 };
const REACTION_MS = 280; // tiempo desde que te tiene a tiro hasta que dispara
const REPLAN_MS = 250;
const LAUNCH_TOL = 4; // px alrededor del punto de despegue
const LAUNCH_MAX_VX = 60; // el grafo simula los saltos desde parado: despegar casi quieto
const EDGE_MARGIN = 3; // sin plan de salir del tramo, el centro del bot no pasa de su borde menos esto
const AIR_CHECK_MS = 100; // cada cuánto se comprueba en el aire que el aterrizaje sigue siendo seguro
const RECOVERY_COLS = 24;
const WALK_OFF_MS = 1000; // tiempo máximo para salir caminando por un borde

export const BOT_NAME = 'BOT';

// Distancia que el retroceso de un disparo desplaza al bot (con saltito, parte la recorre en el aire).
function recoilSlide(def) {
  const airTime = def.recoilHop ? (2 * def.recoilHop) / 1400 : 0;
  const landSpeed = Math.max(0, def.recoil - MOVE.airDrag * airTime);
  return def.recoil * airTime + (landSpeed * landSpeed) / (2 * MOVE.groundDrag);
}

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
// saltos y atravesar tablones, todos validados simulando la física; cada ~250 ms busca la ruta (BFS).
// Seguridad: en el suelo no se sale del tramo salvo para ejecutar una arista, y en el aire
// comprueba (simulando) que va a aterrizar en algún sitio; si no, busca el suelo más cercano.
export default class BotBrain {
  constructor(scene, bot) {
    this.scene = scene;
    this.bot = bot;
    this.graphFor = null;
    this.memory = new Map(); // mapa -> fallos de sus aristas (se conservan entre rondas)
    this.edge = null;
    this.edgeFrom = null;
    this.nextPlanAt = 0;
    this.aimSince = 0;
    this.holdJumpUntil = 0;
    this.wasOnGround = false;
    this.lastGroundX = bot.x;
    this.executing = null; // { edge, from }: arista que se está ejecutando desde el suelo
    this.pending = null; // la misma, ya en el aire: al aterrizar se comprueba si llegó
    this.airGoal = null; // x hacia la que dirigir el control aéreo
    this.nextAirCheck = 0;
    this.walkSince = 0; // desde cuándo intenta salir caminando por un borde
  }

  graph() {
    const map = this.scene.map;
    if (this.graphFor !== map) {
      this.graphFor = map;
      this.nav = NavGraph.for(map);
      if (!this.memory.has(map)) this.memory.set(map, new Map());
      this.failures = this.memory.get(map); // arista -> { count, until }
      this.edge = null;
      this.pending = null;
      this.airGoal = null;
    }
    return this.nav;
  }

  usable(e, time) {
    const f = this.failures.get(e);
    return !f || f.count < 2 || time > f.until;
  }

  // 2 fallos = arista descartada 6 s; morir en ella la descarta 20 s.
  markFailure(edge, time, fatal) {
    const f = this.failures.get(edge) ?? { count: 0, until: 0 };
    f.count = fatal ? Math.max(f.count + 1, 2) : f.count + 1;
    f.until = time + (fatal ? 20000 : 6000);
    this.failures.set(edge, f);
  }

  takeOff() {
    this.walkSince = 0;
    this.pending = this.executing;
    // Sin arista (empujón, retroceso, esquiva): volver hacia donde pisaba.
    this.airGoal = this.executing ? this.executing.edge.goalX : this.lastGroundX;
    this.nextAirCheck = 0;
  }

  land(seg, time) {
    const p = this.pending;
    this.pending = null;
    this.airGoal = null;
    if (!p) return;
    if (seg === p.edge.to) this.failures.delete(p.edge);
    else this.markFailure(p.edge, time, false);
  }

  // Objetivo: sin arma, el arma alcanzable más cercana; con arma (o si no hay), el jugador.
  pickTarget(nav, mySeg, time) {
    const me = this.scene.player;
    if (!this.bot.weapon) {
      let best = null;
      for (const item of this.scene.weapons.items.values()) {
        if (!item.body.blocked.down && !item.body.touching.down) continue; // aún cayendo
        const seg = nav.standingSeg(item.x, item.body.bottom);
        if (seg === null || (seg !== mySeg && (nav.segs[seg].trap || !nav.nextEdge(mySeg, seg, (e) => this.usable(e, time))))) continue;
        const d = Math.abs(item.x - this.bot.x) + Math.abs(item.y - this.bot.y) * 1.5;
        if (!best || d < best.d) best = { x: item.x, y: item.y, seg, d };
      }
      if (best) return best;
    }
    let seg = null;
    if (me.alive) seg = me.isOnGround() ? nav.standingSeg(me.x, me.body.bottom) : nav.segmentAt(me.x, me.body.bottom + 2);
    if (me.alive && mySeg !== null && seg !== mySeg && (seg === null || !nav.nextEdge(mySeg, seg, (e) => this.usable(e, time)))) {
      // Inalcanzable (sobre el vacío, en un foso...): ir al tramo alcanzable más cercano a él.
      const near = this.closestReachable(nav, mySeg, me, time);
      if (near) return { ...near, isPlayer: true };
    }
    return { x: me.x, y: me.y, seg, isPlayer: true };
  }

  closestReachable(nav, from, me, time) {
    let best = null;
    for (const i of nav.reachable(from, (e) => this.usable(e, time))) {
      const s = nav.segs[i];
      const x = Math.min(Math.max(me.x, s.c0 * TILE + TILE / 2), s.c1 * TILE + TILE / 2);
      const d = Math.abs(x - me.x) + Math.abs((s.r + 1) * TILE - me.body.bottom);
      if (!best || d < best.d) best = { x, y: me.y, seg: i, d };
    }
    return best;
  }

  // Movimiento en el suelo: seguir la ruta o, en el mismo tramo, acercarse / mantener la distancia.
  groundMove(nav, mySeg, time) {
    const bot = this.bot;
    const me = this.scene.player;
    const vx = bot.body.velocity.x;
    this.lastGroundX = bot.x;
    if (mySeg === null) {
      // Pisando suelo fuera de un tramo (esquina de un tablón): primero volver a terreno conocido.
      const backX = nav.nearestSegX(bot.x, bot.body.bottom);
      if (backX !== null) return { dir: steerDir(bot.x, vx, backX, MOVE.groundDrag, 2) };
    }
    const target = this.pickTarget(nav, mySeg, time);
    // Ya saliendo por un borde con inercia: no cambiar de plan en el último momento.
    const committed = this.edge?.type === 'walk' && mySeg === this.edgeFrom && this.pastLaunch(this.edge);
    if (!committed && (time >= this.nextPlanAt || mySeg !== this.edgeFrom)) {
      this.edge = target.seg !== null && mySeg !== null ? nav.nextEdge(mySeg, target.seg, (e) => this.usable(e, time)) : null;
      this.edgeFrom = mySeg;
      this.nextPlanAt = time + REPLAN_MS;
    }

    const e = this.edge;
    if (e && mySeg !== null) {
      const launchX = e.launch * TILE + TILE / 2;
      if (e.type === 'walk') {
        // Ir hacia el borde (con la guarda puesta) y, desde ahí, salir caminando a la velocidad que simuló el grafo.
        if (!this.pastLaunch(e)) {
          this.walkSince = 0;
          return { dir: Math.sign(launchX - bot.x) };
        }
        // Si en 1 s no ha conseguido salir (algo lo sujeta), dar la arista por fallida.
        if (!this.walkSince) this.walkSince = time;
        if (time - this.walkSince > WALK_OFF_MS) {
          this.markFailure(e, time, true);
          this.edge = null;
          this.walkSince = 0;
          return { dir: 0 };
        }
        this.executing = { edge: e, from: mySeg };
        return { dir: e.dir };
      }
      // Saltar / atravesar: llegar al punto de despegue frenando a tiempo.
      if (Math.abs(launchX - bot.x) > LAUNCH_TOL || Math.abs(vx) > LAUNCH_MAX_VX) {
        return { dir: steerDir(bot.x, vx, launchX, MOVE.groundDrag, LAUNCH_TOL) };
      }
      this.executing = { edge: e, from: mySeg };
      return { dir: 0, jump: true, down: e.type === 'drop' };
    }

    let dir = 0;
    if (target.isPlayer && this.bot.weapon && me.alive) {
      const dx = me.x - bot.x;
      const want = RANGE[this.bot.weapon.type] ?? 250;
      if (Math.abs(dx) > want) dir = Math.sign(dx);
      else if (Math.abs(dx) < want * 0.45) dir = -Math.sign(dx);
    } else if (Math.abs(target.x - bot.x) > 6) {
      dir = steerDir(bot.x, vx, target.x, MOVE.groundDrag, 6);
    }
    // Esquivar: si el jugador va armado y está a su altura, saltito aleatorio.
    const jump = !!this.scene.weapons.local && Math.abs(me.y - bot.y) < 24 && Math.random() < 0.01;
    return { dir, jump };
  }

  pastLaunch(e) {
    const launchX = e.launch * TILE + TILE / 2;
    return Math.sign(this.bot.x - launchX) === e.dir || Math.abs(this.bot.x - launchX) <= 6;
  }

  // Sin plan de salir del tramo: no pasar del borde (frena antes según la velocidad que lleva).
  guard(dir, seg) {
    const s = this.nav.segs[seg];
    const bot = this.bot;
    const left = s.c0 * TILE + EDGE_MARGIN;
    const right = (s.c1 + 1) * TILE - EDGE_MARGIN;
    const vx = bot.body.velocity.x;
    const stop = (vx * vx) / (2 * MOVE.groundDrag);
    if (vx > 30 && bot.x + stop >= right) return -1;
    if (vx < -30 && bot.x - stop <= left) return 1;
    if ((dir > 0 && bot.x >= right - 4) || (dir < 0 && bot.x <= left + 4)) return 0;
    return dir;
  }

  airState(time) {
    const b = this.bot;
    return {
      x: b.x, feet: b.body.bottom, vx: b.body.velocity.x, vy: b.body.velocity.y,
      holdMs: Math.max(0, this.holdJumpUntil - time), dropMs: Math.max(0, b.dropUntil - time),
    };
  }

  // En el aire: dirigirse a airGoal; si la simulación dice que así no aterriza, buscar otro punto.
  airControl(nav, time) {
    const bot = this.bot;
    if (time >= this.nextAirCheck) {
      this.nextAirCheck = time + AIR_CHECK_MS;
      const state = this.airState(time);
      if (this.airGoal === null || nav.simulate(state, this.airGoal) === null) this.airGoal = this.findRecovery(nav, state);
    }
    if (this.airGoal === null) return 0;
    return steerDir(bot.x, bot.body.velocity.x, this.airGoal, MOVE.airAccel);
  }

  findRecovery(nav, state) {
    const c = Math.floor(state.x / TILE);
    const first = Math.sign(state.vx) || 1;
    for (let k = 0; k <= RECOVERY_COLS; k++) {
      for (const side of k ? [first, -first] : [1]) {
        const goal = (c + side * k) * TILE + TILE / 2;
        if (nav.simulate(state, goal) !== null) return goal;
      }
    }
    return null;
  }

  // ¿Se puede disparar sin que el retroceso lo saque del tramo (o del aterrizaje, si está en el aire)?
  canFireSafely(mySeg, face, onGround, time) {
    const def = WEAPONS[this.bot.weapon.type];
    if (onGround) {
      if (mySeg === null) return false;
      const s = this.nav.segs[mySeg];
      const room = face > 0 ? this.bot.x - s.c0 * TILE : (s.c1 + 1) * TILE - this.bot.x;
      return recoilSlide(def) < room + 4;
    }
    const state = this.airState(time);
    state.vx -= face * def.recoil;
    return this.nav.simulate(state, this.airGoal ?? state.x) !== null;
  }

  update(time, delta) {
    const bot = this.bot;
    const me = this.scene.player;
    const input = { left: false, right: false, down: false, jumpHeld: false, jumpPressed: false };
    let face = 0;
    let fire = false;

    if (!bot.alive) {
      // Murió (no por un disparo) ejecutando una arista: no volver a intentarla en un rato.
      if (this.pending && bot.deathCause !== 'hit') this.markFailure(this.pending.edge, time, true);
      this.pending = this.executing = this.airGoal = null;
      this.wasOnGround = false;
    } else if (this.scene.round.phase === 'playing') {
      this.scene.weapons.botTryPickup(bot);
      const nav = this.graph();
      const onGround = bot.isOnGround();
      const mySeg = onGround ? nav.standingSeg(bot.x, bot.body.bottom) : null;
      if (onGround && !this.wasOnGround) this.land(mySeg, time);
      if (!onGround && this.wasOnGround) this.takeOff();
      this.wasOnGround = onGround;

      let dir = 0;
      let jump = false;
      if (onGround) {
        this.executing = null;
        const move = this.groundMove(nav, mySeg, time);
        dir = move.dir;
        jump = !!move.jump;
        input.down = !!move.down;
      } else {
        dir = this.airControl(nav, time);
      }

      // Apuntar y disparar: a su altura, con línea de visión y tras un tiempo de reacción.
      if (bot.weapon && me.alive) {
        const range = bot.weapon.type === 2 ? 190 : 620;
        const steady = onGround || Math.abs(me.y - bot.y) < 10; // en el aire las balas salen desviadas
        const aligned = steady && Math.abs(me.y - bot.y) < 22 && Math.abs(me.x - bot.x) < range && this.lineOfSight(bot, me);
        if (aligned) {
          face = Math.sign(me.x - bot.x) || 1;
          if (!this.aimSince) this.aimSince = time;
          const safe = this.canFireSafely(mySeg, face, onGround, time);
          fire = safe && time - this.aimSince > REACTION_MS;
          if (onGround && mySeg !== null && !this.executing) {
            // A tiro: quedarse quieto para girarse y disparar; sin sitio para el retroceso, avanzar hacia él.
            if (!safe) dir = face;
            else if (Math.abs(me.x - bot.x) <= (RANGE[bot.weapon.type] ?? 250) * 1.2) dir = 0;
          }
        } else this.aimSince = 0;
      }

      if (onGround && mySeg !== null && !this.executing) dir = this.guard(dir, mySeg);
      input.left = dir < 0;
      input.right = dir > 0;
      if (jump) {
        input.jumpPressed = true;
        this.holdJumpUntil = time + JUMP_HOLD_MS;
      }
      input.jumpHeld = time < this.holdJumpUntil;
    }

    bot.update(input, time, delta);
    if (face && !input.left && !input.right) bot.setFlipX(face < 0); // girarse sin moverse
    if (fire && face === (bot.flipX ? -1 : 1)) this.scene.weapons.botFire(bot, time);
    bot.weaponType = bot.weapon?.type ?? 0;
    bot.armed = !!bot.weapon;
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
}
