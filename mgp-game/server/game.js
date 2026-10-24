import { WEAPONS, MAX_HP, THROWN_WEAPON, THROW, maxHitDamage, weaponRange } from '../client/src/weapons.js';
import { WINS_TO_MATCH, DRAW_WINDOW_MS, NEXT_ROUND_MS, NEXT_MATCH_MS } from '../client/src/rules.js';

// Sala de juego con AUTORIDAD DEL SERVIDOR sobre lo que decide la partida:
//  - vida de cada jugador y cálculo de daño (los clientes solo "proponen" impactos);
//  - inventario: qué arma lleva cada uno, su munición y su cadencia (no se puede disparar sin arma,
//    sin balas ni más rápido de lo que permite el arma);
//  - armas del suelo: una recogida por arma (el primero que llega), el resto se rechaza;
//  - movimiento: posiciones dentro del mundo y sin teletransportes (velocidad máxima creíble);
//  - rondas, marcador y fin de partida (empates incluidos).
// La física fina (saltos, colisiones con el mapa) corre en cada cliente para que el control sea
// instantáneo; el servidor valida sus resultados y descarta lo imposible.
const MAX_SPEED = 2400; // px/s: por encima de todo impulso legal (retroceso + explosión)
const MOVE_SLACK = 80; // px de margen por paquete (jitter de red)
const SPAWN_GRACE_MS = 900; // tras reaparecer se permite el salto de posición
const MAX_REJECTS = 5; // tantos movimientos rechazados seguidos -> se resincroniza (y se anota)
const COOLDOWN_TOLERANCE = 0.5; // fracción de la cadencia que se perdona por jitter de red
const HIT_RANGE_SLACK = 150;
const ROUND_START_EARLY_MS = 150; // el servidor abre la ronda un poco antes que los clientes

export default class GameRoom {
  constructor({ id, code = null, isPrivate = false, passwordHash = null, telemetry = null, send, broadcast, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { id, code, isPrivate, passwordHash, telemetry, send, broadcast, now, setTimer, clearTimer });
    this.players = []; // [{ id, index, name, ready, ... }] (el primero es el host)
    this.phase = 'waiting'; // 'waiting' | 'playing' | 'ended'
    this.round = 1;
    this.score = [0, 0];
    this.items = new Map(); // armas en el suelo: id -> tipo
    this.lastSpawnAt = -Infinity;
    this.timers = new Set();
    this.violations = 0; // intentos rechazados (telemetría / depuración)
  }

  // ------------------------------------------------------------ jugadores
  get full() {
    return this.players.length >= 2;
  }

  get hostId() {
    return this.players[0]?.id ?? null;
  }

  player(id) {
    return this.players.find((p) => p.id === id) ?? null;
  }

  opponentOf(id) {
    return this.players.find((p) => p.id !== id) ?? null;
  }

  addPlayer(id, name = 'Soldado') {
    if (this.full || this.player(id)) return null;
    const index = this.players.some((p) => p.index === 0) ? 1 : 0;
    const p = { id, index, name, ready: false, hp: MAX_HP, alive: true, weapon: null, shots: [], throws: [], pos: null, rejects: 0, spawnAt: this.now() };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    const wasPlaying = this.phase !== 'waiting';
    this.players = this.players.filter((p) => p.id !== id);
    this.stopMatch();
    // Si se fue a mitad de partida, el que queda sigue en la arena: cuenta como listo para el siguiente rival.
    for (const p of this.players) p.ready = wasPlaying;
  }

  setReady(id, ready) {
    const p = this.player(id);
    if (!p) return false;
    p.ready = ready;
    return this.full && this.players.every((q) => q.ready);
  }

  lobbyState() {
    return { code: this.code, players: this.players.map((p) => ({ name: p.name, index: p.index, ready: p.ready })) };
  }

  // -------------------------------------------------------------- partida
  startMatch() {
    this.clearTimers();
    this.score = [0, 0];
    this.round = 1;
    this.matchStartAt = this.now();
    this.stats = [0, 1].map(() => ({ kills: 0, deaths: 0, survivalMs: 0 })); // por índice de jugador
    this.rounds = 0;
    this.startRound();
  }

