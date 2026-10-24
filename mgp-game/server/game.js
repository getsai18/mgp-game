import { WEAPONS, MAX_HP, THROWN_WEAPON, THROW, EXPLOSION, weaponRange, explosionDamage } from '../client/src/weapons.js';
import { WINS_TO_MATCH, DRAW_WINDOW_MS, NEXT_ROUND_MS, NEXT_MATCH_MS } from '../client/src/rules.js';
import { roundMap, randomSeed } from '../client/src/mapGen.js';
import { illegalMove, environmentDeath, lineOfSight, rayDistance } from './arbiter.js';

// Sala de juego con AUTORIDAD DEL SERVIDOR sobre lo que decide la partida:
//  - vida y DAÑO: el cliente solo dice "le di con el arma w"; el servidor comprueba con su copia del
//    mapa y de las posiciones que el disparo pudo llegar (trayectoria, alcance, sin paredes en medio)
//    y calcula él mismo el daño (por arma, o por distancia al centro de la explosión);
//  - inventario: qué arma lleva cada uno, su munición y su cadencia (no se puede disparar sin arma,
//    sin balas ni más rápido de lo que permite el arma);
//  - armas del suelo: una recogida por arma (el primero que llega), el resto se rechaza;
//  - movimiento y COLISIONES: posiciones dentro del mundo, sin teletransportes (velocidad máxima) y
//    nunca dentro ni a través de una pared; si no, se corrige al cliente ('player_correct');
//  - MUERTES por el entorno (agua, vacío, pinchos): las detecta el servidor con el mapa de la ronda;
//  - rondas, marcador y fin de partida (empates incluidos).
// El cliente predice su propio movimiento para que el control sea instantáneo; el servidor
// valida cada paquete contra el mapa y tiene la última palabra.
const MAX_SPEED = 2400; // px/s: por encima de todo impulso legal (retroceso + explosión)
const MOVE_SLACK = 80; // px de margen por paquete (jitter de red)
const SPAWN_RADIUS = 120; // al empezar la ronda, la primera posición tiene que estar junto a su aparición
const MAX_REJECTS = 5; // tantos movimientos rechazados seguidos -> se resincroniza (y se anota)
const COOLDOWN_TOLERANCE = 0.5; // fracción de la cadencia que se perdona por jitter de red
const ROUND_START_EARLY_MS = 150; // el servidor abre la ronda un poco antes que los clientes
const HISTORY_MS = 600; // posiciones recientes de cada jugador (el que dispara ve al rival con retraso)
const BULLET_SLACK = 30; // px de margen alrededor de la trayectoria de una bala
const BLAST_SLACK = 10; // px de margen en la distancia al centro de una explosión
const DEAD_TIMEOUT_MS = 1500; // el cliente dice estar muerto y el servidor no lo vio: se da por muerto

export default class GameRoom {
  constructor({ id, code = null, isPrivate = false, passwordHash = null, telemetry = null, send, broadcast, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, prefetchMaps = null }) {
    // prefetchMaps(seed, matchNo): calcula en otro hilo los mapas procedurales de la partida (mapPool.js).
    Object.assign(this, { id, code, isPrivate, passwordHash, telemetry, send, broadcast, now, setTimer, clearTimer, prefetchMaps });
    this.players = []; // [{ id, index, name, ready, ... }] (el primero es el host)
    this.phase = 'waiting'; // 'waiting' | 'playing' | 'ended'
    this.round = 1;
    this.score = [0, 0];
    this.items = new Map(); // armas en el suelo: id -> tipo
    this.lastSpawnAt = -Infinity;
    this.timers = new Set();
    this.violations = 0; // intentos rechazados (telemetría / depuración)
    this.newMapSeed();
  }

