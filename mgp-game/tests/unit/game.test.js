import { describe, it, expect, beforeEach } from 'vitest';
import GameRoom from '../../server/game.js';
import Telemetry from '../../server/telemetry.js';
import { WEAPONS, MAX_HP } from '../../client/src/weapons.js';
import { DRAW_WINDOW_MS, WINS_TO_MATCH } from '../../client/src/rules.js';
import { parse } from '../../client/src/maps.js';
import { environmentDeath, lineOfSight, illegalMove } from '../../server/arbiter.js';

// Reloj y temporizadores falsos: el test controla el tiempo.
function fakeClock() {
  const c = { t: 1000, timers: [] };
  c.now = () => c.t;
  c.setTimer = (fn, ms) => {
    const timer = { at: c.t + ms, fn };
    c.timers.push(timer);
    return timer;
  };
  c.clearTimer = (timer) => (c.timers = c.timers.filter((x) => x !== timer));
  c.advance = (ms) => {
    c.t += ms;
    for (const timer of c.timers.filter((x) => x.at <= c.t)) {
      c.timers = c.timers.filter((x) => x !== timer);
      timer.fn();
    }
  };
  return c;
}

let clock, room, sent, telemetry;
beforeEach(() => {
  clock = fakeClock();
  sent = [];
  telemetry = new Telemetry();
  room = new GameRoom({ id: 'r', telemetry, send: () => {}, broadcast: (evt, data) => sent.push([evt, data]), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  room.addPlayer('a', 'ANA');
  room.addPlayer('b', 'BETO');
  room.startMatch();
});

const giveWeapon = (id, type) => {
  clock.advance(1000);
  room.onSpawn('a', { id: `w${type}${clock.t}`, t: type, x: 100, y: 100 });
  room.onPickup(id, { id: `w${type}${clock.t}` });
};

// Mapa de la ronda 1: NIEVE. A aparece en (296, 492) sobre el bloque de x 192-400 (filas 32-33).
const A = { x: 296, y: 492 };
const ALIVE = 2; // flags de 'player_move': bit1 = vivo
const place = (id, x, y, flags = ALIVE) => room.onMove(id, [x, y, 0, 0, flags]);
// Preparar un escenario: poner a un jugador en (x, y) como si ya hubiera aparecido y llegado ahí.
const at = (id, x, y) => {
  const p = room.player(id);
  p.fresh = false;
  p.pos = { x, y, alive: true, at: clock.t };
  p.history = [p.pos];
};

describe('Autoridad del servidor (GameRoom)', () => {
  it('no se puede disparar sin arma, sin munición ni más rápido que la cadencia', () => {
    expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(false); // sin arma
    giveWeapon('a', 1);
    expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(true);
    expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(false); // demasiado rápido
    for (let i = 1; i < WEAPONS[1].ammo; i++) {
      clock.advance(WEAPONS[1].cooldown);
      expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(true);
    }
    clock.advance(1000);
    expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(false); // sin balas
  });

  it('cada arma del suelo solo la recoge uno (el primero) y solo el host las hace aparecer', () => {
    clock.advance(1000);
    expect(room.onSpawn('b', { id: 'x1', t: 2, x: 10, y: 10 })).toBe(false); // b no es host
    expect(room.onSpawn('a', { id: 'x1', t: 2, x: 10, y: 10 })).toBe(true);
    expect(room.onPickup('b', { id: 'x1' })).toBe(true);
    expect(room.onPickup('a', { id: 'x1' })).toBe(false);
    expect(room.player('b').weapon.type).toBe(2);
  });

  it('el servidor calcula el daño de la bala y rechaza impactos sin disparo que llegue', () => {
    at('a', A.x, A.y);
    at('b', 400, 492); // a 104 px a la derecha, sin paredes en medio
    expect(room.onHit('a', { kx: 0, ky: 0, w: 1 })).toBeNull(); // nunca disparó
    giveWeapon('a', 1);
    room.onShoot('a', { w: 1, x: 316, y: 495, a: [180] }); // dispara hacia el otro lado
    expect(room.onHit('a', { kx: 0, ky: 0, w: 1 })).toBeNull(); // la bala no iba hacia el rival
    clock.advance(WEAPONS[1].cooldown);
    room.onShoot('a', { w: 1, x: 316, y: 495, a: [0] });
    const res = room.onHit('a', { kx: 0, ky: 0, w: 1 });
    expect(res.hit.d).toBe(WEAPONS[1].damage); // el daño lo pone el servidor
    expect(room.player('b').hp).toBe(MAX_HP - 1);
  });

  it('no hay impacto a través de una pared (línea de visión con el mapa del servidor)', () => {
    at('a', A.x, A.y);
    at('b', A.x, 560); // justo debajo del suelo (filas 32-33 de sólido en medio)
    giveWeapon('a', 1);
    expect(room.onShoot('a', { w: 1, x: A.x, y: 514, a: [90] })).toBe(true);
    expect(room.onHit('a', { kx: 0, ky: 0, w: 1 })).toBeNull();
    expect(room.player('b').hp).toBe(MAX_HP);
  });

  it('el daño de la explosión sale de la distancia del rival según el servidor', () => {
    at('a', A.x, A.y);
    at('b', 380, 492);
    giveWeapon('a', 3);
    room.onShoot('a', { w: 3, x: 316, y: 495, a: [0] });
    expect(room.onHit('a', { kx: 0, ky: 0, w: 3, ex: 460, ey: 495 }).hit.d).toBe(1); // a 80 px: borde
    clock.advance(WEAPONS[3].cooldown);
    room.onShoot('a', { w: 3, x: 316, y: 495, a: [0] });
    expect(room.onHit('a', { kx: 0, ky: 0, w: 3, ex: 384, ey: 495 }).hit.d).toBe(2); // en el núcleo
    expect(room.player('b').alive).toBe(false);
  });

  it('al empezar la ronda solo acepta al jugador en su punto de aparición', () => {
    expect(place('a', 700, 300)).toBe('reject'); // lejos de su aparición
    expect(place('a', A.x, A.y, 0)).toBe('reject'); // aún muerto (ronda anterior)
    expect(place('a', A.x + 10, A.y)).toBe('ok');
    clock.advance(50);
    expect(place('a', 700, 300)).toBe('reject'); // y luego, nada de teletransportes
  });

  it('rechaza teletransportes y corrige al que se mete en una pared', () => {
    place('a', A.x, A.y);
    clock.advance(50);
    expect(place('a', A.x + 14, A.y)).toBe('ok');
    clock.advance(50);
    expect(place('a', 1300, 100)).toBe('reject'); // ~1050 px en 50 ms
    clock.advance(50);
    expect(place('a', A.x, A.y)).toBe('ok');
    clock.advance(50);
    expect(place('a', A.x, A.y + 30)).toBe('correct'); // dentro del suelo
    expect(room.player('a').pos).toMatchObject(A); // se queda la última posición válida
  });

  it('el servidor detecta la caída al agua con su mapa; dos muertes casi a la vez son empate', () => {
    at('b', 1400, 700);
    clock.advance(50);
    place('b', 1400, 740); // los pies pasan de la línea del agua (deathY 752)
    expect(room.player('b').alive).toBe(false);
    clock.advance(DRAW_WINDOW_MS);
    expect(sent.at(-1)).toEqual(['round_end', { r: 1, winner: 0, score: [1, 0], match: -1 }]);
    clock.advance(10000); // siguiente ronda
    room.kill(room.player('a'), 'hit');
    room.kill(room.player('b'), 'hit');
    clock.advance(DRAW_WINDOW_MS);
    expect(sent.at(-1)[1]).toMatchObject({ winner: -1, score: [1, 0] });
  });

  it('a 5 rondas se gana la partida y queda en la telemetría', () => {
    while (room.score[0] < WINS_TO_MATCH) {
      room.kill(room.player('b'), 'hit');
      clock.advance(10000);
    }
    expect(sent.filter(([evt]) => evt === 'round_end').at(-1)[1].match).toBe(0);
    expect(telemetry.summary().matches).toBe(1);
  });

  it('si el cliente se da por muerto y el servidor no lo vio, cierra la ronda igual', () => {
    at('b', 1144, 300);
    place('b', 1144, 300, 0); // muerto (bit de vivo a 0)
    clock.advance(1000);
    place('b', 1144, 250, 0);
    expect(room.player('b').alive).toBe(true);
    clock.advance(600);
    place('b', 1144, 200, 0);
    expect(room.player('b').alive).toBe(false);
  });
});

describe('Geometría del mapa en el servidor (arbiter)', () => {
  const m = parse({ name: 'T', theme: { death: 'void' }, rows: ['..........', '..........', '..........', '...^^.....', '##########'] });

  it('detecta pinchos aunque el contacto caiga entre dos paquetes', () => {
    expect(environmentDeath(m, { x: 24, y: 20 }, { x: 104, y: 20 })).toBeNull(); // pasa por encima
    expect(environmentDeath(m, { x: 24, y: 44 }, { x: 104, y: 44 })).toBe('spikes'); // los cruza entre dos paquetes
    expect(environmentDeath(m, null, { x: 150, y: 140 })).toBe('void');
  });

  it('las paredes tapan los disparos y no se pueden atravesar', () => {
    expect(lineOfSight(m, 8, 8, 150, 8)).toBe(true);
    expect(lineOfSight(m, 8, 8, 8, 90)).toBe(false);
    expect(illegalMove(m, null, 130, 44)).toBe(false); // de pie sobre el suelo
    expect(illegalMove(m, null, 130, 60)).toBe(true); // hundido en el suelo
    expect(illegalMove(m, { x: 130, y: 44 }, 130, 140)).toBe(true); // lo atraviesa
  });
});

describe('Telemetría', () => {
  it('siembra partidas y calcula win rate, KDR y supervivencia rápido', () => {
    const t = new Telemetry();
    t.seed(1000, 42);
    const s = t.summary();
    expect(s.matches).toBe(1000);
    expect(s.winRate.player1 + s.winRate.player2).toBeCloseTo(1);
    expect(s.kdr).toBeGreaterThan(0);
    expect(s.avgSurvivalMs).toBeGreaterThan(0);
    expect(s.topPlayers.length).toBeGreaterThan(0);
    expect(s.computedInMs).toBeLessThan(50);
  });

  it('resume la latencia con mediana, p95 y porcentaje bajo 100 ms', () => {
    const t = new Telemetry();
    for (let i = 0; i < 95; i++) t.recordLatency(60);
    for (let i = 0; i < 5; i++) t.recordLatency(400); // picos sueltos
    const l = t.summary().latency;
    expect(l.p50Ms).toBe(60);
    expect(l.p95Ms).toBe(400);
    expect(l.under100msPct).toBe(95);
    expect(l.avgMs).toBe(77);
  });
});