  stopMatch() {
    this.clearTimers();
    this.phase = 'waiting';
    this.score = [0, 0];
    this.round = 1;
    this.items.clear();
  }

  startRound() {
    this.phase = 'playing';
    this.deaths = new Map(); // índice -> instante de la muerte
    this.decideTimer = null;
    this.roundStartAt = this.now();
    this.items.clear();
    this.lastSpawnAt = -Infinity;
    for (const p of this.players) Object.assign(p, { hp: MAX_HP, alive: true, weapon: null, shots: [], throws: [], spawnAt: this.now(), rejects: 0 });
  }

  // --------------------------------------------------------- validaciones
  // Movimiento [x, y, vx, vy, flags]: dentro del mundo y sin teletransporte. Devuelve true si se acepta.
  onMove(id, packed) {
    const p = this.player(id);
    if (!p) return false;
    const [x, y, , , flags] = packed;
    const alive = !!(flags & 2);
    const now = this.now();
    if (p.pos && alive && p.pos.alive && now - p.spawnAt > SPAWN_GRACE_MS) {
      const dt = Math.max(16, now - p.pos.at) / 1000;
      const dist = Math.hypot(x - p.pos.x, y - p.pos.y);
      if (dist > MAX_SPEED * dt + MOVE_SLACK && ++p.rejects < MAX_REJECTS) {
        this.violations++;
        return false;
      }
    }
    if (alive && p.pos && !p.pos.alive) p.spawnAt = now; // reaparición: salto permitido
    if (!alive && this.phase === 'playing') p.alive = false; // muerte por el entorno (la confirma round_end)
    p.rejects = 0;
    p.pos = { x, y, alive, at: now };
    return true;
  }

  // Arma que aparece: solo la propone el host, con tipo válido y sin repetir id.
  onSpawn(id, d) {
    if (id !== this.hostId || this.phase !== 'playing' || !WEAPONS[d.t] || this.items.has(d.id)) return false;
    const now = this.now();
    if (now - this.lastSpawnAt < 1000 || this.items.size >= 6) return false;
    this.lastSpawnAt = now;
    this.items.set(d.id, d.t);
    return true;
  }

  // Recoger: el arma tiene que existir; el primero que llega se la queda.
  onPickup(id, d) {
    const p = this.player(id);
    const type = this.items.get(d.id);
    if (!p || !p.alive || type === undefined) return false;
    this.items.delete(d.id);
    p.weapon = { id: d.id, type, ammo: WEAPONS[type].ammo, nextShotAt: 0 };
    return true;
  }

  // Disparo: hay que llevar esa arma, con munición y respetando su cadencia.
  onShoot(id, d) {
    const p = this.player(id);
    const w = p?.weapon;
    const def = WEAPONS[d.w];
    if (!p || !p.alive || !w || w.type !== d.w || w.ammo <= 0 || d.a.length > def.pellets) return false;
    const now = this.now();
    if (now < w.nextShotAt - def.cooldown * COOLDOWN_TOLERANCE) return false;
    w.ammo--;
    w.nextShotAt = now + def.cooldown;
    p.shots.push({ w: d.w, at: now, hitsLeft: def.explosive ? 1 : d.a.length });
    if (p.shots.length > 8) p.shots.shift();
    if (w.ammo <= 0) p.weapon = null;
    return true;
  }

  onThrow(id, d) {
    const p = this.player(id);
    if (!p || !p.alive || !p.weapon || p.weapon.type !== d.w) return false;
    p.weapon = null;
    p.throws.push({ at: this.now(), used: false });
    if (p.throws.length > 4) p.throws.shift();
    return true;
  }