  // Semilla de los mapas procedurales (va en 'match_start'); matchNo cuenta las revanchas.
  newMapSeed() {
    this.mapSeed = randomSeed();
    this.matchNo = 0;
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
    const p = { id, index, name, ready: false, hp: MAX_HP, alive: true, weapon: null, shots: [], throws: [], pos: null, history: [], deadSince: null, rejects: 0, fresh: true };
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

  // Mapa de la ronda actual: el mismo que calculan los clientes (client/src/mapGen.js).
  get map() {
    return roundMap(this.round, this.mapSeed, this.matchNo);
  }

  // -------------------------------------------------------------- partida
  startMatch() {
    this.clearTimers();
    this.score = [0, 0];
    this.round = 1;
    this.matchStartAt = this.now();
    this.prefetchMaps?.(this.mapSeed, this.matchNo);
    this.stats = [0, 1].map(() => ({ kills: 0, deaths: 0, survivalMs: 0 })); // por índice de jugador
    this.rounds = 0;
    this.startRound();
  }

  stopMatch() {
    this.clearTimers();
    this.newMapSeed(); // rival nuevo, mapas nuevos
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
    void this.map; // normalmente ya está en la caché (mapPool); si no, se genera aquí
    for (const p of this.players) Object.assign(p, { hp: MAX_HP, alive: true, weapon: null, shots: [], throws: [], history: [], deadSince: null, fresh: true, rejects: 0 });
  }

  // --------------------------------------------------------- validaciones
  // Movimiento [x, y, vx, vy, flags]. Devuelve 'ok', 'reject' (se descarta) o 'correct' (se descarta
  // y el cliente debe volver a la última posición válida, que queda en p.pos).
  onMove(id, packed) {
    const p = this.player(id);
    if (!p) return 'reject';
    const [x, y, , , flags] = packed;
    const alive = !!(flags & 2);
    const now = this.now();
    const playing = this.phase === 'playing' && p.alive;
    if (playing && p.fresh) {
      // Ronda nueva: hasta que el cliente reaparece en SU punto de aparición se descartan sus paquetes
      // (aún de la ronda anterior: otro mapa o el cuerpo cayendo). Nada de teletransportes de salida.
      const spawn = this.map.spawns[p.index];
      if (!alive || Math.hypot(x - spawn.x, y - spawn.y) > SPAWN_RADIUS) return 'reject';
      p.fresh = false;
    } else if (playing && p.pos) {
      // Paredes y velocidad solo con el cuerpo vivo (al morir atraviesa el mapa dando vueltas).
      if (alive && p.pos.alive) {
        const dt = Math.max(16, now - p.pos.at) / 1000;
        const dist = Math.hypot(x - p.pos.x, y - p.pos.y);
        if (dist > MAX_SPEED * dt + MOVE_SLACK && ++p.rejects < MAX_REJECTS) {
          this.violations++;
          return 'reject';
        }
        if (illegalMove(this.map, p.pos, x, y)) {
          this.violations++;
          return 'correct';
        }
      }
      // Agua, vacío y pinchos: también en el paquete en que el cliente ya se ve muerto (justo lo tocó).
      if (p.pos.alive) {
        const cause = environmentDeath(this.map, p.pos, { x, y });
        if (cause) this.kill(p, cause);
      }
      // Red de seguridad: el cliente dice que murió y el servidor no lo vio pasar.
      if (p.alive && !alive) {
        p.deadSince ??= now;
        if (now - p.deadSince > DEAD_TIMEOUT_MS) this.kill(p, 'unknown');
      }
    }
    if (alive) p.deadSince = null;
    p.rejects = 0;
    p.pos = { x, y, alive, at: now };
    p.history.push(p.pos);
    while (p.history.length && now - p.history[0].at > HISTORY_MS) p.history.shift();
    return 'ok';
  }

  kill(p, cause) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.deathCause = cause;
    this.registerDeath(p.index);
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
    p.shots.push({ w: d.w, at: now, x: d.x, y: d.y, a: d.a, hitsLeft: def.explosive ? 1 : d.a.length });
    if (p.shots.length > 8) p.shots.shift();
    if (w.ammo <= 0) p.weapon = null;
    return true;
  }