  // Impacto propuesto por el que disparó. Solo se acepta si cuadra con un disparo/lanzamiento reciente
  // suyo, con el daño máximo del arma y a una distancia creíble. El servidor resta la vida.
  // Devuelve { victim, hit } para avisar al herido, o null si se rechaza.
  onHit(id, d) {
    const shooter = this.player(id);
    const victim = this.opponentOf(id);
    if (!shooter || !victim || this.phase !== 'playing' || !victim.alive || d.d <= 0) return this.reject();
    if (d.d > maxHitDamage(d.w)) return this.reject();
    const now = this.now();
    if (d.w === THROWN_WEAPON) {
      const t = shooter.throws.find((th) => !th.used && now - th.at <= THROW.lifeMs + 500);
      if (!t) return this.reject();
      t.used = true;
    } else {
      const life = WEAPONS[d.w].life * 1.3 + 500;
      const shot = shooter.shots.find((s) => s.w === d.w && s.hitsLeft > 0 && now - s.at <= life);
      if (!shot) return this.reject();
      shot.hitsLeft--;
    }
    if (shooter.pos && victim.pos && now - victim.pos.at < 1000) {
      const dist = Math.hypot(shooter.pos.x - victim.pos.x, shooter.pos.y - victim.pos.y);
      if (dist > weaponRange(d.w) + HIT_RANGE_SLACK) return this.reject();
    }
    victim.hp = Math.max(0, victim.hp - d.d);
    if (victim.hp === 0) {
      victim.alive = false;
      this.registerDeath(victim.index);
    }
    return { victim, hit: d };
  }

  reject() {
    this.violations++;
    return null;
  }

  // Muerte que avisa el propio cliente (caída al agua/vacío, pinchos o golpe).
  onDeathReport(id, d) {
    const p = this.player(id);
    if (!p || d.r !== this.round || d.loser !== p.index) return false;
    p.alive = false;
    this.registerDeath(p.index);
    return true;
  }

  // Dos muertes dentro de DRAW_WINDOW_MS = empate.
  registerDeath(index) {
    if (this.phase !== 'playing' || this.deaths.has(index)) return;
    this.deaths.set(index, this.now());
    if (this.decideTimer) return;
    this.decideTimer = this.timer(DRAW_WINDOW_MS, () => this.decide());
  }

  decide() {
    const now = this.now();
    const dead = [...this.deaths.keys()];
    const winner = dead.length >= 2 ? -1 : 1 - dead[0];
    if (winner >= 0) this.score[winner]++;
    const match = winner >= 0 && this.score[winner] >= WINS_TO_MATCH ? winner : -1;
    this.phase = 'ended';
    this.rounds++;
    // Estadísticas de la ronda: muertes, bajas y tiempo vivo de cada uno.
    for (const p of this.players) {
      const s = this.stats?.[p.index];
      if (!s) continue;
      const diedAt = this.deaths.get(p.index);
      s.survivalMs += (diedAt ?? now) - this.roundStartAt;
      if (diedAt !== undefined) s.deaths++;
      else if (winner === p.index) s.kills++;
    }
    const verdict = { r: this.round, winner, score: [...this.score], match };
    this.broadcast('round_end', verdict);
    if (match >= 0) this.recordMatch(match);
    this.timer((match >= 0 ? NEXT_MATCH_MS : NEXT_ROUND_MS) - ROUND_START_EARLY_MS, () => {
      if (match >= 0) {
        this.startMatch();
      } else {
        this.round++;
        this.startRound();
      }
    });
    return verdict;
  }

  recordMatch(winner) {
    if (!this.telemetry || this.players.length < 2) return;
    const byIndex = [];
    for (const p of this.players) byIndex[p.index] = p;
    this.telemetry.record({
      players: [0, 1].map((i) => ({ name: byIndex[i]?.name ?? '?', ...this.stats[i], won: i === winner })),
      rounds: this.rounds,
      durationMs: this.now() - this.matchStartAt,
    });
  }

  // ----------------------------------------------------------- temporizadores
  timer(ms, fn) {
    const t = this.setTimer(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  clearTimers() {
    for (const t of this.timers) this.clearTimer(t);
    this.timers.clear();
    this.decideTimer = null;
  }
}