  onThrow(id, d) {
    const p = this.player(id);
    if (!p || !p.alive || !p.weapon || p.weapon.type !== d.w) return false;
    p.weapon = null;
    p.throws.push({ at: this.now(), x: d.x, y: d.y, used: false });
    if (p.throws.length > 4) p.throws.shift();
    return true;
  }

  // Aviso de impacto del que disparó: { w, kx, ky, ex?, ey? } ("le di con el arma w"; ex/ey = centro de
  // la explosión). El servidor busca un disparo reciente suyo que pudiera llegar al rival según SUS
  // posiciones y su mapa, y calcula el daño. Devuelve { victim, hit } para avisar al herido, o null.
  onHit(id, d) {
    const shooter = this.player(id);
    const victim = this.opponentOf(id);
    if (!shooter || !victim || this.phase !== 'playing' || !victim.alive) return this.reject();
    const now = this.now();
    // Dónde estuvo el rival hace poco (el que dispara lo ve con ~100-200 ms de retraso).
    const seen = victim.history.length ? victim.history : victim.pos ? [victim.pos] : [];
    if (!seen.length) return this.reject();
    let damage;
    if (d.w === THROWN_WEAPON) {
      const t = shooter.throws.find((th) => !th.used && now - th.at <= THROW.lifeMs + 500);
      if (!t || !seen.some((v) => Math.hypot(v.x - t.x, v.y - t.y) <= weaponRange(THROWN_WEAPON) + BULLET_SLACK)) return this.reject();
      t.used = true;
      damage = THROW.damage;
    } else {
      const def = WEAPONS[d.w];
      if (!def) return this.reject();
      const life = def.life * 1.3 + 500;
      const range = weaponRange(d.w);
      const recent = shooter.shots.filter((s) => s.w === d.w && s.hitsLeft > 0 && now - s.at <= life);
      // ¿Llega el rayo desde la boca del arma hasta `along` px sin pared en medio?
      const clear = (s, deg, along) => {
        const rad = (deg * Math.PI) / 180;
        const reach = Math.max(0, along - 12); // el impacto toca la pared: mirar un poco antes
        return lineOfSight(this.map, s.x, s.y, s.x + Math.cos(rad) * reach, s.y + Math.sin(rad) * reach);
      };
      let shot;
      if (def.explosive) {
        // El cohete vuela en línea recta: la explosión tiene que estar en su trayectoria y sin
        // paredes antes. El daño sale de la distancia del rival (según el servidor) a la explosión.
        if (d.ex === undefined || d.ey === undefined) return this.reject();
        shot = recent.find((s) => {
          const { along, perp } = rayDistance(s.x, s.y, s.a[0], d.ex, d.ey);
          return perp <= BULLET_SLACK && along >= -BULLET_SLACK && along <= range && clear(s, s.a[0], along);
        });
        if (!shot) return this.reject();
        const dist = Math.min(...seen.map((v) => Math.hypot(v.x - d.ex, v.y - d.ey)));
        if (dist > EXPLOSION.radius + BLAST_SLACK) return this.reject();
        damage = explosionDamage(Math.max(0, dist - BLAST_SLACK));
      } else {
        // Bala: el rival tiene que haber estado cerca de la trayectoria de algún perdigón, dentro
        // del alcance y sin paredes entre la boca del arma y él.
        shot = recent.find((s) => s.a.some((deg) => seen.some((v) => {
          const { along, perp } = rayDistance(s.x, s.y, deg, v.x, v.y);
          return perp <= BULLET_SLACK && along >= -BULLET_SLACK && along <= range && clear(s, deg, along);
        })));
        if (!shot) return this.reject();
        damage = def.damage;
      }
      shot.hitsLeft--;
    }
    victim.hp = Math.max(0, victim.hp - damage);
    if (victim.hp === 0) this.kill(victim, 'hit');
    return { victim, hit: { d: damage, kx: d.kx, ky: d.ky, w: d.w } };
  }

  reject() {
    this.violations++;
    return null;
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
        this.matchNo++;
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
